# Desktop 0.2.2-rc.1.2 插件候选

配合未修改的官方 Desktop `0.2.2-rc.1`。本版只更新 compat 到 `0.2.2-rc.1.2`，其余五包及两项精确兼容许可沿用 `.1` 固定字节。候选离线检查完成；发行消费者验收、部署和公开发布由主控完成，下载入口在发布后生效。

保存工作、正常退出 Desktop（含托盘），从同一 `desktop-v0.2.2-rc.1.2` Release 下载 `Install-Desktop.ps1`，右键使用 PowerShell 运行；离线 ZIP 内运行 `scripts/Install-Desktop.ps1`。安装器校验官方程序与六包，不自动启动 Desktop。检查和回退分别传 `-Action Verify` / `-Action Rollback`；先保留当时完整 home、附件、pending 和配置。

已有旧历史首次升级到官方 0.2.2 时，仍须一致性冷备、离线 Schedule 迁移和对账，要求 `unresolved=[]`；见 [迁移说明](MIGRATION.md)。已完成迁移的同 runtime `.1`→`.2` 不重新迁移历史。

本次修复保留 Go 请求真实 Retry-After、合法 requestId、白名单错误类型，避免 SDK 截断结构化 quota 后误重试。未知 429 仍不推断具体限流桶；不保存任意响应正文，不改变 UA/SID、默认模型、重试策略或官方程序。

同模型同时间官方上游事故与历史现象强相关，历史 429 子原因仍无法确认；见 [根因限度](ROOTCAUSE.md)。模拟检查不代表候选真实 provider、生产 Host、UI 或安装消费者已验收。
