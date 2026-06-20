import { z } from 'zod';
import {
  findInternalTool,
  searchInternalTools,
  validateToolArguments,
} from './catalog.mjs';
import { invokeWechatApiTool } from './tool-handlers.mjs';
import { invokeWorkflowTool } from './workflow-handlers.mjs';
import { createWechatTokenManager } from './wechat-token-manager.mjs';

const PUBLIC_TOOL_NAMES = ['tool_search', 'run_tool'];

const runToolRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.any()).optional().default({}),
}).strict();

const searchRequestSchema = z.object({
  query: z.string().optional().default(''),
  category: z.string().optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict();

function redactor(secrets) {
  const filteredSecrets = secrets.filter((secret) => typeof secret === 'string' && secret.length > 0);
  return (value) => {
    let text = String(value);
    for (const secret of filteredSecrets) {
      text = text.split(secret).join('[REDACTED]');
    }
    return text;
  };
}

function serializeValidationError(error) {
  if (error?.issues) {
    return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
  }
  return error?.message || String(error);
}

function errorResult(code, message) {
  return {
    success: false,
    error: { code, message },
  };
}

function successResult(data) {
  return { success: true, data };
}

function dangerousToolsEnabledFromEnv() {
  return process.env.WEMP_MCP_ENABLE_DANGEROUS_TOOLS === '1';
}

function defaultTokenManager() {
  return createWechatTokenManager();
}

function redactionSecrets(options = {}) {
  return [
    options.mcpToken,
    ...(options.tokenManager?.getRedactionSecrets?.() || []),
  ];
}

export function getPublicToolNames() {
  return [...PUBLIC_TOOL_NAMES];
}

export function toolSearch(input = {}, options = {}) {
  const request = searchRequestSchema.parse(input);
  return {
    tools: searchInternalTools({
      ...request,
      dangerousToolsEnabled: options.dangerousToolsEnabled ?? dangerousToolsEnabledFromEnv(),
    }),
  };
}

export async function runInternalTool(input = {}, options = {}) {
  let request;
  try {
    request = runToolRequestSchema.parse(input);
  } catch (error) {
    return errorResult('INVALID_REQUEST', serializeValidationError(error));
  }

  const tokenManager = options.tokenManager || defaultTokenManager();
  const dangerousToolsEnabled = options.dangerousToolsEnabled ?? dangerousToolsEnabledFromEnv();
  const redact = (value) => redactor(redactionSecrets({ ...options, tokenManager }))(value);
  const tool = findInternalTool(request.name);
  if (!tool) {
    return errorResult('TOOL_NOT_FOUND', `Unknown internal tool: ${request.name}`);
  }

  if (tool.dangerous && !dangerousToolsEnabled) {
    return errorResult('TOOL_DISABLED', 'Dangerous tool disabled by default; set WEMP_MCP_ENABLE_DANGEROUS_TOOLS=1 to enable it');
  }

  let args;
  try {
    args = validateToolArguments(tool, request.arguments);
  } catch (error) {
    const code = tool.fileSourceParam ? 'INVALID_FILE_SOURCE' : 'INVALID_ARGUMENTS';
    return errorResult(code, redact(serializeValidationError(error)));
  }

  try {
    const data = tool.kind === 'wechat_api'
      ? await invokeWechatApiTool(tool, args, tokenManager, options.fileSourceResolver)
      : await invokeWorkflowTool(tool, args, tokenManager, options.fileSourceResolver);
    return successResult(data);
  } catch (error) {
    return errorResult(error?.code || 'TOOL_ERROR', redact(error?.message || String(error)));
  }
}

function jsonContent(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function registerMcpTools(server, options = {}) {
  server.registerTool('tool_search', {
    title: 'Search internal wemp-operator tools',
    description: 'Search the internal WeChat official account API and workflow catalog.',
    inputSchema: {
      query: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async (input) => jsonContent(toolSearch(input, options)));

  server.registerTool('run_tool', {
    title: 'Run one internal wemp-operator tool',
    description: 'Run a searched internal tool by name. WeChat operations use server-side WEMP_WECHAT_APP_ID and WEMP_WECHAT_APP_SECRET.',
    inputSchema: {
      name: z.string().min(1),
      arguments: z.record(z.any()).optional(),
    },
  }, async (input) => jsonContent(await runInternalTool(input, options)));
}
