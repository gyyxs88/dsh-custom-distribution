# Desktop 0.2.2-rc.1 安装与发行

本轮固定 tag 为 [desktop-v0.2.2-rc.1.1](https://github.com/gyyxs88/dsh-custom-distribution/releases/tag/desktop-v0.2.2-rc.1.1)，独立 prerelease，不改旧 Web Latest v0.5.1。下载资产在该 Release 发布后可用。

保存工作、正常退出 Desktop（含托盘），下载同一 Release 的 Install-Desktop.ps1，右键使用 PowerShell 运行。无需管理员、Node/npm 或编译工具。脚本校验固定官方安装器、EXE/ASAR 和六包，不修改官方程序，不自动启动 Desktop。

已有历史须先完成一致性冷备及旧 Schedule 离线迁移/对账，再首次打开 0.2.2。安装器只提示这个要求，不自动迁移历史，不承诺旧历史一键无缝升级。
完整步骤见 [安装说明](releases/0.2.2-rc.1.1/INSTALL.md) 和 [迁移与回退](releases/0.2.2-rc.1.1/MIGRATION.md)。回退前保存当时最新的完整 home、附件、pending 和配置；按格式兼容性选择数据，新历史不会自动合并进旧备份。

六包全部保留：compat/TPS 0.2.2-rc.1.1、Session 0.8.6-dsh022.1、remote 0.3.4-dsh022.1；GenUI 0.9.1-dsh021.3 和 codeagents 0.2.4-dsh021.1 复用原 tgz。只为两个复用包版本补充精确目标许可。详见 [manifest](releases/0.2.2-rc.1.1/manifest.json)。

compat 使用官方动态请求头 hook，退出 snapshot 身份头改写和自定义复制 ID 菜单；Session/remote 适配目标 API 并提供旧 Schedule 离线迁移。TPS 从精确官方源生成外置 overlay，保留官方 usage/思考展示。公开源码、来源、许可和历史 README 边界见 [source](releases/0.2.2-rc.1.1/source/README.md)。

## 维护者入口

```text
node desktop/releases/0.2.2-rc.1.1/Reproduce.mjs <原始官方app.asar> <全新输出目录>
node scripts/Build-DesktopBundle.mjs <空输出目录> <固定包目录> 0.2.2-rc.1.1
```

重建四个改动包，逐文件核对并复制两个原包，结果必须与 manifest 摘要一致。构建入口要求候选已冻结；生成固定 ZIP、内嵌 ZIP/manifest 摘要的独立 bootstrap、SHA256SUMS.txt 和 publish-assets.json，不执行 npm 安装或发布。
两个安装入口同时 pin manifest，包选择、程序与精确许可不能由下载元数据改变。ZIP 仅含六包、manifest、安装器与消费说明，不含私有 profile、源码、原始验收日志或官方程序。

候选 API/权限/迁移检查、发行安装/Host 门禁和发布后真实公开下载分别验收；不将模拟或重现算作真实 provider、SSH、外部编码、NSIS 向导或 UI 目视通过。

## 历史发行

旧 [rc.5.1 安装说明](../docs/桌面安装发行说明-0.2.1-rc.5.1.md)、[rc.5.1 冻结源](releases/0.2.1-rc.5.1/source/provenance.json)、rc.3.1 原始目录保持不变。
旧 Build-Desktop/Build-Tps021/Test-Desktop/Release-Desktop 入口仍只服务 rc.5，不将旧 transform 或 Cordis 4.0.5 校验用于新目标。
省略 Build-DesktopBundle 的发行版本仍选择历史 rc.5.1；新发行必须显式给出 0.2.2-rc.1.1。
