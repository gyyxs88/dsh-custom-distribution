# 429 调查结论与限度

2026-11-06 原会话在 02:27:28–02:32:49 UTC 出现约 300 秒 TIMEOUT，随后五次 RATE_LIMIT/429。持久 failure 已被旧适配层整理为固定中文，原始响应正文、上游类型、响应头和限流桶不可据此还原。不能将这段历史直接称为升级 bug。

主控核实 [OpenCode 官方状态页](https://status.opencode.ai/)：02:03 UTC 起 `Upstream provider issues`，Go `deepseek-v4.1-flash` increased error rates，覆盖原会话时间。状态页说明账户 balance/budget/usage limits 不计入此故障。这是同模型、同时间上游事故的强相关证据，不能证明历史 429 的确切响应、重试提示或具体限流桶。

随后主控两次最小合成探测均 HTTP 200：原 endpoint 直接请求约 2.2 秒；原 ASAR + 已装 compat `.1` 约 2.616 秒正常 stop。官方请求头已包含自有 Harness UA，且两 SID 正确。旧 endpoint 当前有效；不再为 UA/SID 增加补丁。当前成功不能回推历史额度状态。

离线确证：pi-ai 转为文字时不保留 HTTP Retry-After/requestId；compat 固定摘要进一步丢失安全 type/code；SDK 4000 字符截断可使完整 JSON 不可解析，把已明确 insufficient_quota 的 HTTP 429 退化成可重试 RATE_LIMIT。`.2` 只为两 Go 路由在 SDK injectable fetch 处保存实际状态、合法头和至多 64 KiB 错误 JSON（仅内存），将白名单 token 写入固定摘要。未知 token/raw/cause/URL 不进入 failure。

实际回环检查确认 idle timeout、主动取消及消费者停止均关闭连接，SDK 单次请求无内部重试。未证明本机存在“超时后不取消”缺陷；不能证明上游远端任务在断连瞬间已停止。未增加全局限流、熔断或日志框架。

本目录包含一份新 compat 源和六包；其余五包以 `.1` manifest 固定 hash 校对，不复制旧源码树。`Reproduce.mjs` 独立重建 compat，并核对/复用旧五包。离线 22 项目标检查、原有 108 项 compat 与 29 项错误链检查通过。部署、新 bundle 消费者、发布均由主控继续验收。
