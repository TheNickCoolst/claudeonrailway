'use strict';
// Checks the public login: password, session cookie, and WebSocket origin check.
// Usage: node test/ws-check.js http://127.0.0.1:18080 dev <password>
const http = require('node:http');
const net = require('node:net');

const [base, user, password] = process.argv.slice(2);
const url = new URL(base);
let failed = false;
const result = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) failed = true;
};

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: url.hostname, port: url.port, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    }).on('error', reject);
  });
}

function upgrade(headers) {
  return new Promise((resolve) => {
    const socket = net.connect(Number(url.port), url.hostname, () => {
      const lines = [
        'GET /ws HTTP/1.1',
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: tty',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      ];
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.once('data', (data) => {
      resolve(data.toString().split('\r\n')[0]);
      socket.destroy();
    });
    socket.on('error', () => resolve('error'));
  });
}

(async () => {
  const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

  result((await get('/healthz')).statusCode === 200, 'healthz works without login');
  result((await get('/')).statusCode === 401, 'no password -> 401');
  result((await get('/', { authorization: basic(user, 'wrong') })).statusCode === 401, 'wrong password -> 401');

  const ok = await get('/', { authorization: basic(user, password) });
  result(ok.statusCode === 200, 'right password -> 200');
  const cookie = [].concat(ok.headers['set-cookie'] || [])[0]?.split(';')[0];
  result(Boolean(cookie), 'session cookie is set');

  const origin = `http://${url.host}`;
  const viaCookie = await upgrade({ Cookie: cookie, Origin: origin });
  result(viaCookie.includes(' 101 '), 'WebSocket with cookie only', viaCookie);
  const viaBasic = await upgrade({ Authorization: basic(user, password), Origin: origin });
  result(viaBasic.includes(' 101 '), 'WebSocket with password', viaBasic);
  const evil = await upgrade({ Cookie: cookie, Origin: 'https://evil.example' });
  result(evil.includes(' 403 '), 'WebSocket from other website blocked', evil);
  const anon = await upgrade({ Origin: origin });
  result(anon.includes(' 401 '), 'WebSocket without login blocked', anon);
  const forged = await upgrade({ Cookie: 'devenv_session=9999999999999.forged', Origin: origin });
  result(forged.includes(' 401 '), 'forged cookie blocked', forged);

  process.exit(failed ? 1 : 0);
})();
