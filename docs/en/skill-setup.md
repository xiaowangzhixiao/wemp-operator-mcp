# Skill Setup

The companion Skill teaches a local agent to call your public MCP server
through `mcporter`.

## Install

Clone this repository on the machine running the agent:

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
```

Install the Skill for Codex-style local skills:

```bash
npm run skill:install
```

For other agents, copy or symlink `skills/wemp-operator-mcp` into that agent's
local skill directory.

## Configure MCP

Run setup from the Skill directory:

```bash
cd skills/wemp-operator-mcp
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/setup.mjs
```

The setup script:

- installs `mcporter` if missing,
- registers `wemp-operator-mcp` as an HTTP MCP server,
- stores the bearer token in the user's `mcporter` config,
- verifies that the server exposes only `tool_search` and `run_tool`.

`WEMP_MCP_URL` must end with `/mcp`. It must use HTTPS unless it targets
`localhost` or `127.0.0.1`.

## Use

Search tools before running them:

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"draft","limit":10}' \
  --output json
```

Run a selected tool:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"list_drafts","arguments":{"offset":0,"count":5}}' \
  --output json
```

Upload a local file:

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/upload-file.mjs /absolute/path/to/image.png
```

Use the returned `uploadId`:

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"uploadId":"<upload-id>"}}}' \
  --output json
```

Do not pass local absolute paths or `filePath` to MCP tools.
