import { z } from 'zod';

function param(name, type, options = {}) {
  return {
    name,
    type,
    required: options.required !== false,
    defaultValue: options.defaultValue,
    description: options.description || '',
    itemType: options.itemType,
    nullable: options.nullable === true,
  };
}

function schemaForParam(definition) {
  let schema;
  switch (definition.type) {
    case 'string':
      schema = z.string();
      break;
    case 'number':
      schema = z.coerce.number();
      break;
    case 'boolean':
      schema = z.coerce.boolean();
      break;
    case 'array':
      schema = z.array(definition.itemType === 'string' ? z.string() : z.any());
      break;
    case 'object':
      schema = z.record(z.any());
      break;
    case 'fileSource':
      schema = z.union([
        z.object({ uploadId: z.string().uuid() }).strict(),
        z.object({ url: z.string().url(), filename: z.string().optional() }).strict(),
      ]);
      break;
    case 'any':
      schema = z.any();
      break;
    default:
      throw new Error(`Unsupported parameter type: ${definition.type}`);
  }

  if (definition.nullable) schema = schema.nullable();
  if (definition.defaultValue !== undefined) return schema.default(definition.defaultValue);
  if (!definition.required) return schema.optional();
  return schema;
}

function buildSchema(params) {
  const shape = {};
  for (const definition of params) {
    shape[definition.name] = schemaForParam(definition);
  }
  return z.object(shape).strict();
}

function jsonSchemaForParam(definition) {
  if (definition.type === 'fileSource') {
    return {
      description: definition.description,
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { uploadId: { type: 'string', format: 'uuid' } },
          required: ['uploadId'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', format: 'uri', description: 'Public HTTPS URL' },
            filename: { type: 'string', description: 'Optional filename override' },
          },
          required: ['url'],
        },
      ],
    };
  }
  const schema = {};
  if (definition.type !== 'any') schema.type = definition.type;
  if (definition.type === 'array') {
    schema.items = definition.itemType ? { type: definition.itemType } : {};
  }
  if (definition.nullable) schema.nullable = true;
  if (definition.defaultValue !== undefined) schema.default = definition.defaultValue;
  if (definition.description) schema.description = definition.description;
  return schema;
}

function buildJsonSchema(params) {
  const properties = {};
  const required = [];
  for (const definition of params) {
    properties[definition.name] = jsonSchemaForParam(definition);
    if (definition.required && definition.defaultValue === undefined) required.push(definition.name);
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function makeTool(definition) {
  const params = definition.params || [];
  const dangerous = definition.dangerous === true || isDangerousTool(definition);
  return {
    ...definition,
    dangerous,
    keywords: definition.keywords || [],
    params,
    parameters: buildJsonSchema(params),
    schema: buildSchema(params),
  };
}

function isDangerousTool(definition) {
  const name = definition.name || '';
  const handler = definition.handler || '';
  const category = definition.category || '';
  return definition.effect === 'delete'
    || category === 'wechat_mass_message'
    || name.includes('publish')
    || handler.includes('Publish')
    || name.includes('blacklist')
    || handler.includes('Blacklist');
}

function apiTool(name, handler, category, description, params = [], options = {}) {
  return makeTool({
    name,
    kind: 'wechat_api',
    handler,
    category,
    title: options.title || name,
    description,
    effect: options.effect || 'read',
    requiresWechatAuth: options.requiresWechatAuth !== false,
    params,
    keywords: [handler, ...(options.keywords || [])],
    fileSourceParam: options.fileSourceParam,
  });
}

function workflowTool(name, handler, category, description, params = [], options = {}) {
  return makeTool({
    name,
    kind: 'workflow',
    handler,
    category,
    title: options.title || name,
    description,
    effect: options.effect || 'write',
    requiresWechatAuth: options.requiresWechatAuth === true,
    params,
    keywords: options.keywords || [],
    fileSourceParam: options.fileSourceParam,
  });
}

const date = (name = 'date') => param(name, 'string', { description: 'Date in YYYY-MM-DD format' });
const str = (name, description = '') => param(name, 'string', { description });
const optStr = (name, defaultValue = '', description = '') => param(name, 'string', { required: false, defaultValue, description });
const num = (name, defaultValue, description = '') => param(name, 'number', { required: false, defaultValue, description });
const reqNum = (name, description = '') => param(name, 'number', { description });
const bool = (name, defaultValue = false, description = '') => param(name, 'boolean', { required: false, defaultValue, description });
const arr = (name, description = '', itemType) => param(name, 'array', { description, itemType });
const optArr = (name, defaultValue = [], description = '', itemType) => param(name, 'array', { required: false, defaultValue, description, itemType });
const obj = (name, description = '') => param(name, 'object', { description });
const optObj = (name, defaultValue = {}, description = '') => param(name, 'object', { required: false, defaultValue, description });
const optNullableObj = (name, defaultValue = null, description = '') => param(name, 'object', { required: false, defaultValue, nullable: true, description });
const anyValue = (name, description = '') => param(name, 'any', { description });
const fileSource = () => param('source', 'fileSource', {
  description: 'Remote file source: use uploadId from POST /uploads or a public HTTPS URL',
});

const TOOLS = [
  apiTool('get_user_summary', 'getUserSummary', 'wechat_analytics', 'Get user growth summary for one day.', [date()]),
  apiTool('get_user_cumulate', 'getUserCumulate', 'wechat_analytics', 'Get cumulative user data for a date range.', [date('beginDate'), date('endDate')]),
  apiTool('get_article_summary', 'getArticleSummary', 'wechat_analytics', 'Get article summary metrics for one day.', [date()]),
  apiTool('get_article_total', 'getArticleTotal', 'wechat_analytics', 'Get article total metrics for one day.', [date()]),
  apiTool('get_user_read', 'getUserRead', 'wechat_analytics', 'Get user read metrics for one day.', [date()]),
  apiTool('get_user_share', 'getUserShare', 'wechat_analytics', 'Get user share metrics for one day.', [date()]),
  apiTool('get_upstream_msg', 'getUpstreamMsg', 'wechat_analytics', 'Get upstream message metrics for one day.', [date()]),
  apiTool('get_upstream_msg_hour', 'getUpstreamMsgHour', 'wechat_analytics', 'Get hourly upstream message metrics for one day.', [date()]),

  apiTool('add_draft', 'addDraft', 'wechat_draft', 'Create a WeChat draft from article objects.', [arr('articles', 'WeChat article objects')], { effect: 'write' }),
  apiTool('update_draft', 'updateDraft', 'wechat_draft', 'Update one article in an existing draft.', [str('mediaId'), reqNum('index'), obj('article')], { effect: 'write' }),
  apiTool('get_draft', 'getDraft', 'wechat_draft', 'Get a draft by media ID.', [str('mediaId')]),
  apiTool('list_drafts', 'listDrafts', 'wechat_draft', 'List WeChat drafts.', [num('offset', 0), num('count', 20)]),
  apiTool('delete_draft', 'deleteDraft', 'wechat_draft', 'Delete a draft by media ID.', [str('mediaId')], { effect: 'delete' }),
  apiTool('get_draft_count', 'getDraftCount', 'wechat_draft', 'Get the draft count.'),

  apiTool('publish_draft', 'publishDraft', 'wechat_publish', 'Submit a draft for publishing.', [str('mediaId')], { effect: 'write' }),
  apiTool('get_publish_status', 'getPublishStatus', 'wechat_publish', 'Get publish status by publish ID.', [str('publishId')]),
  apiTool('list_published', 'listPublished', 'wechat_publish', 'List published articles.', [num('offset', 0), num('count', 20)]),
  apiTool('get_published_article', 'getPublishedArticle', 'wechat_publish', 'Get published article details.', [str('articleId')]),
  apiTool('delete_published', 'deletePublished', 'wechat_publish', 'Delete a published article.', [str('articleId'), num('index', 0)], { effect: 'delete' }),

  apiTool('list_comments', 'listComments', 'wechat_comment', 'List article comments.', [str('msgDataId'), num('index', 0), num('begin', 0), num('count', 50), num('type', 0)]),
  apiTool('reply_comment', 'replyComment', 'wechat_comment', 'Reply to a comment.', [str('msgDataId'), reqNum('index'), reqNum('userCommentId'), str('content')], { effect: 'write' }),
  apiTool('delete_comment_reply', 'deleteCommentReply', 'wechat_comment', 'Delete a comment reply.', [str('msgDataId'), reqNum('index'), reqNum('userCommentId')], { effect: 'delete' }),
  apiTool('elect_comment', 'electComment', 'wechat_comment', 'Mark a comment as selected.', [str('msgDataId'), reqNum('index'), reqNum('userCommentId')], { effect: 'write' }),
  apiTool('unelect_comment', 'unelectComment', 'wechat_comment', 'Unmark a selected comment.', [str('msgDataId'), reqNum('index'), reqNum('userCommentId')], { effect: 'write' }),
  apiTool('delete_comment', 'deleteComment', 'wechat_comment', 'Delete a comment.', [str('msgDataId'), reqNum('index'), reqNum('userCommentId')], { effect: 'delete' }),
  apiTool('open_comment', 'openComment', 'wechat_comment', 'Open comments for an article.', [str('msgDataId'), num('index', 0)], { effect: 'write' }),
  apiTool('close_comment', 'closeComment', 'wechat_comment', 'Close comments for an article.', [str('msgDataId'), num('index', 0)], { effect: 'write' }),

  apiTool('get_user_info', 'getUserInfo', 'wechat_user', 'Get follower information.', [str('openId')]),
  apiTool('batch_get_user_info', 'batchGetUserInfo', 'wechat_user', 'Get follower information in batch.', [arr('openIds', 'OpenID list', 'string')]),
  apiTool('get_followers', 'getFollowers', 'wechat_user', 'List followers.', [optStr('nextOpenId')]),
  apiTool('set_user_remark', 'setUserRemark', 'wechat_user', 'Set a follower remark.', [str('openId'), str('remark')], { effect: 'write' }),
  apiTool('get_blacklist', 'getBlacklist', 'wechat_user', 'List blacklisted followers.', [optStr('beginOpenId')]),
  apiTool('batch_blacklist_users', 'batchBlacklistUsers', 'wechat_user', 'Add followers to blacklist.', [arr('openIds', 'OpenID list', 'string')], { effect: 'write' }),
  apiTool('batch_unblacklist_users', 'batchUnblacklistUsers', 'wechat_user', 'Remove followers from blacklist.', [arr('openIds', 'OpenID list', 'string')], { effect: 'write' }),

  apiTool('create_tag', 'createTag', 'wechat_tag', 'Create a follower tag.', [str('name')], { effect: 'write' }),
  apiTool('get_tags', 'getTags', 'wechat_tag', 'List follower tags.'),
  apiTool('update_tag', 'updateTag', 'wechat_tag', 'Update a follower tag.', [reqNum('tagId'), str('name')], { effect: 'write' }),
  apiTool('delete_tag', 'deleteTag', 'wechat_tag', 'Delete a follower tag.', [reqNum('tagId')], { effect: 'delete' }),
  apiTool('batch_tag_users', 'batchTagUsers', 'wechat_tag', 'Apply a tag to followers.', [reqNum('tagId'), arr('openIds', 'OpenID list', 'string')], { effect: 'write' }),
  apiTool('batch_untag_users', 'batchUntagUsers', 'wechat_tag', 'Remove a tag from followers.', [reqNum('tagId'), arr('openIds', 'OpenID list', 'string')], { effect: 'write' }),
  apiTool('get_user_tags', 'getUserTags', 'wechat_tag', 'Get tags for one follower.', [str('openId')]),
  apiTool('get_tag_users', 'getTagUsers', 'wechat_tag', 'List followers under a tag.', [reqNum('tagId'), optStr('nextOpenId')]),

  apiTool('get_templates', 'getTemplates', 'wechat_template', 'List private templates.'),
  apiTool('add_template', 'addTemplate', 'wechat_template', 'Add a template.', [str('templateIdShort'), optArr('keywordIds', [], 'Keyword ID list')], { effect: 'write' }),
  apiTool('delete_template', 'deleteTemplate', 'wechat_template', 'Delete a template.', [str('templateId')], { effect: 'delete' }),
  apiTool('send_template_message', 'sendTemplateMessage', 'wechat_template', 'Send a template message.', [str('openId'), str('templateId'), obj('data'), optStr('url'), optNullableObj('miniprogram')], { effect: 'write' }),
  apiTool('get_industry', 'getIndustry', 'wechat_template', 'Get account industry settings.'),

  apiTool('upload_temp_media', 'uploadTempMedia', 'wechat_media', 'Upload temporary media from an uploaded file or public HTTPS URL.', [fileSource(), optStr('type', 'image')], { effect: 'write', fileSourceParam: 'source' }),
  apiTool('upload_permanent_media', 'uploadPermanentMedia', 'wechat_media', 'Upload permanent media from an uploaded file or public HTTPS URL.', [fileSource(), optStr('type', 'image'), optObj('options')], { effect: 'write', fileSourceParam: 'source' }),
  apiTool('upload_article_image', 'uploadArticleImage', 'wechat_media', 'Upload an article inline image from an uploaded file or public HTTPS URL.', [fileSource()], { effect: 'write', fileSourceParam: 'source' }),
  apiTool('get_material_count', 'getMaterialCount', 'wechat_media', 'Get permanent material counts.'),
  apiTool('get_material_list', 'getMaterialList', 'wechat_media', 'List permanent materials.', [optStr('type', 'image'), num('offset', 0), num('count', 20)]),
  apiTool('delete_material', 'deleteMaterial', 'wechat_media', 'Delete permanent material.', [str('mediaId')], { effect: 'delete' }),

  apiTool('send_text_message', 'sendTextMessage', 'wechat_customer_message', 'Send a customer-service text message.', [str('openId'), str('content')], { effect: 'write' }),
  apiTool('send_image_message', 'sendImageMessage', 'wechat_customer_message', 'Send a customer-service image message.', [str('openId'), str('mediaId')], { effect: 'write' }),
  apiTool('send_voice_message', 'sendVoiceMessage', 'wechat_customer_message', 'Send a customer-service voice message.', [str('openId'), str('mediaId')], { effect: 'write' }),
  apiTool('send_video_message', 'sendVideoMessage', 'wechat_customer_message', 'Send a customer-service video message.', [str('openId'), str('mediaId'), str('thumbMediaId'), optStr('title'), optStr('description')], { effect: 'write' }),
  apiTool('send_news_message', 'sendNewsMessage', 'wechat_customer_message', 'Send a customer-service news message.', [str('openId'), arr('articles')], { effect: 'write' }),
  apiTool('send_mpnews_message', 'sendMpNewsMessage', 'wechat_customer_message', 'Send a customer-service mpnews message.', [str('openId'), str('mediaId')], { effect: 'write' }),
  apiTool('send_typing_status', 'sendTypingStatus', 'wechat_customer_message', 'Send typing status.', [str('openId')], { effect: 'write' }),

  apiTool('create_menu', 'createMenu', 'wechat_menu', 'Create custom menu.', [obj('menu')], { effect: 'write' }),
  apiTool('get_menu', 'getMenu', 'wechat_menu', 'Get custom menu.'),
  apiTool('delete_menu', 'deleteMenu', 'wechat_menu', 'Delete custom menu.', [], { effect: 'delete' }),
  apiTool('get_current_menu_info', 'getCurrentMenuInfo', 'wechat_menu', 'Get current self-menu info.'),

  apiTool('create_qrcode', 'createQRCode', 'wechat_qrcode', 'Create a QR code.', [str('sceneStr'), num('expireSeconds', 604800), bool('isPermanent', false)], { effect: 'write' }),
  apiTool('get_qrcode_image_url', 'getQRCodeImageUrl', 'wechat_qrcode', 'Build the QR code image URL from a ticket.', [str('ticket')], { requiresWechatAuth: false }),

  apiTool('mass_send_by_tag', 'massSendByTag', 'wechat_mass_message', 'Mass send by tag.', [reqNum('tagId'), str('type'), anyValue('content')], { effect: 'write' }),
  apiTool('mass_send_by_open_ids', 'massSendByOpenIds', 'wechat_mass_message', 'Mass send by OpenID list.', [arr('openIds', 'OpenID list', 'string'), str('type'), anyValue('content')], { effect: 'write' }),
  apiTool('preview_mass_message', 'previewMassMessage', 'wechat_mass_message', 'Preview a mass message.', [str('openId'), str('type'), anyValue('content')], { effect: 'write' }),
  apiTool('get_mass_message_status', 'getMassMessageStatus', 'wechat_mass_message', 'Get mass message status.', [str('msgId')]),
  apiTool('delete_mass_message', 'deleteMassMessage', 'wechat_mass_message', 'Delete a mass message.', [str('msgId'), num('articleIdx', 0)], { effect: 'delete' }),

  workflowTool('collect_news', 'collectNews', 'content_workflow', 'Collect hotspot news with the config-oriented collector.', [optStr('source', ''), optStr('topic', ''), num('count', 20), bool('deep', false)], { requiresWechatAuth: false, keywords: ['热点采集', 'collect news'] }),
  workflowTool('smart_collect_news', 'smartCollectNews', 'content_workflow', 'Collect hotspot news from explicit query, keywords, and sources.', [str('query'), optArr('keywords', [], 'Expanded keywords', 'string'), optArr('sources', ['hackernews', 'v2ex'], 'Source list', 'string'), num('count', 20), bool('deep', false)], { requiresWechatAuth: false, keywords: ['智能采集', 'smart collect'] }),
  workflowTool('generate_article', 'generateArticle', 'content_workflow', 'Create an article generation prompt/task.', [param('topic', 'string', { required: false, description: 'Article topic' }), param('url', 'string', { required: false, description: 'Reference URL' }), bool('fromCollected', false), num('index', 0)], { requiresWechatAuth: false, keywords: ['生成文章', 'article generation'] }),
  workflowTool('publish_auto_flow', 'publishAutoFlow', 'publish_workflow', 'Inspect collected news and return publish next steps.', [], { requiresWechatAuth: false, keywords: ['自动发布流程'] }),
  workflowTool('create_draft_from_file', 'createDraftFromFile', 'publish_workflow', 'Create a WeChat draft from an uploaded Markdown file or public HTTPS URL.', [fileSource()], { requiresWechatAuth: true, keywords: ['创建草稿'], fileSourceParam: 'source' }),
  workflowTool('publish_draft_workflow', 'publishDraftWorkflow', 'publish_workflow', 'Publish a draft and check its status.', [str('draftId'), num('waitMs', 3000)], { requiresWechatAuth: true, keywords: ['发布草稿'] }),
  workflowTool('daily_report', 'dailyReport', 'analytics_workflow', 'Generate the official-account daily report.', [param('date', 'string', { required: false, description: 'Date in YYYY-MM-DD format' })], { requiresWechatAuth: true, keywords: ['公众号日报', 'daily report'] }),
  workflowTool('weekly_report', 'weeklyReport', 'analytics_workflow', 'Generate the official-account weekly report.', [param('endDate', 'string', { required: false, description: 'End date in YYYY-MM-DD format' })], { requiresWechatAuth: true, keywords: ['公众号周报', 'weekly report'] }),
  workflowTool('check_comments', 'checkComments', 'interact_workflow', 'Check new comments for recent or specified articles.', [param('articleId', 'string', { required: false }), bool('list', false)], { requiresWechatAuth: true, keywords: ['检查评论'] }),
  workflowTool('reply_comment_workflow', 'replyCommentWorkflow', 'interact_workflow', 'Reply to a comment by combined comment ID.', [str('commentId'), str('content')], { requiresWechatAuth: true, keywords: ['回复评论'] }),
  workflowTool('elect_comment_workflow', 'electCommentWorkflow', 'interact_workflow', 'Mark a comment as selected by combined comment ID.', [str('commentId')], { requiresWechatAuth: true, keywords: ['精选评论'] }),
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function stripRuntimeFields(tool, options = {}) {
  const { schema, fileSourceParam, ...publicTool } = tool;
  if (publicTool.dangerous && options.dangerousToolsEnabled !== true) {
    return {
      ...publicTool,
      disabledReason: 'Dangerous tool disabled by default; set WEMP_MCP_ENABLE_DANGEROUS_TOOLS=1 to enable it',
    };
  }
  return publicTool;
}

function matchesCategory(tool, category) {
  if (!category) return true;
  return tool.category === category;
}

function scoreTool(tool, terms) {
  if (terms.length === 0) return 1;
  const haystack = [
    tool.name,
    tool.handler,
    tool.title,
    tool.description,
    tool.category,
    ...tool.keywords,
  ].join(' ').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

export function getInternalTools(options = {}) {
  return TOOLS.map((tool) => stripRuntimeFields(tool, options));
}

export function findInternalTool(name) {
  return TOOL_BY_NAME.get(name);
}

export function validateToolArguments(tool, args) {
  return tool.schema.parse(args || {});
}

export function searchInternalTools({ query = '', category = '', limit = 20, dangerousToolsEnabled = false } = {}) {
  const options = { dangerousToolsEnabled };
  const terms = String(query)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const maxResults = Math.min(Math.max(Number(limit) || 20, 1), 100);

  return TOOLS
    .filter((tool) => matchesCategory(tool, category))
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, maxResults)
    .map((entry) => stripRuntimeFields(entry.tool, options));
}
