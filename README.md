# wemp-operator-mcp

Public HTTP MCP server and agent Skill for operating a WeChat Official
Account.

The server is designed for public deployment behind HTTPS. It keeps WeChat
credentials on the server, exchanges and caches `access_token` from a fixed
egress IP, and exposes only two MCP tools to agents:

- `tool_search`: discover the internal API/workflow catalog.
- `run_tool`: execute one discovered internal tool.

The companion Skill configures a local agent to call your public MCP endpoint
through `mcporter`.

## Why One Repository

The MCP server and Skill are versioned together in this repository because the
Skill documents the exact public contract exposed by the server. Keeping them
together prevents schema drift between file upload handling, `tool_search`
metadata, and `run_tool` examples.

## Features

- HTTP Streamable MCP endpoint at `/mcp`.
- Bearer token authentication for every MCP and upload request.
- Server-side WeChat `access_token` exchange using
  `WEMP_WECHAT_APP_ID` and `WEMP_WECHAT_APP_SECRET`.
- Token cache with early refresh, single-flight refresh, and one retry after
  WeChat token-expired responses.
- Temporary file upload endpoint at `/uploads` for remote MCP file tools.
- HTTPS URL file source support with SSRF protections.
- Dangerous tools are disabled by default, including publish/delete/mass-send
  and blacklist operations.
- Local CLI remains available for development and local automation.

## Architecture

```text
Local Agent + Skill
        |
        | mcporter HTTP MCP
        v
HTTPS reverse proxy
        |
        v
wemp-operator-mcp container
        |
        | fixed public egress IP
        v
WeChat Official Account APIs
```

For public deployment, add your server's public egress IP to the WeChat
Official Account API IP allowlist. Agents only need the MCP bearer token; they
do not receive your WeChat AppSecret or `access_token`.

## Public API

### MCP

```text
POST /mcp
Authorization: Bearer <WEMP_MCP_TOKEN>
```

Public MCP tools:

```text
tool_search(query?: string, category?: string, limit?: number)
run_tool(name: string, arguments?: object)
```

Example:

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"draft image","limit":10}' \
  --output json
```

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"get_user_summary","arguments":{"date":"2026-06-21"}}' \
  --output json
```

### File Upload

Remote MCP servers cannot read local paths from the caller machine. Upload the
file first:

```http
POST /uploads
Authorization: Bearer <WEMP_MCP_TOKEN>
Content-Type: multipart/form-data
```

The form must contain exactly one `file` field. Successful response:

```json
{
  "uploadId": "cfa59bda-0d99-4ad7-9afe-77efb8b09c80",
  "filename": "cover.png",
  "mimeType": "image/png",
  "size": 123456,
  "expiresAt": "2026-06-21T12:00:00.000Z"
}
```

Use the returned `uploadId` with file tools:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"uploadId":"cfa59bda-0d99-4ad7-9afe-77efb8b09c80"}}}' \
  --output json
```

Or pass a public HTTPS URL:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"url":"https://example.com/image.png","filename":"image.png"}}}' \
  --output json
```

File source tools:

- `upload_temp_media`
- `upload_permanent_media`
- `upload_article_image`
- `create_draft_from_file`

MCP file tools intentionally do not accept `filePath`. Local CLI scripts may
still use local paths.

## Quick Start: Docker

1. Clone the repository.

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
```

2. Create an environment file.

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
WEMP_MCP_TOKEN=replace-with-a-random-token
WEMP_WECHAT_APP_ID=wx...
WEMP_WECHAT_APP_SECRET=replace-with-your-app-secret
WEMP_MCP_HOST=0.0.0.0
WEMP_MCP_PORT=3333
WEMP_MCP_ENABLE_DANGEROUS_TOOLS=0
```

Generate a token:

```bash
openssl rand -hex 32
```

3. Run the server.

```bash
docker compose up -d --build
curl --fail http://127.0.0.1:3333/healthz
```

4. Put Nginx or another HTTPS reverse proxy in front of the container.

Use `deploy/nginx.example.conf` as a starting point. Replace
`mcp.example.com` with your own domain and set certificate paths for your
certificate provider.

5. Add your server public IP to the WeChat Official Account allowlist.

In the WeChat Official Account admin console, go to the developer settings and
add the public egress IP of the server running this container.

## Environment Variables

Required:

- `WEMP_MCP_TOKEN`: bearer token for MCP and upload requests.
- `WEMP_WECHAT_APP_ID`: WeChat Official Account AppID.
- `WEMP_WECHAT_APP_SECRET`: WeChat Official Account AppSecret.

Optional:

- `WEMP_MCP_HOST`: default `127.0.0.1`; use `0.0.0.0` in containers.
- `WEMP_MCP_PORT`: default `3333`.
- `WEMP_WECHAT_TOKEN_REFRESH_SKEW_SECONDS`: default `300`.
- `WEMP_MCP_ENABLE_DANGEROUS_TOOLS`: set `1` to enable dangerous tools.
- `WEMP_MCP_UPLOAD_MAX_BYTES`: default `52428800` (50 MiB).
- `WEMP_MCP_UPLOAD_TOTAL_BYTES`: default `524288000` (500 MiB).
- `WEMP_MCP_UPLOAD_TTL_SECONDS`: default `900`.

Do not log or commit `.env`, AppSecret, WeChat `access_token`, or MCP bearer
tokens.

## Install The Agent Skill

The Skill lives at:

```text
skills/wemp-operator-mcp
```

For Codex-style local skills:

```bash
npm run skill:install
```

Configure the MCP endpoint:

```bash
cd skills/wemp-operator-mcp
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/setup.mjs
```

Verify:

```bash
mcporter list wemp-operator-mcp
mcporter call wemp-operator-mcp.tool_search --args '{"limit":10}' --output json
```

Upload a local file through the Skill helper:

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/upload-file.mjs /absolute/path/to/cover.png
```

## Local Development

Use Node.js `20.12` or newer.

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Start a local MCP server:

```bash
WEMP_MCP_TOKEN=dev-token \
WEMP_WECHAT_APP_ID=wx... \
WEMP_WECHAT_APP_SECRET=... \
npm run mcp:start
```

Local CLI mode can still use `config/wemp.json` through:

```bash
node scripts/init.mjs
```

That local config is not used in MCP context.

## Deployment Guides

- [Docker deployment guide](docs/deployment.md)
- [Nginx reverse proxy example](deploy/nginx.example.conf)
- [Skill setup guide](docs/skill-setup.md)
- [Security notes](docs/security.md)

## Security Defaults

- MCP and upload routes require the same bearer token.
- Only `tool_search` and `run_tool` are public MCP tools.
- The server never exposes AppSecret or WeChat `access_token` through MCP.
- Dangerous operations are disabled unless
  `WEMP_MCP_ENABLE_DANGEROUS_TOOLS=1`.
- File uploads are temporary and are deleted after TTL.
- Public URL fetching only allows HTTPS and rejects private, loopback,
  link-local, multicast, and cloud metadata network ranges.

## License

MIT
