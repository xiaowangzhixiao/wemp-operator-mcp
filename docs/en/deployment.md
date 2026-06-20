# Deployment Guide

This guide deploys `wemp-operator-mcp` to a public server with Docker and
Nginx. Replace all example domains, paths, and secrets with your own values.

## Requirements

- Linux server with a fixed public egress IP.
- Docker and Docker Compose.
- A domain name pointing to the server.
- HTTPS certificate from your preferred provider.
- WeChat Official Account AppID and AppSecret.
- The server public egress IP added to the WeChat Official Account API
  allowlist.

## 1. Prepare The Server

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```dotenv
WEMP_MCP_TOKEN=<random-token>
WEMP_WECHAT_APP_ID=wx...
WEMP_WECHAT_APP_SECRET=<your-app-secret>
WEMP_MCP_HOST=0.0.0.0
WEMP_MCP_PORT=3333
WEMP_MCP_ENABLE_DANGEROUS_TOOLS=0
```

Generate a random token:

```bash
openssl rand -hex 32
```

## 2. Start The Container

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3333/healthz
```

The container should be reachable only from localhost. Expose it publicly
through HTTPS reverse proxy instead of opening port `3333` to the internet.

## 3. Configure Nginx

Copy the example configuration:

```bash
sudo cp deploy/nginx.example.conf /etc/nginx/sites-enabled/wemp-operator-mcp.conf
```

Edit:

- Replace `mcp.example.com` with your domain.
- Set certificate paths if Nginx terminates TLS directly.
- Keep `/uploads` configured with `client_max_body_size 50m` and
  `proxy_request_buffering off`.

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Check:

```bash
curl --fail https://mcp.example.com/healthz
curl -i https://mcp.example.com/mcp
```

The second command should return `401 Unauthorized` without a bearer token.

## 4. Configure WeChat IP Allowlist

In the WeChat Official Account admin console, add the server's public egress IP
to the API allowlist. The MCP server exchanges WeChat `access_token` from this
server, so all WeChat API calls will come from this IP.

If WeChat returns an invalid IP error, confirm the egress IP with:

```bash
curl https://ifconfig.me
```

## 5. Configure A Local Agent Skill

On the machine running your agent:

```bash
git clone https://github.com/xiaowangzhixiao/wemp-operator-mcp.git
cd wemp-operator-mcp
npm run skill:install

cd skills/wemp-operator-mcp
WEMP_MCP_URL='https://mcp.example.com/mcp' \
WEMP_MCP_TOKEN='<random-token-from-server-env>' \
node scripts/setup.mjs
```

Verify:

```bash
mcporter list wemp-operator-mcp
mcporter call wemp-operator-mcp.tool_search --args '{"limit":10}' --output json
```

## 6. Update

On the server:

```bash
git pull
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3333/healthz
curl --fail https://mcp.example.com/healthz
```

Nginx usually does not need changes during application updates unless routes or
body-size limits changed.

## 7. Rollback

If you deploy from Git:

```bash
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

If you deploy tagged Docker images, restart the previous image tag with the same
environment file and localhost port binding.

## Production Notes

- Store `.env` with `0600` permissions.
- Keep `WEMP_MCP_ENABLE_DANGEROUS_TOOLS=0` unless you explicitly need publish,
  delete, mass-send, or blacklist operations.
- Do not paste `.env`, AppSecret, WeChat `access_token`, or MCP bearer token in
  logs or chat.
- `/uploads` is temporary transfer storage. It is not durable and should not be
  backed up.
