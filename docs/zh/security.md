# 安全说明

`wemp-operator-mcp` 面向公网部署设计，但它仍然是一个管理类服务，需要按高权限服务对待。

## 凭据边界

- MCP Bearer token 用于授权访问 MCP server。
- 微信 AppID 和 AppSecret 只保存在服务端。
- Agent 不上传微信 `access_token` 或 AppSecret。
- MCP 响应和错误会对已配置的敏感值和获取到的 `access_token` 做脱敏。

## 公开面

MCP 只注册以下工具：

- `tool_search`
- `run_tool`

所有微信 API 和运营工作流都是内部 catalog 条目。Agent 必须先搜索 catalog，再通过 `run_tool` 按名称调用。

## 高风险工具

发布、删除、群发、拉黑等工具默认禁用。只有在你接受风险时才设置：

```dotenv
WEMP_MCP_ENABLE_DANGEROUS_TOOLS=1
```

即使已启用，Agent 在执行破坏性或不可逆操作前也应该明确展示目标并请求确认。

## 文件上传

`POST /uploads` 使用和 MCP 相同的 Bearer token。文件会保存到临时目录，并在 TTL 到期后删除。

默认值：

- 单文件上限：50 MiB
- 临时总配额：500 MiB
- TTL：15 分钟

服务端不提供文件列表或下载接口。

## 远程 URL 获取

`source.url` 只接受不带用户名密码的 HTTPS URL。解析器会校验 DNS 和实际连接地址，并拒绝：

- localhost 和回环网络；
- IPv4 私网；
- 链路本地地址；
- CGNAT 地址段；
- 多播和保留地址段；
- IPv6 私网和链路本地地址；
- 云元数据类私网地址；
- 重定向到受限地址的 URL。

## 反向代理

应该在 MCP server 前终止 HTTPS。容器端口尽量只绑定到本机：

```yaml
ports:
  - "127.0.0.1:3333:3333"
```

对于 `/uploads`，反向代理应关闭请求缓冲，让大文件流式传给应用，而不是先缓存在 Nginx。
