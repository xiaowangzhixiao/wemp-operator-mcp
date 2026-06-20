# Create a WeChat Draft

Use this guide when creating a draft from a local Markdown file, rendered HTML,
or article directory containing local images.

## Choose the Draft Path

Inspect the source before calling a draft tool:

- For a local Markdown file, prefer `create_draft_from_file`.
- For rendered HTML, use `add_draft` so the existing HTML and inline styles are
  preserved.
- Do not send rendered HTML to `create_draft_from_file`. Its current tool
  description accepts an uploaded Markdown file or public HTTPS URL.

Search for the exact schemas before invocation:

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"create draft from file","category":"publish_workflow","limit":10}' \
  --output json

mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"add draft","category":"wechat_draft","limit":10}' \
  --output json
```

## Create from Markdown

Upload the Markdown file, then pass its `uploadId` to
`create_draft_from_file`:

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<bearer-token>' \
node scripts/upload-file.mjs /absolute/article.md

mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"create_draft_from_file","arguments":{"source":{"uploadId":"<upload-id>"}}}' \
  --output json
```

The upload script requires `WEMP_MCP_URL` and `WEMP_MCP_TOKEN` in its
environment even when `mcporter` is already configured. Never print the token
or store it in a workspace file.

## Create from Rendered HTML

### 1. Inspect the article

Identify:

- title
- digest
- rendered HTML file
- every local image referenced by `src`
- the image to use as the cover

```bash
rg -o 'src="[^"]+"' /absolute/article.html
```

Treat relative and absolute local image paths as inaccessible to the remote MCP
server.

### 2. Upload local files

Upload every inline image with `scripts/upload-file.mjs`. Uploaded files expire
after 15 minutes, so complete the image conversion and draft creation promptly.

For each returned `uploadId`, call `upload_article_image`:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"uploadId":"<upload-id>"}}}' \
  --output json
```

Replace the corresponding local `src` in the HTML with the returned WeChat
image URL.

Upload one suitable image as permanent media for the required cover
`thumb_media_id`:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_permanent_media","arguments":{"source":{"uploadId":"<upload-id>"},"type":"image"}}' \
  --output json
```

Use the returned `mediaId` as `thumb_media_id`. The inline image URL returned by
`upload_article_image` cannot replace this value.

### 3. Build the article object

Construct arguments with `jq --rawfile` or another structured JSON tool. Do not
manually escape a large HTML body into JSON.

The article object should normally contain:

```json
{
  "title": "Article title",
  "author": "",
  "digest": "Short article summary",
  "content": "<rendered HTML with WeChat image URLs>",
  "content_source_url": "",
  "thumb_media_id": "<permanent-media-id>",
  "need_open_comment": 0,
  "only_fans_can_comment": 0
}
```

Submit it with `add_draft`:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"add_draft","arguments":{"articles":[{"title":"...","content":"...","thumb_media_id":"..."}]}}' \
  --output json
```

Treat `success: false` as failure. Record the returned draft `mediaId`.

## Verify the Draft

Read the created draft using `get_draft`. The current response stores articles
under `data.items`, not `data.news_item`:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"get_draft","arguments":{"mediaId":"<draft-media-id>"}}' \
  --output json
```

Verify:

- `success` is `true`
- `data.items` contains the expected article count
- title and digest match
- `thumb_media_id` is present
- every expected `<img>` remains in the content
- no local image paths remain
- all inline images reference WeChat-hosted URLs

Example summary:

```bash
... | jq '{
  success,
  article_count: (.data.items | length),
  title: .data.items[0].title,
  content_length: (.data.items[0].content | length),
  image_count: ([.data.items[0].content | scan("<img ")] | length),
  local_image_refs: ([.data.items[0].content | scan("images/")] | length),
  wechat_image_refs: ([.data.items[0].content | scan("mmbiz.qpic.cn")] | length)
}'
```

This verifies stored content, not visual rendering. If exact appearance matters,
also inspect the draft in the WeChat Official Account editor.

## Common Failure Points

- `create_draft_from_file` receives HTML: switch to `add_draft`.
- Local image paths remain in HTML: upload each image and replace every `src`.
- `add_draft` rejects the cover: upload the cover with
  `upload_permanent_media` and use its `mediaId`.
- `scripts/upload-file.mjs` reports missing URL or token: provide
  `WEMP_MCP_URL` and `WEMP_MCP_TOKEN` in the command environment without
  exposing the token.
- Verification returns `null`: inspect the raw response and use `data.items`.
- An upload expires: upload it again and finish within the 15-minute window.
- Draft creation succeeds but styling looks wrong: inspect the draft visually;
  WeChat may sanitize unsupported HTML or CSS.

Creating a draft is not publishing. Do not call a publish tool unless the user
explicitly requests publishing and confirms the exact draft.
