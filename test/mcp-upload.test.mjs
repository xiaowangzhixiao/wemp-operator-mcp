import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createApp } from '../mcp/server.mjs';
import { createUploadStore } from '../mcp/upload-store.mjs';
import { createFileSourceResolver, isForbiddenAddress } from '../mcp/file-source.mjs';
import { runInternalTool } from '../mcp/mcp-tools.mjs';

const execFileAsync = promisify(execFile);

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function makeStore(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wemp-upload-test-'));
  return createUploadStore({ directory, ...options });
}

test('upload endpoint requires bearer token and stores one multipart file', async () => {
  const uploadStore = await makeStore();
  const app = createApp({ mcpToken: 'server-token', uploadStore });
  const server = await listen(app);
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/uploads`;

  try {
    const missing = await fetch(url, { method: 'POST', body: new FormData() });
    assert.equal(missing.status, 401);
    const wrong = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: new FormData(),
    });
    assert.equal(wrong.status, 401);

    const form = new FormData();
    form.append('file', new Blob(['hello upload'], { type: 'text/plain' }), 'hello.txt');
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer server-token' },
      body: form,
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.filename, 'hello.txt');
    assert.equal(result.mimeType, 'text/plain');
    assert.equal(result.size, 12);
    const entry = await uploadStore.resolve(result.uploadId);
    assert.equal(await readFile(entry.filePath, 'utf8'), 'hello upload');
  } finally {
    await close(server);
  }
});

test('upload endpoint rejects multiple files and oversized files', async () => {
  const uploadStore = await makeStore({ maxBytes: 5 });
  const app = createApp({ mcpToken: 'server-token', uploadStore });
  const server = await listen(app);
  const url = `http://127.0.0.1:${server.address().port}/uploads`;

  try {
    const oversized = new FormData();
    oversized.append('file', new Blob(['123456']), 'large.txt');
    const tooLarge = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer server-token' },
      body: oversized,
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).error.code, 'FILE_TOO_LARGE');

    const multiple = new FormData();
    multiple.append('file', new Blob(['1']), 'one.txt');
    multiple.append('file', new Blob(['2']), 'two.txt');
    const invalid = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer server-token' },
      body: multiple,
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_FILE_SOURCE');

    const withField = new FormData();
    withField.append('file', new Blob(['1']), 'one.txt');
    withField.append('extra', 'not-allowed');
    const unexpectedField = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer server-token' },
      body: withField,
    });
    assert.equal(unexpectedField.status, 400);
    assert.equal((await unexpectedField.json()).error.code, 'INVALID_FILE_SOURCE');
  } finally {
    await close(server);
  }
});

test('upload store enforces total quota and expires reusable upload IDs', async () => {
  let currentTime = 1_000;
  const uploadStore = await makeStore({ maxBytes: 20, totalBytes: 8, ttlSeconds: 10, now: () => currentTime });
  const first = await uploadStore.saveStream(Readable.from(['1234']), { filename: 'one.txt' });
  assert.equal((await uploadStore.resolve(first.uploadId)).filename, 'one.txt');
  assert.equal((await uploadStore.resolve(first.uploadId)).filename, 'one.txt');

  await assert.rejects(
    uploadStore.saveStream(Readable.from(['56789']), { filename: 'two.txt' }),
    (error) => error?.code === 'UPLOAD_QUOTA_EXCEEDED',
  );

  const filePath = (await uploadStore.resolve(first.uploadId)).filePath;
  currentTime += 11_000;
  await assert.rejects(uploadStore.resolve(first.uploadId), (error) => error?.code === 'UPLOAD_NOT_FOUND');
  await assert.rejects(stat(filePath));
});

test('active upload leases survive expiry until the business call releases them', async () => {
  let currentTime = 1_000;
  const uploadStore = await makeStore({ ttlSeconds: 10, now: () => currentTime });
  const uploaded = await uploadStore.saveStream(Readable.from(['leased']), { filename: 'leased.txt' });
  const lease = await uploadStore.acquire(uploaded.uploadId);
  currentTime += 11_000;
  await uploadStore.cleanupExpired();
  assert.equal(await readFile(lease.filePath, 'utf8'), 'leased');
  await lease.release();
  await assert.rejects(stat(lease.filePath));
});

test('file source resolver rejects local paths, HTTP URLs, and private networks', async () => {
  const uploadStore = await makeStore();
  const resolver = createFileSourceResolver({
    uploadStore,
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
  });

  await assert.rejects(resolver.resolve({ filePath: '/tmp/local.png' }), (error) => error?.code === 'INVALID_FILE_SOURCE');
  await assert.rejects(resolver.resolve({ url: 'http://example.com/a.png' }), (error) => error?.code === 'REMOTE_SOURCE_FORBIDDEN');
  await assert.rejects(resolver.resolve({ url: 'https://example.com/a.png' }), (error) => error?.code === 'REMOTE_SOURCE_FORBIDDEN');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:192.168.1.2']) {
    assert.equal(isForbiddenAddress(address), true, address);
  }
  assert.equal(isForbiddenAddress('8.8.8.8'), false);
});

test('run_tool reports invalid file sources with a dedicated code', async () => {
  const result = await runInternalTool({
    name: 'upload_article_image',
    arguments: { filePath: '/tmp/local.png' },
  });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_FILE_SOURCE');
});

test('file source resolver revalidates HTTPS redirects and downloads public sources', async () => {
  const uploadStore = await makeStore();
  const lookups = [];
  const requests = [];
  const resolver = createFileSourceResolver({
    uploadStore,
    lookupImpl: async (hostname) => {
      lookups.push(hostname);
      return [{ address: '8.8.8.8', family: 4 }];
    },
    requestImpl: async (url, filePath) => {
      requests.push(String(url));
      if (requests.length === 1) return { redirect: 'https://cdn.example.com/final.png' };
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, 'REMOTE_BYTES');
      return { size: 12, mimeType: 'image/png' };
    },
  });

  const resolved = await resolver.resolve({ url: 'https://example.com/start', filename: 'remote.png' });
  assert.deepEqual(lookups, ['example.com', 'cdn.example.com']);
  assert.deepEqual(requests, ['https://example.com/start', 'https://cdn.example.com/final.png']);
  assert.equal(await readFile(resolved.filePath, 'utf8'), 'REMOTE_BYTES');
  await resolved.cleanup();
  await assert.rejects(stat(resolved.filePath));
});

test('file source resolver rejects redirects to private networks', async () => {
  const uploadStore = await makeStore();
  const resolver = createFileSourceResolver({
    uploadStore,
    lookupImpl: async (hostname) => hostname === 'example.com'
      ? [{ address: '8.8.8.8', family: 4 }]
      : [{ address: '169.254.169.254', family: 4 }],
    requestImpl: async () => ({ redirect: 'https://metadata.example/latest' }),
  });

  await assert.rejects(
    resolver.resolve({ url: 'https://example.com/start' }),
    (error) => error?.code === 'REMOTE_SOURCE_FORBIDDEN',
  );
});

test('file media tools resolve uploadId and send original bytes to WeChat', async () => {
  const uploadStore = await makeStore();
  const uploaded = await uploadStore.saveStream(Readable.from(['IMAGE_BYTES']), {
    filename: 'cover.png',
    mimeType: 'image/png',
  });
  const resolver = createFileSourceResolver({ uploadStore });
  const originalFetch = globalThis.fetch;
  let bodyText = '';
  globalThis.fetch = async (_url, options) => {
    bodyText = Buffer.from(options.body).toString('utf8');
    return new Response(JSON.stringify({ url: 'https://mmbiz.qpic.cn/test' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await runInternalTool({
      name: 'upload_article_image',
      arguments: { source: { uploadId: uploaded.uploadId } },
    }, {
      tokenManager: { getAccessToken: async () => 'TOKEN', getRedactionSecrets: () => [] },
      fileSourceResolver: resolver,
    });
    assert.equal(result.success, true);
    assert.equal(bodyText.includes('IMAGE_BYTES'), true);
    assert.equal(bodyText.includes('filename="cover.png"'), true);
    assert.equal((await uploadStore.resolve(uploaded.uploadId)).size, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('temporary and permanent media tools resolve uploadId and send original bytes', async () => {
  const uploadStore = await makeStore();
  const uploaded = await uploadStore.saveStream(Readable.from(['MEDIA_BYTES']), {
    filename: 'media.png',
    mimeType: 'image/png',
  });
  const resolver = createFileSourceResolver({ uploadStore });
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    bodies.push(Buffer.from(options.body).toString('utf8'));
    const response = String(url).includes('/material/add_material')
      ? { media_id: 'permanent-id', url: 'https://example.com/media' }
      : { type: 'image', media_id: 'temporary-id', created_at: 123 };
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const commonOptions = {
      tokenManager: { getAccessToken: async () => 'TOKEN', getRedactionSecrets: () => [] },
      fileSourceResolver: resolver,
    };
    const temporary = await runInternalTool({
      name: 'upload_temp_media',
      arguments: { source: { uploadId: uploaded.uploadId }, type: 'image' },
    }, commonOptions);
    const permanent = await runInternalTool({
      name: 'upload_permanent_media',
      arguments: { source: { uploadId: uploaded.uploadId }, type: 'image' },
    }, commonOptions);
    assert.equal(temporary.success, true);
    assert.equal(permanent.success, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies.every((body) => body.includes('MEDIA_BYTES')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create_draft_from_file reads uploaded Markdown through the resolver', async () => {
  const uploadStore = await makeStore();
  const uploaded = await uploadStore.saveStream(Readable.from(['---\ntitle: Uploaded title\n---\nHello body']), {
    filename: 'article.md',
    mimeType: 'text/markdown',
  });
  const resolver = createFileSourceResolver({ uploadStore });
  let requestBody;
  const tokenManager = {
    getAccessToken: async () => 'TOKEN',
    getRedactionSecrets: () => [],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ media_id: 'draft-id' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };

  const result = await runInternalTool({
    name: 'create_draft_from_file',
    arguments: { source: { uploadId: uploaded.uploadId } },
  }, { tokenManager, fileSourceResolver: resolver });

  assert.equal(result.success, true);
  assert.equal(result.data.title, 'Uploaded title');
  assert.equal(requestBody.articles[0].content, 'Hello body');
});

test('skill upload helper sends a local file to the upload endpoint', async () => {
  const uploadStore = await makeStore();
  const app = createApp({ mcpToken: 'server-token', uploadStore });
  const server = await listen(app);
  const localDirectory = await mkdtemp(join(tmpdir(), 'wemp-upload-helper-'));
  const localPath = join(localDirectory, 'helper.txt');
  await writeFile(localPath, 'HELPER_BYTES');

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'skills/wemp-operator-mcp/scripts/upload-file.mjs',
      localPath,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WEMP_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`,
        WEMP_MCP_TOKEN: 'server-token',
      },
    });
    const result = JSON.parse(stdout);
    const entry = await uploadStore.resolve(result.uploadId);
    assert.equal(await readFile(entry.filePath, 'utf8'), 'HELPER_BYTES');
  } finally {
    await close(server);
  }
});
