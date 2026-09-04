# DSH Custom Distribution

这是 `gyyxs88` 维护的非官方 Windows 版 DeepSeek Harness 完整发行层。它把当前经过验收的 DSH、界面定制、本机服务控制、会话控制、多 Agent、远程项目控制和相关 Skill 固定成一个可安装、可验证、可升级、可回滚的公开发行包。

> 本项目不是 DeepSeek 官方发行版。DeepSeek Harness 和各组件仍受各自许可证约束。

## 在另一台电脑安装

推荐方式：打开 [Releases](https://github.com/gyyxs88/dsh-custom-distribution/releases)，下载最新版本中的 `Install-DSH.ps1`，然后右键使用 PowerShell 运行。安装器会：

1. 下载同一 Release 的完整 Windows 离线包；
2. 校验 SHA-256 后才解压；
3. 安装到当前用户目录 `%LOCALAPPDATA%\DSH-Custom`，不要求管理员权限；
4. 创建独立的数据目录，并启动 `127.0.0.1:3080`；
5. 输出实际访问地址和验证结果。

DSH `0.1.2-rc.1` 的访问地址带有一次启动期令牌。首次打开后，DSH 会把它换成绑定本机地址的浏览器 Cookie，并立即跳转到不含令牌的干净地址；重启沿用同一数据目录时，已有 Cookie 仍然有效。发行版只把启动入口保存在本机私有运行状态中，不写入仓库或 Release，服务重启日志也会隐藏该值。

也可以下载 `dsh-custom-distribution-v0.3.1-win-x64.zip`，解压后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Bundle.ps1
```

安装完成后的常用入口位于 `%LOCALAPPDATA%\DSH-Custom\bin`：

- `Start-DSH.ps1`：启动；
- `Stop-DSH.ps1`：停止且只终止本发行版记录的进程；
- `Verify-DSH.ps1`：检查版本、进程、监听端口、HTTP 和插件；
- `Update-DSH.ps1`：安装新的发行包并保留旧版本；
- `Rollback-DSH.ps1`：切回上一个已安装版本。

## 包含的定制

- DSH `0.1.2-rc.1` 与固定 Node.js `24.19.0`；
- `network_error` 可重试分类、OpenRouter/OpenCode 实时模型目录与安全静态回退；模型设置可编辑文本／图片能力、思维档位及请求值、模型默认强度、协议兼容和 OpenRouter 上游路由，新会话默认模型／思维强度也可持久设置；
- Node 环境代理自动启用，回环 UI、Gateway、Runtime Manager 与 Session Control 保持直连；
- Windows profile 模块解析使用 DSH 官方格式的 ESM proxy，不依赖安装卷是否能正确遍历 NTFS Junction；未知 fallback 模式会拒绝启动；
- 采用官方 rc1 的非用户消息来源标识；
- 会话菜单复制会话 ID；
- 设置页的一键重启／关闭服务，安装路径由发行版自动注入；
- `@file` 文件引用；
- 会话控制、审批、定时任务、无损分页读取 live/cold 会话历史；指定会话 ID 的状态查询自动兼容 cold，不依赖模型额外传参；子会话终态/需关注时对来源会话持久自动回报；
- 多 Agent 的 Codex / Claude Code / Grok Build / ACP 渠道；默认后台 run、持久自动回报、无重复 jobs 通知，以及全局 Read Only `action-advisor`；
- SSH 远程项目、远端插件和 Runtime 管理；
- 与插件一起安装的会话控制、多 Agent、远程项目 Skill。

本机已安装的 Codex、Claude Code、Grok Build、OpenCode 只会在发现其明确的绝对入口时接线。发行版不会复制任何登录态、Cookie、OAuth token 或 API key；缺少的 Runtime 会明确显示为不可用，不会从 `PATH` 猜测。

## 私有数据边界

下列内容永远不会进入本仓库或 Release：

- `.credentials.yaml`、API key、OAuth token、Cookie；其中 rc1 首次启动会在本机创建仅用于浏览器 Cookie 签名的内部 grant，但发行包不会预置、读取或上传它；
- 会话历史、工作区登记、审批和定时任务状态；
- SSH 私钥、known_hosts、远程主机与项目登记；
- 日志、PID、备份和用户自己的 `settings.yaml`。

安装新电脑只安装程序。旧电脑的数据迁移是另一个显式流程，见 [私有数据与迁移](docs/PRIVATE_STATE.md)。不要把整个数据目录提交到 GitHub。

## 开发与发布

版本事实源是 [release-lock.json](manifest/release-lock.json)。所有内置 tgz、Node 运行时和上游提交均固定版本与 SHA-256。构建命令只在维护发行版时使用：

```powershell
npm run check
npm test
npm run build
npm run acceptance
```

构建结果写入 `dist/`，隔离验收写入 `.install-test/`，两者都不会提交。详细设计见 [发行架构](docs/ARCHITECTURE.md) 和 [升级与回滚](docs/UPGRADE_AND_ROLLBACK.md)。
