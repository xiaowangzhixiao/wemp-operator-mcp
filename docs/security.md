# Security Notes

`wemp-operator-mcp` is designed for public deployment, but it should still be
treated as an administrative service.

## Credential Boundaries

- The MCP bearer token authorizes access to the MCP server.
- WeChat AppID and AppSecret live only on the server.
- Agents never upload WeChat `access_token` or AppSecret.
- MCP responses and errors redact configured secrets and fetched
  `access_token` values.

## Public Surface

Only these MCP tools are registered:

- `tool_search`
- `run_tool`

All WeChat APIs and workflows are internal catalog entries. Agents must search
the catalog and call them by name through `run_tool`.

## Dangerous Tools

Publish, delete, mass-send, and blacklist-like tools are disabled by default.
Set this only when you accept the risk:

```dotenv
WEMP_MCP_ENABLE_DANGEROUS_TOOLS=1
```

Even when enabled, agents should ask for explicit confirmation before
destructive or irreversible actions.

## File Uploads

`POST /uploads` uses the same bearer token as MCP. Files are stored in a
temporary directory and deleted after TTL.

Defaults:

- single file: 50 MiB
- total temporary quota: 500 MiB
- TTL: 15 minutes

The server does not provide a file listing or download endpoint.

## Remote URL Fetching

`source.url` only accepts HTTPS URLs without embedded username/password.
The resolver validates DNS and connection addresses and rejects:

- localhost and loopback networks,
- private IPv4 networks,
- link-local networks,
- carrier-grade NAT ranges,
- multicast/reserved ranges,
- private/link-local IPv6,
- cloud metadata style private addresses,
- redirects to forbidden destinations.

## Reverse Proxy

Terminate HTTPS before traffic reaches the MCP server. Keep the container bound
to localhost when possible:

```yaml
ports:
  - "127.0.0.1:3333:3333"
```

For `/uploads`, keep request buffering disabled in the proxy so large files are
streamed to the application instead of being buffered by Nginx.
