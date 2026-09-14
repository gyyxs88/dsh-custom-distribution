# v0.5.1：OpenCode Go 会话路由修复

修复 OpenCode Go 返回 HTTP 400 MissingSessionID，导致对话在第一个模型请求就结束的问题。核心仍为官方 DSH 0.1.5-rc.2，仅补当前 pi-ai 请求适配器缺失的会话头。

每次推理请求携带原生 `x-deepseek-harness-session-id`；`opencode-go` 同时携带 `x-opencode-session`。标识来自当前 DSH 会话，主对话、重试和标题等辅助请求保持一致，不同会话独立。运行时标识覆盖大小写不同的旧静态配置，不修改共享配置；缺少会话上下文时不伪造 ID。不修改模型、权限、凭据、代理或历史会话。

本地模拟服务验证 Chat Completions、Responses、Anthropic Messages 三种接口，共 13 个实际 HTTP 请求；覆盖主对话/标题稳定性、不同会话隔离、静态头冲突、无会话 ID 和其它 provider。旧适配器无法通过，新适配器通过。发行安装验收自动运行同一检查，不使用真实模型或账户密钥。

此补丁遵守 [官方优先策略](OFFICIAL_FIRST.md)：官方适配器完整覆盖上述路径并通过相同验收后撤下。

依据：[OpenCode Go 客户端要求](https://opencode.ai/docs/go/#where-can-i-use-it)、[DSH 官方讨论 #5495](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)。
