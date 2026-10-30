'use strict';
// Opens a terminal session like a browser would (starts the tmux session) and
// keeps it open for N seconds. Uses Node's built-in WebSocket (Node 22+).
// Usage: node test/open-session.js http://127.0.0.1:18080 dev <password> [seconds]
const [base, user, password, seconds = '5'] = process.argv.slice(2);
const url = new URL('/ws', base);
url.protocol = url.protocol.replace('http', 'ws');

const ws = new WebSocket(url, {
  protocols: ['tty'],
  headers: {
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    origin: new URL(base).origin,
  },
});
ws.addEventListener('open', () => {
  ws.send(new TextEncoder().encode(JSON.stringify({ AuthToken: '', columns: 120, rows: 40 })));
  setTimeout(() => { ws.close(); process.exit(0); }, Number(seconds) * 1000);
});
ws.addEventListener('error', (event) => {
  console.error('WebSocket error', event.message || '');
  process.exit(1);
});
