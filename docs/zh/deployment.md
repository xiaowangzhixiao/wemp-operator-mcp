# 部署指南

本文档说明如何使用 Docker 和 Nginx 把 `wemp-operator-mcp` 部署到公网服务器。所有示例域名、路径和密钥都需要替换成你自己的值。

## 前置条件

- 一台拥有固定公网出口 IP 的 Linux 服务器。
- Docker 和 Docker Compose。
- 已解析到服务器的域名。
- 来自你选择的证书服务商的 HTTPS 证书。
- 微信公众号 AppID 和 AppSecret。
- 已把服务器公网出口 IP 加入微信公众号接口 IP 白名单。

## 1. 准备服务器

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
WEMP_MCP_TOKEN=<random-token>
WEMP_WECHAT_APP_ID=wx...
WEMP_WECHAT_APP_SECRET=<your-app-secret>
WEMP_MCP_HOST=0.0.0.0
WEMP_MCP_PORT=3333
WEMP_MCP_ENABLE_DANGEROUS_TOOLS=0
```

生成随机 token：

```bash
openssl rand -hex 32
```

## 2. 启动容器

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3333/healthz
```

容器最好只允许本机访问。不要把 `3333` 端口直接暴露到公网，应通过 HTTPS 反向代理对外提供服务。

## 3. 配置 Nginx

复制示例配置：

```bash
sudo cp deploy/nginx.example.conf /etc/nginx/sites-enabled/wemp-operator-mcp.conf
```

编辑配置：

- 把 `mcp.example.com` 替换成你的域名。
- 如果由 Nginx 直接终止 TLS，配置证书路径。
- `/uploads` 保持 `client_max_body_size 50m` 和 `proxy_request_buffering off`。

校验并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

检查：

```bash
curl --fail https://mcp.example.com/healthz
curl -i https://mcp.example.com/mcp
```

第二条命令不带 Bearer token，应该返回 `401 Unauthorized`。

## 4. 配置微信公众号 IP 白名单

在微信公众号后台，把服务器公网出口 IP 加入接口 IP 白名单。MCP server 会在这台服务器上换取微信 `access_token`，所以所有微信 API 请求都会从这个 IP 发出。

如果微信返回 invalid IP 错误，可以用下面命令确认出口 IP：

```bash
curl https://ifconfig.me
```

## 5. 配置本地 Agent Skill

在运行 Agent 的本地机器上执行：

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
npm run skill:install

cd skills/wemp-operator-mcp
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<random-token-from-server-env>' \
node scripts/setup.mjs
```

验证：

```bash
mcporter list wemp-operator-mcp
mcporter call wemp-operator-mcp.tool_search --args '{"limit":10}' --output json
```

## 6. 更新

在服务器上执行：

```bash
git pull
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3333/healthz
curl --fail https://mcp.example.com/healthz
```

普通应用更新通常不需要修改 Nginx，除非路由或请求体大小限制发生变化。

## 7. 回滚

如果通过 Git 部署：

```bash
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

如果通过带 tag 的 Docker 镜像部署，用同一个环境变量文件和本机端口绑定重新启动旧镜像 tag。

## 生产注意事项

- `.env` 权限建议设置为 `0600`。
- 除非明确需要发布、删除、群发或拉黑能力，否则保持 `WEMP_MCP_ENABLE_DANGEROUS_TOOLS=0`。
- 不要在日志、聊天记录或 issue 中粘贴 `.env`、AppSecret、微信 `access_token` 或 MCP Bearer token。
- `/uploads` 是临时中转存储，不是持久化存储，也不需要备份。
