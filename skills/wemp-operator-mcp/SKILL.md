---
name: wemp-operator-mcp
description: Use when operating a WeChat official account through the public wemp-operator MCP server with mcporter, including analytics reports, drafts, comments, followers, menus, media, QR codes, messages, and content collection.
---

# wemp-operator MCP

Use `mcporter` to access the public MCP endpoint. The server exposes only
`tool_search` and `run_tool`; discover internal tools before invoking them.

## Setup

Run from this skill directory:

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' WEMP_MCP_TOKEN='<bearer-token>' node scripts/setup.mjs
```

Never print, commit, or ask the user to paste the token into conversation.
The setup script stores it in mcporter's user configuration and restricts that
file to the current user.

## Local Files

Never pass a calling-machine absolute path to `run_tool`. The remote MCP server
cannot read local paths. Upload the file first:

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<bearer-token>' \
node scripts/upload-file.mjs /absolute/path/to/cover.png
```

Use the returned `uploadId` with a file tool:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"uploadId":"<upload-id>"}}}' \
  --output json
```

Uploaded files may be reused for 15 minutes. For an existing public HTTPS
resource, skip upload and pass a URL:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"url":"https://example.com/image.png","filename":"image.png"}}}' \
  --output json
```

File sources apply to `upload_temp_media`, `upload_permanent_media`,
`upload_article_image`, and `create_draft_from_file`.

## Draft Creation

For local Markdown, rendered HTML, article images, cover media, and post-create
verification, read [reference/create-draft.md](reference/create-draft.md).
Rendered HTML requires `add_draft`; do not send it to
`create_draft_from_file`.

## Required Workflow

1. Check the server:

```bash
mcporter list wemp-operator-mcp
```

2. Search for the internal tool that matches the request:

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"公众号日报","limit":5}' \
  --output json
```

3. Read the returned `name`, `parameters`, `effect`, `requiresWechatAuth`, and
   `disabledReason`. Do not guess argument names.

4. Invoke the selected internal tool:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"daily_report","arguments":{"date":"2026-06-08"}}' \
  --output json
```

5. Report the meaningful result. Treat `success: false` as failure even when
   the MCP transport call itself succeeded.

## Finding Tools

List up to 100 tools when the request is broad or the correct search term is
unknown:

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"limit":100}' \
  --output json
```

Filter by an exact category to browse one capability area:

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"category":"wechat_draft","limit":100}' \
  --output json
```

Common categories and representative tools:

| Category | Purpose | Typical tools |
|---|---|---|
| `analytics_workflow` | Ready-to-use reports | `daily_report`, `weekly_report` |
| `interact_workflow` | Comment operations | `check_comments`, `reply_comment_workflow` |
| `content_workflow` | Collect and generate content | `smart_collect_news`, `generate_article` |
| `publish_workflow` | Draft and publishing workflows | `create_draft_from_file`, `publish_draft_workflow` |
| `wechat_analytics` | Raw account and article metrics | `get_user_summary`, `get_article_total`, `get_user_read` |
| `wechat_draft` | Draft management | `list_drafts`, `get_draft`, `add_draft` |
| `wechat_publish` | Published article management | `list_published`, `get_publish_status`, `publish_draft` |
| `wechat_comment` | Raw comment APIs | `list_comments`, `reply_comment`, `elect_comment` |
| `wechat_user` | Followers and blacklist | `get_followers`, `get_user_info`, `get_blacklist` |
| `wechat_tag` | Follower tags | `get_tags`, `create_tag`, `batch_tag_users` |
| `wechat_media` | Images and permanent materials | `get_material_list`, `upload_article_image` |
| `wechat_menu` | Custom menus | `get_menu`, `create_menu` |
| `wechat_qrcode` | QR codes | `create_qrcode`, `get_qrcode_image_url` |
| `wechat_template` | Template messages | `get_templates`, `send_template_message` |
| `wechat_customer_message` | Customer-service messages | `send_text_message`, `send_image_message` |
| `wechat_mass_message` | Mass messaging | `preview_mass_message`, `mass_send_by_tag` |

Recommended searches:

```bash
# Daily or weekly operational reports
mcporter call wemp-operator-mcp.tool_search --args '{"query":"日报 周报","limit":10}' --output json

# Draft creation, listing, or editing
mcporter call wemp-operator-mcp.tool_search --args '{"query":"draft","category":"wechat_draft","limit":20}' --output json

# Comments, replies, and selected comments
mcporter call wemp-operator-mcp.tool_search --args '{"query":"评论 reply","limit":20}' --output json

# Followers, tags, and user growth
mcporter call wemp-operator-mcp.tool_search --args '{"query":"user follower tag","limit":20}' --output json

# Article reading, sharing, and publishing metrics
mcporter call wemp-operator-mcp.tool_search --args '{"query":"article read share","category":"wechat_analytics","limit":20}' --output json

# Hotspot collection and article generation
mcporter call wemp-operator-mcp.tool_search --args '{"query":"热点 生成文章","limit":20}' --output json
```

Prefer workflow tools for complete operational requests. Use raw `wechat_*`
tools when the user asks for a specific API-level operation.

## Safety Rules

- Call only `wemp-operator-mcp.tool_search` and `wemp-operator-mcp.run_tool`.
- Search again when the tool name or arguments are uncertain.
- Before publish, delete, mass-send, blacklist, or other destructive actions,
  show the exact target and ask for explicit confirmation.
- If `disabledReason` is present or `run_tool` returns `TOOL_DISABLED`, explain
  that the server administrator must explicitly enable dangerous tools.
- Never request or pass WeChat AppID, AppSecret, or access tokens. They are
  managed by the MCP server.
- Never pass `filePath` to MCP tools. Use `source.uploadId` or `source.url`.
- For `WECHAT_SERVER_AUTH_NOT_CONFIGURED`, report that server-side WeChat
  credentials are missing; do not fall back to local configuration.

## Common Calls

```bash
# Search analytics tools
mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"analytics","category":"wechat_analytics","limit":20}' \
  --output json

# Generate a weekly report
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"weekly_report","arguments":{"endDate":"2026-06-08"}}' \
  --output json

# Collect hotspot news without WeChat authentication
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"smart_collect_news","arguments":{"query":"AI","sources":["hackernews","v2ex"],"count":10}}' \
  --output json
```

## Troubleshooting

- `mcporter: command not found`: rerun `node scripts/setup.mjs`.
- `401 Unauthorized`: rerun setup with the current `WEMP_MCP_TOKEN`.
- Connection or `405` error: verify `WEMP_MCP_URL` ends with `/mcp`.
- Unknown tool or invalid arguments: call `tool_search` again and follow its
  returned schema.
