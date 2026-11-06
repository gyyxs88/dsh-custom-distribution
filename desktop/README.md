# Desktop 0.2.2-rc.1 安装与发行

本次补丁 tag 为 [desktop-v0.2.2-rc.1.2](https://github.com/gyyxs88/dsh-custom-distribution/releases/tag/desktop-v0.2.2-rc.1.2)，独立 prerelease，不改旧 Web Latest v0.5.1。安装资产与摘要见该 Release。

保存工作、正常退出 Desktop（含托盘），下载同一 Release 的 Install-Desktop.ps1，右键使用 PowerShell 运行。无需管理员、Node/npm 或编译工具。脚本校验固定官方安装器、EXE/ASAR 和六包，不修改官方程序，不自动启动 Desktop。

已有历史须先完成一致性冷备及旧 Schedule 离线迁移/对账，再首次打开 0.2.2。安装器只提示这个要求，不自动迁移历史，不承诺旧历史一键无缝升级。
完整步骤见 [安装说明](releases/0.2.2-rc.1.2/INSTALL.md) 和 [迁移与回退](releases/0.2.2-rc.1.2/MIGRATION.md)。回退前保存当时最新的完整 home、附件、pending 和配置；按格式兼容性选择数据，新历史不会自动合并进旧备份。

六包全部保留：仅 compat 更新到 0.2.2-rc.1.2，其他五包保留 `.1` 原始字节，两项精确许可完全沿用。详见 [manifest](releases/0.2.2-rc.1.2/manifest.json)。

compat 使用官方动态请求头 hook；本次只补 Go 真实 Retry-After/requestId 与白名单错误类型，避免 SDK 截断已明确 quota 后误重试。官方 UA/SID 当前已正确。历史 429 与官方上游事故同模型同时间强相关，具体限流桶仍未知，见 [结论与限度](releases/0.2.2-rc.1.2/ROOTCAUSE.md)。新源码和定向回归位于 `.2/build-inputs/dsh-desktop-compat` 和 `.2/test`；五个复用包的来源与许可仍见 [原 source](releases/0.2.2-rc.1.1/source/README.md)。

## 维护者入口

```text
node desktop/releases/0.2.2-rc.1.2/Reproduce.mjs <原始官方app.asar> <全新输出目录>
node desktop/releases/0.2.2-rc.1.2/test/run.cjs <官方Electron.exe> <原始官方app.asar> <全新隔离输出目录>
node --test desktop/releases/0.2.2-rc.1.2/test/contract.test.mjs
node scripts/Build-DesktopBundle.mjs <空输出目录> <固定包目录> 0.2.2-rc.1.2
```

只重建新 compat，核对其余五个原包固定 hash 后复制，结果必须与新 manifest 摘要一致；不复制旧源码树或重跑旧五包构建。后续 bundle 构建入口要求候选字节已冻结；生成固定 ZIP、内嵌 ZIP/manifest 摘要的独立 bootstrap、SHA256SUMS.txt 和 publish-assets.json，不执行 npm 安装或发布。新 bundle 消费者验收与部署由主控完成。
两个安装入口同时 pin manifest，包选择、程序与精确许可不能由下载元数据改变。ZIP 仅含六包、manifest、安装器与消费说明，不含私有 profile、源码、原始验收日志或官方程序。主控已完成重现及新 bundle 隔离消费者检查，范围和限制见 [验收记录](releases/0.2.2-rc.1.2/ACCEPTANCE.md)。

候选 API/权限/迁移检查、发行安装/Host 门禁和发布后真实公开下载分别验收；不将模拟或重现算作真实 provider、SSH、外部编码、NSIS 向导或 UI 目视通过。

## 历史发行

旧 [rc.5.1 安装说明](../docs/桌面安装发行说明-0.2.1-rc.5.1.md)、[rc.5.1 冻结源](releases/0.2.1-rc.5.1/source/provenance.json)、rc.3.1 原始目录保持不变。
旧 Build-Desktop/Build-Tps021/Test-Desktop/Release-Desktop 入口仍只服务 rc.5，不将旧 transform 或 Cordis 4.0.5 校验用于新目标。
省略 Build-DesktopBundle 的发行版本仍选择历史 rc.5.1；旧 targetVersion 常量仍是 0.2.2-rc.1.1，新发行必须显式给出 0.2.2-rc.1.2。
