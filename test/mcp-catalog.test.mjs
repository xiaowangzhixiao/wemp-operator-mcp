import test from 'node:test';
import assert from 'node:assert/strict';

import * as utils from '../scripts/lib/utils.mjs';
import { getInternalTools, searchInternalTools } from '../mcp/catalog.mjs';
import { getPublicToolNames } from '../mcp/mcp-tools.mjs';

const helperExports = new Set([
  'calcChangeRate',
  'formatDate',
  'getDataPath',
  'getDaysAgo',
  'getYesterday',
  'loadConfig',
  'output',
  'outputError',
  'parseArgs',
  'readData',
  'runWithWechatAuth',
  'writeData',
]);

test('MCP only exposes tool_search and run_tool publicly', () => {
  assert.deepEqual(getPublicToolNames().sort(), ['run_tool', 'tool_search']);
});

test('internal catalog covers every WeChat business API export', () => {
  const exportedBusinessApis = Object.keys(utils)
    .filter((name) => !helperExports.has(name))
    .sort();
  assert.equal(exportedBusinessApis.length, 71);

  const catalog = getInternalTools();
  const mappedApiExports = catalog
    .filter((tool) => tool.kind === 'wechat_api')
    .map((tool) => tool.handler)
    .sort();

  assert.deepEqual(mappedApiExports, exportedBusinessApis);
});

test('internal catalog does not expose initialization or appSecret arguments', () => {
  const catalog = getInternalTools();
  const serialized = JSON.stringify(catalog);

  assert.equal(catalog.some((tool) => tool.name.includes('init')), false);
  assert.equal(serialized.includes('appSecret'), false);
  assert.equal(serialized.includes('app-secret'), false);
});

test('file tools expose source uploadId or URL and never expose server filePath', () => {
  const fileTools = getInternalTools().filter((tool) => [
    'upload_temp_media',
    'upload_permanent_media',
    'upload_article_image',
    'create_draft_from_file',
  ].includes(tool.name));

  assert.equal(fileTools.length, 4);
  for (const tool of fileTools) {
    const serialized = JSON.stringify(tool.parameters);
    assert.equal(serialized.includes('filePath'), false, tool.name);
    assert.equal(tool.parameters.properties.source.oneOf.length, 2, tool.name);
    assert.equal(serialized.includes('uploadId'), true, tool.name);
    assert.equal(serialized.includes('url'), true, tool.name);
  }
});

test('tool_search finds API and workflow tools with WeChat auth metadata', () => {
  const userSummary = searchInternalTools({ query: '用户增长 get user summary', limit: 10 });
  assert.equal(userSummary.some((tool) => tool.name === 'get_user_summary' && tool.requiresWechatAuth), true);

  const smartCollect = searchInternalTools({ query: '智能采集 smart collect', limit: 10 });
  assert.equal(smartCollect.some((tool) => tool.name === 'smart_collect_news' && !tool.requiresWechatAuth), true);

  const dailyReport = searchInternalTools({ query: '公众号日报 daily report', limit: 10 });
  assert.equal(dailyReport.some((tool) => tool.name === 'daily_report' && tool.requiresWechatAuth), true);
});

test('tool_search marks dangerous tools disabled by default', () => {
  const publishTools = searchInternalTools({ query: 'publish draft', limit: 10, dangerousToolsEnabled: false });
  const publishDraft = publishTools.find((tool) => tool.name === 'publish_draft');

  assert.equal(publishDraft?.dangerous, true);
  assert.equal(typeof publishDraft?.disabledReason, 'string');

  const enabledTools = searchInternalTools({ query: 'publish draft', limit: 10, dangerousToolsEnabled: true });
  const enabledPublishDraft = enabledTools.find((tool) => tool.name === 'publish_draft');
  assert.equal(enabledPublishDraft?.disabledReason, undefined);
});
