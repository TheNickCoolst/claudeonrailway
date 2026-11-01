import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listProjects,
  getProjectStatus,
  getProjectDiff,
  cloneRepository,
  commitAndPush,
  DEFAULT_PROJECTS_DIR,
} from './git.js';
import { runAgentTask } from './agent.js';
import { runCommand } from './terminal.js';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = Number(process.env.APP_PORT || process.env.TTYD_PORT || 7681);
const HOST = '127.0.0.1';

// Active agent runs for aborting
const activeTasks = new Map();

function resolveSafeProjectPath(projectParam) {
  if (!projectParam) return DEFAULT_PROJECTS_DIR;
  const resolved = path.resolve(DEFAULT_PROJECTS_DIR, projectParam);
  const relative = path.relative(DEFAULT_PROJECTS_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Set CORS headers for local development if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Health check
    if (pathname === '/healthz' || pathname === '/api/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok\n');
      return;
    }

    // System info
    if (pathname === '/api/info' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        version: '1.0.0',
        node: process.version,
        uptime: Math.floor(process.uptime()),
        projectsDir: DEFAULT_PROJECTS_DIR,
        gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:8787',
      });
    }

    // Projects: list
    if (pathname === '/api/projects' && req.method === 'GET') {
      const projects = await listProjects();
      return sendJson(res, 200, { projects });
    }

    // Projects: clone
    if (pathname === '/api/projects/clone' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.repo) {
        return sendError(res, 400, 'Repository URL or owner/repo required');
      }
      const result = await cloneRepository({
        repo: body.repo,
        branch: body.branch,
      });
      return sendJson(res, result.success ? 200 : 400, result);
    }

    // Projects: status
    if (pathname === '/api/projects/status' && req.method === 'GET') {
      const projectParam = url.searchParams.get('project');
      const resolvedPath = resolveSafeProjectPath(projectParam);
      if (!resolvedPath) return sendError(res, 400, 'Invalid or missing project parameter');
      const status = await getProjectStatus(resolvedPath);
      return sendJson(res, 200, status);
    }

    // Projects: diff
    if (pathname === '/api/projects/diff' && req.method === 'GET') {
      const projectParam = url.searchParams.get('project');
      const resolvedPath = resolveSafeProjectPath(projectParam);
      if (!resolvedPath) return sendError(res, 400, 'Invalid or missing project parameter');
      const diffData = await getProjectDiff(resolvedPath);
      return sendJson(res, 200, diffData);
    }

    // Projects: commit & push
    if (pathname === '/api/projects/commit-push' && req.method === 'POST') {
      const body = await parseBody(req);
      const resolvedPath = resolveSafeProjectPath(body.project);
      if (!resolvedPath) return sendError(res, 400, 'Invalid or missing project parameter');
      if (!body.message) return sendError(res, 400, 'Commit message required');

      const result = await commitAndPush({
        projectPath: resolvedPath,
        message: body.message,
        branch: body.branch,
      });
      return sendJson(res, result.success ? 200 : 400, result);
    }

    // Projects: AI commit message generation
    if (pathname === '/api/projects/ai-commit-message' && req.method === 'POST') {
      const body = await parseBody(req);
      const resolvedPath = resolveSafeProjectPath(body.project);
      if (!resolvedPath) return sendError(res, 400, 'Invalid or missing project parameter');
      const diffData = await getProjectDiff(resolvedPath);

      if (!diffData.hasChanges) {
        return sendError(res, 400, 'No uncommitted changes detected to generate a message for.');
      }

      try {
        const client = new Anthropic({
          baseURL: process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:8787/anthropic',
          apiKey: process.env.ANTHROPIC_API_KEY || 'managed-by-gateway',
        });

        const prompt = `Based on the following git diff, generate a concise, professional conventional commit message (e.g. "feat(auth): add login token check" or "fix(server): handle null pointer in routes"). Return ONLY the single commit message, nothing else:\n\n${diffData.diff.slice(0, 8000)}`;

        const response = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219',
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
        });

        const commitMessage = response.content[0]?.text?.trim() || 'chore: update project files';
        return sendJson(res, 200, { commitMessage });
      } catch (err) {
        console.error('[server:ai-commit] Error:', err);
        return sendError(res, 500, `Failed to generate AI commit message: ${err.message}`);
      }
    }

    // Agent: run task with Server-Sent Events (SSE)
    if (pathname === '/api/agent/stream' && req.method === 'POST') {
      const body = await parseBody(req);
      const { prompt, project, taskId = `task-${Date.now()}` } = body;

      if (!prompt) return sendError(res, 400, 'Prompt required');

      const resolvedCwd = resolveSafeProjectPath(project);
      if (!resolvedCwd) return sendError(res, 400, 'Invalid project parameter');

      // Initialize SSE stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const sendEvent = (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const abortController = new AbortController();
      activeTasks.set(taskId, abortController);

      req.on('close', () => {
        if (activeTasks.has(taskId)) {
          abortController.abort();
          activeTasks.delete(taskId);
        }
      });

      try {
        await runAgentTask({
          prompt,
          cwd: resolvedCwd,
          abortController,
          onEvent: sendEvent,
        });
      } catch (err) {
        sendEvent({ type: 'error', error: err.message });
      } finally {
        activeTasks.delete(taskId);
        sendEvent({ type: 'done' });
        res.end();
      }
      return;
    }

    // Agent: cancel running task
    if (pathname === '/api/agent/cancel' && req.method === 'POST') {
      const body = await parseBody(req);
      const { taskId } = body;
      if (taskId && activeTasks.has(taskId)) {
        activeTasks.get(taskId).abort();
        activeTasks.delete(taskId);
        return sendJson(res, 200, { success: true, message: `Task ${taskId} cancelled` });
      }
      // Or abort all active
      for (const [id, controller] of activeTasks.entries()) {
        controller.abort();
        activeTasks.delete(id);
      }
      return sendJson(res, 200, { success: true, message: 'Active tasks cancelled' });
    }

    // Terminal: run command with SSE stream
    if (pathname === '/api/terminal/run' && req.method === 'POST') {
      const body = await parseBody(req);
      const { command, project } = body;

      if (!command) return sendError(res, 400, 'Command required');
      const resolvedCwd = resolveSafeProjectPath(project);
      if (!resolvedCwd) return sendError(res, 400, 'Invalid project parameter');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const child = runCommand({
        command,
        cwd: resolvedCwd,
        onData: (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        },
        onExit: (exit) => {
          res.write(`data: ${JSON.stringify({ type: 'exit', code: exit.code })}\n\n`);
          res.end();
        },
      });

      req.on('close', () => {
        child.kill('SIGTERM');
      });
      return;
    }

    // Static files: HTML, CSS, JS
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };

      res.writeHead(200, {
        'Content-Type': contentTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      createReadStream(filePath).pipe(res);
    } catch {
      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (err) {
    console.error('[server] Uncaught request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    } else {
      res.destroy();
    }
  }
});

// Handle WebSocket upgrades (e.g. /ws for terminal/events)
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const protocol = req.headers['sec-websocket-protocol'];
  const protoHeader = protocol ? `Sec-WebSocket-Protocol: ${protocol.split(',')[0].trim()}\r\n` : '';

  const response =
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    protoHeader +
    '\r\n';

  socket.write(response);
  socket.on('error', () => socket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`[app:server] Claude Dev Studio running on http://${HOST}:${PORT}`);
  console.log(`[app:server] Projects directory: ${DEFAULT_PROJECTS_DIR}`);
});
