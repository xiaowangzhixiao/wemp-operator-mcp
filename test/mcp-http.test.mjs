import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../mcp/server.mjs';

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('createApp requires an MCP bearer token', () => {
  assert.throws(() => createApp({ mcpToken: '' }), /WEMP_MCP_TOKEN/);
});

test('HTTP MCP endpoint rejects missing or invalid bearer tokens', async () => {
  const app = createApp({ mcpToken: 'server-token' });
  const server = await listen(app);
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/mcp`;

  try {
    const missing = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(missing.status, 401);

    const invalid = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(invalid.status, 401);
  } finally {
    await close(server);
  }
});

test('health endpoint is available without MCP bearer token', async () => {
  const app = createApp({ mcpToken: 'server-token' });
  const server = await listen(app);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await close(server);
  }
});
