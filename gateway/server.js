#!/usr/bin/env node
'use strict';

/*
 * Gateway: the only process in the container that can see your secrets.
 *
 * It runs as its own Linux user ("broker"), so the "dev" user (you in the
 * terminal, and Claude Code) cannot read its environment or memory.
 *
 *  1. Public listener ($PORT): password-protected web terminal.
 *     Checks the password, then forwards to ttyd on 127.0.0.1.
 *
 *  2. Local listener (127.0.0.1:8787): adds API keys / tokens to requests.
 *     http://127.0.0.1:8787/<route>/<path>  ->  <route target>/<path>
 *     The dev user can *use* the APIs but never sees the keys.
 *
 * No npm dependencies on purpose: less to audit, nothing to install.
 */

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const env = process.env;

const PUBLIC_PORT = toPort(env.PORT, 8080);
const LOCAL_PORT = toPort(env.GATEWAY_LOCAL_PORT, 8787);
const TTYD_PORT = toPort(env.TTYD_PORT, 7681);
const TERMINAL_USERNAME = env.TERMINAL_USERNAME || 'dev';
const TERMINAL_PASSWORD = env.TERMINAL_PASSWORD || '';

const SESSION_COOKIE = 'devenv_session';
const SESSION_DAYS = 30;

// Headers that belong to one connection and must not be forwarded.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

function log(...args) {
  console.log('[gateway]', ...args);
}

function toPort(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

// Constant-time string compare (hashing first makes lengths equal).
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// ---------------------------------------------------------------------------
// Routes for the local secrets proxy
// ---------------------------------------------------------------------------

function parseTarget(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`route "${name}": target must be http(s)`);
  }
  return url;
}

// Read a secret from the environment. Trims spaces and line breaks,
// which easily sneak in when you paste a token into Railway.
function secret(name) {
  return (env[name] || '').trim();
}

// Replace ${VAR} with the value of env var VAR (used by PROXY_ROUTES headers).
function expandEnv(value, routeName) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (env[name] === undefined) {
      throw new Error(`route "${routeName}": variable ${name} is not set`);
    }
    return secret(name);
  });
}

function addAnthropicOAuthBeta(headers) {
  const flag = 'oauth-2025-04-20';
  const current = [].concat(headers['anthropic-beta'] || []).join(',');
  const list = current.split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.includes(flag)) list.push(flag);
  headers['anthropic-beta'] = list.join(',');
}

function buildRoutes() {
  const routes = new Map();

  // Claude API: an API key, or a Claude Pro/Max subscription token from `claude setup-token`.
  // An API key is preferred if both are set.
  let apiKey = secret('ANTHROPIC_API_KEY');
  let oauthToken = secret('CLAUDE_CODE_OAUTH_TOKEN');
  if (apiKey.startsWith('sk-ant-oat')) {
    log('NOTE: ANTHROPIC_API_KEY holds a subscription token (sk-ant-oat...); using it as CLAUDE_CODE_OAUTH_TOKEN');
    oauthToken = apiKey;
    apiKey = '';
  }
  if (oauthToken && !apiKey && !oauthToken.startsWith('sk-ant-oat')) {
    log('WARNING: CLAUDE_CODE_OAUTH_TOKEN does not start with "sk-ant-oat". Create it with `claude setup-token`.');
  }
  if (apiKey || oauthToken) {
    routes.set('anthropic', {
      target: parseTarget(env.ANTHROPIC_UPSTREAM || 'https://api.anthropic.com', 'anthropic'),
      strip: new Set(['authorization', 'x-api-key']),
      inject: apiKey ? { 'x-api-key': apiKey } : { authorization: `Bearer ${oauthToken}` },
      transform: apiKey ? null : addAnthropicOAuthBeta,
      description: apiKey
        ? 'Claude API (ANTHROPIC_API_KEY)'
        : 'Claude API (CLAUDE_CODE_OAUTH_TOKEN)',
    });
  }

  // GitHub over git's HTTPS protocol (clone / fetch / push).
  // Only git endpoints are allowed, so the token can't be used for anything else on github.com.
  const githubToken = secret('GITHUB_TOKEN');
  routes.set('github', {
    target: parseTarget(env.GITHUB_UPSTREAM || 'https://github.com', 'github'),
    strip: new Set(['authorization']),
    inject: githubToken
      ? { authorization: `Basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}` }
      : {},
    allowPath: /^\/[^/]+\/[^/]+\/(info\/refs|git-upload-pack|git-receive-pack)$/,
    description: githubToken ? 'GitHub git (GITHUB_TOKEN)' : 'GitHub git (public repos only, GITHUB_TOKEN not set)',
  });

  // GitHub REST API (create pull requests, issues, ...).
  if (githubToken) {
    routes.set('github-api', {
      target: parseTarget(env.GITHUB_API_UPSTREAM || 'https://api.github.com', 'github-api'),
      strip: new Set(['authorization']),
      inject: { authorization: `Bearer ${githubToken}` },
      description: 'GitHub REST API (GITHUB_TOKEN)',
    });
  }

  // Your own routes, e.g.
  // PROXY_ROUTES={"openai":{"target":"https://api.openai.com","headers":{"Authorization":"Bearer ${OPENAI_API_KEY}"}}}
  if (env.PROXY_ROUTES) {
    let custom;
    try {
      custom = JSON.parse(env.PROXY_ROUTES);
    } catch (err) {
      log(`ERROR: PROXY_ROUTES is not valid JSON (${err.message}); ignoring it`);
      custom = {};
    }
    for (const [name, spec] of Object.entries(custom || {})) {
      try {
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name) || name.startsWith('_')) {
          throw new Error(`route name "${name}" may only use letters, digits, - and _`);
        }
        if (routes.has(name)) throw new Error(`route "${name}" already exists`);
        if (!spec || typeof spec.target !== 'string') throw new Error(`route "${name}": "target" is required`);
        const inject = {};
        for (const [header, value] of Object.entries(spec.headers || {})) {
          inject[header.toLowerCase()] = expandEnv(value, name);
        }
        routes.set(name, {
          target: parseTarget(spec.target, name),
          strip: new Set(Object.keys(inject)),
          inject,
          description: spec.description || `custom route (${Object.keys(inject).join(', ') || 'no headers'})`,
        });
      } catch (err) {
        log(`ERROR: ${err.message}; skipping this route`);
      }
    }
  }

  for (const [name, route] of routes) route.name = name;
  return routes;
}

const routes = buildRoutes();

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

const ERROR_HINTS = {
  anthropic: {
    401: 'the key or token was rejected. Check ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN '
      + '(setup-token tokens expire after a year; create a new one with `claude setup-token`)',
    403: 'not allowed. With a subscription, your plan may not include this model: switch with /model',
    429: 'rate or usage limit reached. With a subscription, wait for your limit to reset',
  },
  github: {
    401: 'GitHub rejected GITHUB_TOKEN (expired or wrong?)',
    403: 'GITHUB_TOKEN has no access to this repo (check the token\'s repositories and permissions)',
    404: 'repo not found, or GITHUB_TOKEN has no access to it',
  },
};

// Log errors from the Claude API and git, so problems with keys or limits show up in the
// Railway logs. Only the status and the API's error message are logged, never request headers.
function logUpstreamError(route, upRes) {
  const hints = ERROR_HINTS[route.name];
  if (!hints || upRes.statusCode < 400) return;
  if (route.name === 'github' && !hints[upRes.statusCode]) return;
  const chunks = [];
  let size = 0;
  upRes.on('data', (chunk) => {
    if (size < 8192) { chunks.push(chunk); size += chunk.length; }
  });
  upRes.on('end', () => {
    let detail = '';
    try {
      let body = Buffer.concat(chunks);
      const encoding = String(upRes.headers['content-encoding'] || '');
      if (encoding.includes('gzip')) body = zlib.gunzipSync(body);
      else if (encoding.includes('br')) body = zlib.brotliDecompressSync(body);
      else if (encoding.includes('deflate')) body = zlib.inflateSync(body);
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed.error) detail = ` (${parsed.error.type || 'error'}: ${String(parsed.error.message || '').slice(0, 200)})`;
    } catch { /* not JSON: log the status only */ }
    const hint = hints[upRes.statusCode] || (upRes.statusCode >= 500 ? 'upstream problem, usually temporary' : '');
    log(`${route.name}: answered ${upRes.statusCode}${detail}${hint ? ` - ${hint}` : ''}`);
  });
}

function forward(req, res, route, path) {
  const { target } = route;
  const headers = {};
  const connectionTokens = String(req.headers.connection || '')
    .split(',').map((s) => s.trim().toLowerCase());
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name) || connectionTokens.includes(name) || route.strip.has(name)) continue;
    headers[name] = value;
  }
  Object.assign(headers, route.inject);
  if (route.transform) route.transform(headers);
  headers.host = target.host;

  const isHttps = target.protocol === 'https:';
  // Build the request from fixed host + path so a crafted path can never change the host.
  const upstream = (isHttps ? https : http).request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    method: req.method,
    path: target.pathname.replace(/\/+$/, '') + path,
    headers,
  }, (upRes) => {
    const outHeaders = {};
    for (const [name, value] of Object.entries(upRes.headers)) {
      if (!HOP_BY_HOP.has(name)) outHeaders[name] = value;
    }
    res.writeHead(upRes.statusCode, upRes.statusMessage, outHeaders);
    logUpstreamError(route, upRes);
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    log(`upstream error on ${route.name}: ${err.code || err.message}`);
    if (!res.headersSent) {
      sendJson(res, 502, { error: `gateway could not reach ${target.host}: ${err.code || 'error'}` });
    } else {
      res.destroy();
    }
  });
  // If the client goes away (e.g. you press Esc in Claude Code), stop the upstream request too.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
}

function handleLocal(req, res) {
  const q = req.url.indexOf('?');
  const pathname = q === -1 ? req.url : req.url.slice(0, q);
  const search = q === -1 ? '' : req.url.slice(q);

  if (pathname === '/' || pathname === '/_routes') {
    const list = {};
    for (const [name, route] of routes) {
      list[name] = {
        url: `http://127.0.0.1:${LOCAL_PORT}/${name}`,
        target: route.target.origin + route.target.pathname.replace(/\/+$/, ''),
        description: route.description,
      };
    }
    return sendJson(res, 200, { routes: list });
  }

  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  const route = match && routes.get(match[1]);
  if (!route) {
    return sendJson(res, 404, { error: 'unknown route', routes: [...routes.keys()] });
  }
  const rest = match[2] || '/';
  const segments = rest.split('/').map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  if (segments.some((s) => s === '.' || s === '..')) {
    return sendJson(res, 400, { error: 'path may not contain . or .. segments' });
  }
  if (route.allowPath && !route.allowPath.test(rest)) {
    return sendJson(res, 403, { error: `path not allowed on route "${match[1]}"` });
  }
  return forward(req, res, route, rest + search);
}

// ---------------------------------------------------------------------------
// Public listener: password-protected web terminal
// ---------------------------------------------------------------------------

// Session cookie, so WebSockets work on browsers that don't resend basic auth (e.g. iOS Safari).
// The signing key is derived from the password, so changing the password logs everyone out.
const sessionKey = crypto.createHmac('sha256', TERMINAL_PASSWORD)
  .update(`devenv-session-v1:${TERMINAL_USERNAME}`).digest();

function signSession(expires) {
  return crypto.createHmac('sha256', sessionKey).update(String(expires)).digest('base64url');
}

function newSessionCookie(req) {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${expires}.${signSession(expires)}; Path=/; HttpOnly; SameSite=Strict`
    + `; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`;
}

function hasValidSession(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    const [expires, sig] = rest.join('=').split('.');
    if (!expires || !sig || Number(expires) < Date.now()) return false;
    return safeEqual(sig, signSession(expires));
  }
  return false;
}

function hasValidBasicAuth(req) {
  const match = /^Basic\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i === -1) return false;
  // Use & (not &&) so both comparisons always run.
  return Boolean(safeEqual(decoded.slice(0, i), TERMINAL_USERNAME)
    & safeEqual(decoded.slice(i + 1), TERMINAL_PASSWORD));
}

// Block other websites from opening a terminal WebSocket with your cookies.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser
  let originHost;
  try { originHost = new URL(origin).host; } catch { return false; }
  const allowed = [req.headers.host, req.headers['x-forwarded-host'], env.RAILWAY_PUBLIC_DOMAIN];
  return allowed.some((h) => h && String(h).split(',')[0].trim() === originHost);
}

const STARTING_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<title>Starting…</title><body style="font-family:system-ui;background:#111;color:#ddd;padding:2rem">
<p>The terminal is starting. This page reloads by itself.</p></body>`;

function handlePublic(req, res) {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok\n');
  }

  const basicOk = hasValidBasicAuth(req);
  const sessionOk = !basicOk && hasValidSession(req);
  if (!basicOk && !sessionOk) {
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="Claude Code dev environment", charset="UTF-8"',
      'content-type': 'text/plain',
    });
    return res.end('Login required\n');
  }

  const headers = { ...req.headers };
  delete headers.authorization;
  const upstream = http.request({
    host: '127.0.0.1', port: TTYD_PORT, method: req.method, path: req.url, headers,
  }, (upRes) => {
    const outHeaders = { ...upRes.headers };
    if (basicOk && !hasValidSession(req)) {
      outHeaders['set-cookie'] = [].concat(outHeaders['set-cookie'] || [], newSessionCookie(req));
    }
    res.writeHead(upRes.statusCode, upRes.statusMessage, outHeaders);
    upRes.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '3' });
      res.end(STARTING_PAGE);
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

function handleUpgrade(req, socket, head) {
  socket.on('error', () => socket.destroy());
  if (!hasValidBasicAuth(req) && !hasValidSession(req)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!isSameOrigin(req)) {
    log(`blocked WebSocket from origin ${req.headers.origin}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }

  const upstream = net.connect(TTYD_PORT, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === 'authorization') continue;
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    upstream.write(`${raw}\r\n`);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  upstream.on('close', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!TERMINAL_PASSWORD) {
  log('ERROR: TERMINAL_PASSWORD is empty, refusing to start');
  process.exit(1);
}
if (PUBLIC_PORT === LOCAL_PORT || PUBLIC_PORT === TTYD_PORT) {
  log(`ERROR: PORT=${PUBLIC_PORT} clashes with an internal port (${LOCAL_PORT}/${TTYD_PORT})`);
  process.exit(1);
}

const publicServer = http.createServer(handlePublic);
publicServer.on('upgrade', handleUpgrade);
// Keep idle connections longer than Railway's edge proxy does, to avoid random 502s.
publicServer.keepAliveTimeout = 65_000;
publicServer.headersTimeout = 66_000;
// Listen on IPv6 and IPv4 ("::"); fall back to IPv4 only where IPv6 is switched off.
function listenPublic(host) {
  const onError = (err) => {
    if (host === '::' && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
      listenPublic('0.0.0.0');
    } else {
      throw err;
    }
  };
  publicServer.once('error', onError);
  publicServer.listen(PUBLIC_PORT, host, () => {
    publicServer.removeListener('error', onError);
    log(`web terminal on port ${PUBLIC_PORT} (user "${TERMINAL_USERNAME}")`);
  });
}
listenPublic('::');

const localServer = http.createServer(handleLocal);
localServer.requestTimeout = 0; // allow long uploads such as big git pushes
localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
  log(`secrets proxy on http://127.0.0.1:${LOCAL_PORT}`);
  for (const [name, route] of routes) {
    log(`  /${name} -> ${route.target.origin}  ${route.description}`);
  }
});

function shutdown() {
  publicServer.close();
  localServer.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
