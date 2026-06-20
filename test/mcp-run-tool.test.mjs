import test from 'node:test';
import assert from 'node:assert/strict';

import { runInternalTool } from '../mcp/mcp-tools.mjs';
import { createWechatTokenManager } from '../mcp/wechat-token-manager.mjs';
import { getUserSummary, runWithWechatAuth } from '../scripts/lib/utils.mjs';

test('pure tools run without uploaded WeChat access token', async () => {
  const result = await runInternalTool({
    name: 'get_qrcode_image_url',
    arguments: { ticket: 'hello world' },
  });

  assert.equal(result.success, true);
  assert.equal(result.data, 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=hello%20world');
});

test('run_tool rejects uploaded WeChat access tokens', async () => {
  const result = await runInternalTool({
    name: 'get_user_summary',
    arguments: { date: '2026-05-27' },
    wechat: { accessToken: 'CLIENT_UPLOADED_TOKEN' },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_REQUEST');
});

test('WeChat tools require server-side AppID/AppSecret configuration', async () => {
  const tokenManager = createWechatTokenManager({
    appId: '',
    appSecret: '',
  });

  const result = await runInternalTool({
    name: 'get_user_summary',
    arguments: { date: '2026-05-27' },
  }, { tokenManager });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WECHAT_SERVER_AUTH_NOT_CONFIGURED');
});

test('MCP auth context never falls back to local AppID/AppSecret config', async () => {
  await assert.rejects(
    runWithWechatAuth({ forbidLocalConfig: true }, () => getUserSummary('2026-05-27')),
    (error) => error?.code === 'WECHAT_AUTH_REQUIRED',
  );
});

test('WeChat tools fetch server-side access token and use it for business API calls', async () => {
  const calls = [];
  const tokenManager = createWechatTokenManager({
    appId: 'wx_app',
    appSecret: 'SERVER_SECRET',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/cgi-bin/token?')) {
        return new Response(JSON.stringify({
          access_token: 'SERVER_ACCESS_TOKEN',
          expires_in: 7200,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ list: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await runInternalTool({
    name: 'get_user_summary',
    arguments: { date: '2026-05-27' },
  }, { tokenManager });

  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.includes('/cgi-bin/token?grant_type=client_credential'), true);
  assert.equal(calls[0].url.includes('appid=wx_app'), true);
  assert.equal(calls[0].url.includes('secret=SERVER_SECRET'), true);
  assert.equal(calls[1].url.includes('/datacube/getusersummary'), true);
  assert.equal(calls[1].url.includes('access_token=SERVER_ACCESS_TOKEN'), true);
});

test('server-side access token is cached until it nears expiry', async () => {
  const calls = [];
  const tokenManager = createWechatTokenManager({
    appId: 'wx_app',
    appSecret: 'SERVER_SECRET',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/cgi-bin/token?')) {
        return new Response(JSON.stringify({
          access_token: 'CACHED_SERVER_TOKEN',
          expires_in: 7200,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ list: [] }), { headers: { 'Content-Type': 'application/json' } });
    },
  });

  await runInternalTool({ name: 'get_user_summary', arguments: { date: '2026-05-27' } }, { tokenManager });
  await runInternalTool({ name: 'get_user_summary', arguments: { date: '2026-05-28' } }, { tokenManager });

  assert.equal(calls.filter((url) => url.includes('/cgi-bin/token?')).length, 1);
  assert.equal(calls.filter((url) => url.includes('/datacube/getusersummary')).length, 2);
});

test('concurrent server-side token refresh uses a single token request', async () => {
  const calls = [];
  let releaseTokenResponse;
  const tokenResponseReady = new Promise((resolve) => { releaseTokenResponse = resolve; });
  const tokenManager = createWechatTokenManager({
    appId: 'wx_app',
    appSecret: 'SERVER_SECRET',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/cgi-bin/token?')) {
        await tokenResponseReady;
        return new Response(JSON.stringify({
          access_token: 'SINGLE_FLIGHT_TOKEN',
          expires_in: 7200,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ list: [] }), { headers: { 'Content-Type': 'application/json' } });
    },
  });

  const first = runInternalTool({ name: 'get_user_summary', arguments: { date: '2026-05-27' } }, { tokenManager });
  const second = runInternalTool({ name: 'get_user_summary', arguments: { date: '2026-05-28' } }, { tokenManager });
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseTokenResponse();
  await Promise.all([first, second]);

  assert.equal(calls.filter((url) => url.includes('/cgi-bin/token?')).length, 1);
});

test('invalid business API token refreshes once and retries', async () => {
  const calls = [];
  let tokenIndex = 0;
  const tokens = ['EXPIRED_TOKEN', 'REFRESHED_TOKEN'];
  const tokenManager = createWechatTokenManager({
    appId: 'wx_app',
    appSecret: 'SERVER_SECRET',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/cgi-bin/token?')) {
        const token = tokens[tokenIndex++];
        return new Response(JSON.stringify({ access_token: token, expires_in: 7200 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (String(url).includes('access_token=EXPIRED_TOKEN')) {
        return new Response(JSON.stringify({ errcode: 40001, errmsg: 'invalid credential' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ list: [] }), { headers: { 'Content-Type': 'application/json' } });
    },
  });

  const result = await runInternalTool({
    name: 'get_user_summary',
    arguments: { date: '2026-05-27' },
  }, { tokenManager });

  assert.equal(result.success, true);
  assert.equal(calls.filter((url) => url.includes('/cgi-bin/token?')).length, 2);
  assert.equal(calls.some((url) => url.includes('access_token=REFRESHED_TOKEN')), true);
});

test('run_tool redacts server-side AppSecret and access_token from error output', async () => {
  const tokenManager = createWechatTokenManager({
    appId: 'wx_app',
    appSecret: 'SERVER/SECRET+',
    fetchImpl: async (url) => {
      if (String(url).includes('/cgi-bin/token?')) {
        return new Response(JSON.stringify({
          access_token: 'SERVER_SIDE_SECRET_TOKEN',
          expires_in: 7200,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        errcode: 40013,
        errmsg: `bad SERVER/SECRET+ ${encodeURIComponent('SERVER/SECRET+')} SERVER_SIDE_SECRET_TOKEN`,
      }), { headers: { 'Content-Type': 'application/json' } });
    },
  });

  const result = await runInternalTool({
    name: 'get_user_summary',
    arguments: { date: '2026-05-27' },
  }, { tokenManager, mcpToken: 'MCP_SECRET_TOKEN' });

  const serialized = JSON.stringify(result);
  assert.equal(result.success, false);
  assert.equal(serialized.includes('SERVER/SECRET+'), false);
  assert.equal(serialized.includes(encodeURIComponent('SERVER/SECRET+')), false);
  assert.equal(serialized.includes('SERVER_SIDE_SECRET_TOKEN'), false);
  assert.equal(serialized.includes('MCP_SECRET_TOKEN'), false);
  assert.equal(serialized.includes('[REDACTED]'), true);
});

test('dangerous tools are disabled unless explicitly enabled', async () => {
  const disabled = await runInternalTool({
    name: 'publish_draft',
    arguments: { mediaId: 'draft_media_id' },
  }, { dangerousToolsEnabled: false });

  assert.equal(disabled.success, false);
  assert.equal(disabled.error.code, 'TOOL_DISABLED');

  const tokenManager = createWechatTokenManager({
    appId: 'wx_app',
    appSecret: 'SERVER_SECRET',
    fetchImpl: async (url) => {
      if (String(url).includes('/cgi-bin/token?')) {
        return new Response(JSON.stringify({ access_token: 'PUBLISH_TOKEN', expires_in: 7200 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ publish_id: 'publish_123' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const enabled = await runInternalTool({
    name: 'publish_draft',
    arguments: { mediaId: 'draft_media_id' },
  }, { tokenManager, dangerousToolsEnabled: true });

  assert.equal(enabled.success, true);
  assert.equal(enabled.data.publishId, 'publish_123');
});
