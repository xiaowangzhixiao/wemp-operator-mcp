# wemp-operator-mcp

用于操作微信公众号的公网 HTTP MCP Server 和配套 Agent Skill。

这个服务面向公网 HTTPS 部署。微信公众号凭据保存在服务端，由固定公网出口 IP 向微信换取并缓存 `access_token`。对 Agent 只暴露两个 MCP 工具：

- `tool_search`：搜索内部 API 和工作流目录。
- `run_tool`：执行一个已经搜索到的内部工具。

配套 Skill 会通过 `mcporter` 把本地 Agent 连接到你的公网 MCP 端点。

## 语言

- English: [English README](../en/README.md)
- 简体中文：当前文档

## 为什么放在同一个仓库

MCP server 和 Skill 放在同一个仓库里一起版本化，因为 Skill 描述的是这个 server 的公开接口。这样可以避免文件上传、`tool_search` 元数据和 `run_tool` 示例在多个仓库之间发生版本漂移。

## 功能

- HTTP Streamable MCP 入口：`/mcp`。
- 所有 MCP 和上传请求都需要 Bearer token。
- 服务端通过 `WEMP_WECHAT_APP_ID` 和 `WEMP_WECHAT_APP_SECRET` 换取微信公众号 `access_token`。
- `access_token` 支持提前刷新、并发 single-flight 刷新，以及微信返回 token 失效后的强制刷新重试。
- 临时文件上传入口：`/uploads`，用于远程 MCP 文件型工具。
- 支持公网 HTTPS URL 作为文件来源，并带 SSRF 防护。
- 发布、删除、群发、拉黑等高风险工具默认禁用。
- 保留本地 CLI，便于本地开发和自动化。

## 架构

```text
本地 Agent + Skill
        |
        | mcporter HTTP MCP
        v
HTTPS 反向代理
        |
        v
wemp-operator-mcp 容器
        |
        | 固定公网出口 IP
        v
微信公众号 API
```

公网部署时，需要把服务器公网出口 IP 加入微信公众号接口 IP 白名单。Agent 只需要 MCP Bearer token，不会拿到微信公众号 AppSecret 或 `access_token`。

## 公开接口

### MCP

```text
POST /mcp
Authorization: Bearer <WEMP_MCP_TOKEN>
```

公开 MCP 工具：

```text
tool_search(query?: string, category?: string, limit?: number)
run_tool(name: string, arguments?: object)
```

示例：

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

### 文件上传

远程 MCP server 不能读取调用端机器上的本地路径。需要先上传文件：

```http
POST /uploads
Authorization: Bearer <WEMP_MCP_TOKEN>
Content-Type: multipart/form-data
```

表单必须且只能包含一个 `file` 字段。成功响应：

```json
{
  "uploadId": "cfa59bda-0d99-4ad7-9afe-77efb8b09c80",
  "filename": "cover.png",
  "mimeType": "image/png",
  "size": 123456,
  "expiresAt": "2026-06-21T12:00:00.000Z"
}
```

用返回的 `uploadId` 调用文件型工具：

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"uploadId":"cfa59bda-0d99-4ad7-9afe-77efb8b09c80"}}}' \
  --output json
```

也可以传入公网 HTTPS URL：

```bash
mcporter call wemp-operator-mcp.run_tool \
  --args '{"name":"upload_article_image","arguments":{"source":{"url":"https://example.com/image.png","filename":"image.png"}}}' \
  --output json
```

支持文件来源的工具：

- `upload_temp_media`
- `upload_permanent_media`
- `upload_article_image`
- `create_draft_from_file`

MCP 文件型工具有意不接受 `filePath`。本地 CLI 脚本仍可使用本地路径。

## 快速开始：Docker

1. 克隆仓库。

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
```

2. 创建环境变量文件。

```bash
cp .env.example .env
```

编辑 `.env`：

```dotenv
WEMP_MCP_TOKEN=replace-with-a-random-token
WEMP_WECHAT_APP_ID=wx...
WEMP_WECHAT_APP_SECRET=replace-with-your-app-secret
WEMP_MCP_HOST=0.0.0.0
WEMP_MCP_PORT=3333
WEMP_MCP_ENABLE_DANGEROUS_TOOLS=0
```

生成随机 token：

```bash
openssl rand -hex 32
```

3. 启动服务。

```bash
docker compose up -d --build
curl --fail http://127.0.0.1:3333/healthz
```

4. 使用 Nginx 或其他 HTTPS 反向代理暴露服务。

可以从 `deploy/nginx.example.conf` 开始。把 `mcp.example.com` 替换成你的域名，并配置你的证书路径。

5. 在微信公众号后台配置服务器公网 IP 白名单。

进入微信公众号后台的开发设置，把运行容器的服务器公网出口 IP 加入接口 IP 白名单。

## 环境变量

必填：

- `WEMP_MCP_TOKEN`：MCP 和上传接口的 Bearer token。
- `WEMP_WECHAT_APP_ID`：微信公众号 AppID。
- `WEMP_WECHAT_APP_SECRET`：微信公众号 AppSecret。

可选：

- `WEMP_MCP_HOST`：默认 `127.0.0.1`；容器内建议使用 `0.0.0.0`。
- `WEMP_MCP_PORT`：默认 `3333`。
- `WEMP_WECHAT_TOKEN_REFRESH_SKEW_SECONDS`：默认 `300`。
- `WEMP_MCP_ENABLE_DANGEROUS_TOOLS`：设置为 `1` 才启用高风险工具。
- `WEMP_MCP_UPLOAD_MAX_BYTES`：默认 `52428800`，即 50 MiB。
- `WEMP_MCP_UPLOAD_TOTAL_BYTES`：默认 `524288000`，即 500 MiB。
- `WEMP_MCP_UPLOAD_TTL_SECONDS`：默认 `900`。

不要把 `.env`、AppSecret、微信 `access_token` 或 MCP Bearer token 写入日志或提交到仓库。

## 安装 Agent Skill

Skill 位于：

```text
skills/wemp-operator-mcp
```

Codex 风格的本地 Skill 可以这样安装：

```bash
npm run skill:install
```

配置 MCP 端点：

```bash
cd skills/wemp-operator-mcp
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/setup.mjs
```

验证：

```bash
mcporter list wemp-operator-mcp
mcporter call wemp-operator-mcp.tool_search --args '{"limit":10}' --output json
```

通过 Skill 辅助脚本上传本地文件：

```bash
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<your-mcp-token>' \
node scripts/upload-file.mjs /absolute/path/to/cover.png
```

## 本地开发

使用 Node.js `20.12` 或更新版本。

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

启动本地 MCP server：

```bash
WEMP_MCP_TOKEN=dev-token \
WEMP_WECHAT_APP_ID=wx... \
WEMP_WECHAT_APP_SECRET=... \
npm run mcp:start
```

本地 CLI 模式仍可通过 `config/wemp.json` 使用：

```bash
node scripts/init.mjs
```

MCP 上下文不会读取这个本地配置。

## 部署文档

- [Docker 部署指南](deployment.md)
- [Nginx 反向代理示例](../../deploy/nginx.example.conf)
- [Skill 安装指南](skill-setup.md)
- [安全说明](security.md)

## 安全默认值

- MCP 和上传接口使用同一个 Bearer token。
- MCP 只公开 `tool_search` 和 `run_tool`。
- 服务端不会通过 MCP 暴露 AppSecret 或微信 `access_token`。
- 只有设置 `WEMP_MCP_ENABLE_DANGEROUS_TOOLS=1` 才会启用高风险操作。
- 上传文件是临时文件，到期后会被删除。
- 公网 URL 获取只允许 HTTPS，并拒绝私网、回环、链路本地、多播和云元数据等地址范围。

## License

MIT
