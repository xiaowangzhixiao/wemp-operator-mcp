#!/usr/bin/env node
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerMcpTools } from './mcp-tools.mjs';
import { createWechatTokenManager } from './wechat-token-manager.mjs';
import { createUploadStore } from './upload-store.mjs';
import { createFileSourceResolver } from './file-source.mjs';
import { createUploadHandler } from './upload-http.mjs';

const __filename = fileURLToPath(import.meta.url);

function hasBearerToken(header, expectedToken) {
  if (!header || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function requireBearerToken(expectedToken) {
  return (req, res, next) => {
    if (!hasBearerToken(req.headers.authorization, expectedToken)) {
      res.status(401).json({
        error: 'unauthorized',
      });
      return;
    }
    next();
  };
}

export function buildMcpServer(options = {}) {
  const server = new McpServer({
    name: 'wemp-operator-mcp',
    version: '1.0.0',
  });
  registerMcpTools(server, options);
  return server;
}

export function createApp({
  mcpToken,
  host = '127.0.0.1',
  allowedHosts,
  tokenManager,
  dangerousToolsEnabled,
  uploadStore,
  fileSourceResolver,
} = {}) {
  if (!mcpToken) {
    throw new Error('WEMP_MCP_TOKEN is required to start the MCP server');
  }

  const runtimeTokenManager = tokenManager || createWechatTokenManager();
  const runtimeUploadStore = uploadStore || createUploadStore();
  const runtimeFileSourceResolver = fileSourceResolver || createFileSourceResolver({ uploadStore: runtimeUploadStore });
  const runtimeOptions = {
    tokenManager: runtimeTokenManager,
    mcpToken,
    dangerousToolsEnabled,
    fileSourceResolver: runtimeFileSourceResolver,
  };
  const app = createMcpExpressApp({ host, allowedHosts });
  runtimeUploadStore.initialize().catch((error) => {
    console.error('[wemp-mcp] upload store initialization failed:', error?.message || String(error));
  });
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/uploads', requireBearerToken(mcpToken), createUploadHandler(runtimeUploadStore));
  app.use('/mcp', requireBearerToken(mcpToken));

  app.post('/mcp', async (req, res) => {
    const server = buildMcpServer(runtimeOptions);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('[wemp-mcp] request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  return app;
}

export function startServer({
  host = process.env.WEMP_MCP_HOST || '127.0.0.1',
  port = Number(process.env.WEMP_MCP_PORT || 3333),
  mcpToken = process.env.WEMP_MCP_TOKEN,
  tokenManager,
  dangerousToolsEnabled = process.env.WEMP_MCP_ENABLE_DANGEROUS_TOOLS === '1',
  allowedHosts,
} = {}) {
  const app = createApp({ mcpToken, host, allowedHosts, tokenManager, dangerousToolsEnabled });
  const server = app.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.error(`[wemp-mcp] listening on http://${host}:${actualPort}/mcp`);
  });
  return server;
}

if (process.argv[1] === __filename) {
  startServer();
}
