import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:1',
  DB_NAME: 'unit',
  JWT_SECRET: 'unit-admin-signing-secret',
  WIDGET_JWT_SECRET: 'unit-widget-signing-secret',
  SITE_LOGIN: 'unit-login',
  SITE_PASSWORD: 'unit-password',
  SITE_JWT_SECRET: 'unit-site-signing-secret',
});
const { createApp } = await import('./app.js');
const { buildWidgetAuthResponse } = await import('./widgetAuth.js');
const { LONG_TIMEOUT_AGENT } = await import('./config.js');
let server;
let base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await LONG_TIMEOUT_AGENT.close();
});

test('widget static document retains iframe CSP', async () => {
  const response = await fetch(`${base}/widget.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(await response.text(), /widget/i);
});

test('chat and admin endpoints reject missing tokens before database access', async () => {
  for (const endpoint of ['/api/chat/history', '/api/admin/accounts']) {
    const response = await fetch(`${base}${endpoint}`);
    assert.equal(response.status, 401, endpoint);
  }
});

test('admin host restriction applies before route handling', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = request(
      `${base}/api/admin/accounts`,
      { headers: { Host: 'untrusted.example' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      }
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('widget tokens enforce user ownership before database access', async () => {
  const { widgetToken: token } = buildWidgetAuthResponse('owner');
  const response = await fetch(`${base}/api/chat/history?userId=other`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 403);
});

test('site login and verification preserve token scope', async () => {
  const login = await fetch(`${base}/api/site/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'unit-login', password: 'unit-password' }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const verify = await fetch(`${base}/api/site/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(verify.status, 200);
  const admin = await fetch(`${base}/api/admin/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(admin.status, 401);
});
