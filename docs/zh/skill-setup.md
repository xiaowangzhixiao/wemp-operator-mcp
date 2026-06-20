# Skill 安装指南

配套 Skill 会指导本地 Agent 通过 `mcporter` 调用你的公网 MCP server。

## 安装

在运行 Agent 的机器上克隆仓库：

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
```

安装 Codex 风格本地 Skill：

```bash
npm run skill:install
```

如果使用其他 Agent，把 `skills/wemp-operator-mcp` 复制或软链到对应 Agent 的本地 Skill 目录。

## 配置 MCP

在 Skill 目录里运行初始化：

```bash
cd skills/wemp-operator-mcp
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/setup.mjs
```

初始化脚本会：

- 在缺少 `mcporter` 时自动安装；
- 注册 `wemp-operator-mcp` HTTP MCP server；
- 把 Bearer token 保存到当前用户的 `mcporter` 配置；
- 验证 server 只暴露 `tool_search` 和 `run_tool`。

`WEMP_MCP_URL` 必须以 `/mcp` 结尾。除非目标是 `localhost` 或 `127.0.0.1`，否则必须使用 HTTPS。

## 使用

先搜索工具，再调用：

```bash
mcporter call wemp-operator-mcp.tool_search \
  --args '{"query":"draft","limit":10}' \
  --output json
```

调用选中的工具：

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"list_drafts","arguments":{"offset":0,"count":5}}' \
  --output json
```

上传本地文件：

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/upload-file.mjs /absolute/path/to/image.png
```

使用返回的 `uploadId`：

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"uploadId":"<upload-id>"}}}' \
  --output json
```

不要把本地绝对路径或 `filePath` 传给 MCP 工具。
