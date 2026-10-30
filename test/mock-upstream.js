'use strict';
// Fake upstream for the smoke test. Pretends to be the Claude API, GitHub (a real
// git server) and a custom API, and records the auth headers the gateway sends (to a root-only file).
const http = require('node:http');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const LOG = process.env.MOCK_LOG || '/root/mock-requests.jsonl';
const PORT = Number(process.env.MOCK_PORT || 9999);
const GIT_ROOT = process.env.MOCK_GIT_ROOT || '/root/git-repos';

function sse(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

function record(req) {
  fs.appendFileSync(LOG, `${JSON.stringify({
    method: req.method,
    path: req.url,
    host: req.headers.host,
    authorization: req.headers.authorization || null,
    'x-api-key': req.headers['x-api-key'] || null,
    'x-custom-key': req.headers['x-custom-key'] || null,
    'anthropic-beta': req.headers['anthropic-beta'] || null,
  })}\n`, { mode: 0o600 });
}

// /gh/... is served by a real git server (git http-backend), so clone and push can be tested.
function gitBackend(req, res) {
  const [pathInfo, query = ''] = req.url.slice('/gh'.length).split('?');
  const cgiEnv = {
    PATH: process.env.PATH,
    GIT_PROJECT_ROOT: GIT_ROOT,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: pathInfo,
    QUERY_STRING: query,
    REQUEST_METHOD: req.method,
    CONTENT_TYPE: req.headers['content-type'] || '',
    REMOTE_USER: 'smoke',
    REMOTE_ADDR: '127.0.0.1',
  };
  if (req.headers['content-length']) cgiEnv.CONTENT_LENGTH = req.headers['content-length'];
  for (const [name, value] of Object.entries(req.headers)) {
    cgiEnv[`HTTP_${name.toUpperCase().replace(/-/g, '_')}`] = String(value);
  }
  const cgi = spawn('git', ['http-backend'], { env: cgiEnv });
  req.pipe(cgi.stdin);
  let head = Buffer.alloc(0);
  let headDone = false;
  cgi.stdout.on('data', (chunk) => {
    if (headDone) return res.write(chunk);
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end === -1) return undefined;
    headDone = true;
    let status = 200;
    const headers = {};
    for (const line of head.slice(0, end).toString().split('\r\n')) {
      const i = line.indexOf(':');
      const name = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
      else headers[name] = value;
    }
    res.writeHead(status, headers);
    return res.write(head.slice(end + 4));
  });
  cgi.stdout.on('end', () => res.end());
  cgi.stderr.on('data', (d) => process.stderr.write(d));
}

http.createServer((req, res) => {
  record(req);
  if (req.url.startsWith('/gh/')) return gitBackend(req, res);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.endsWith('/force-401')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid bearer token' } }));
    }
    if (req.url.startsWith('/anthropic-up/')) {
      fs.appendFileSync(`${LOG}.anthropic-bodies`, `${body}\n`, { mode: 0o600 });
    }
    if (req.url.startsWith('/anthropic-up/v1/messages') && req.method === 'POST') {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      if (req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ input_tokens: 10 }));
      }
      if (parsed.stream) return sse(res, 'Hello from the mock upstream');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-mock',
        content: [{ type: 'text', text: 'Hello from the mock upstream' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
      }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  return undefined;
}).listen(PORT, '127.0.0.1', () => console.log(`mock upstream on ${PORT}`));
