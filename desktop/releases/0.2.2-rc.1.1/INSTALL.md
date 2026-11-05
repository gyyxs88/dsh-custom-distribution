# Desktop 0.2.2-rc.1 插件发行包

本项目是非官方插件发行层，配合未修改的官方 Windows x64 Desktop `0.2.2-rc.1`。
发行 tag 为 `desktop-v0.2.2-rc.1.1`，使用独立 prerelease；旧 Web `v0.5.1` 保留。
以下下载入口在该 Release 发布后可用。

## 安装或升级

已有会话历史时，**先正常退出、完成一致性冷备，并在首次启动 0.2.2 前完成离线 Schedule 迁移和对账**。
官方 Host 不会自动导入旧 schedule/change。安装器不执行历史迁移，也不会自动启动 Desktop。
迁移须使用包内 Session Control 的脚本，确认正确数据路径与 `unresolved=[]`；操作说明见
[离线迁移说明](MIGRATION.md)。未完成前不要打开新 Desktop。

1. 保存工作并正常退出 DeepSeek Harness，包括托盘程序。
2. 下载 [Install-Desktop.ps1](https://github.com/gyyxs88/dsh-custom-distribution/releases/download/desktop-v0.2.2-rc.1.1/Install-Desktop.ps1)，右键“使用 PowerShell 运行”。无需管理员、Node/npm 或编译工具。
3. 脚本复用精确匹配的官方程序。缺失或版本不符时，验证官方安装器的大小、SHA512 和 Authenticode 发布者后打开当前用户安装向导。完成页取消立即启动；插件安装结束后再从官方快捷方式打开。

如安装目录无法自动发现，可加 `-DesktopPath '<官方程序目录>'` 再运行。
脚本不关闭运行中的程序，不修改 EXE/ASAR，不从 npm 安装核心依赖。

官方安装器来自 [DeepSeek 官方下载](https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe)，
大小为 `293425336` bytes，SHA512（Base64）为：

```text
swcK0J6ofGkaAWLRpOes2ca7CWO8vuM5Vp0FRnQ/DG3q+Z+OhvsgLz3hIiSYpRUETY+fEz+Ww86fNa0jiVIifw==
```

## 离线安装、检查和回退

下载 [固定 ZIP](https://github.com/gyyxs88/dsh-custom-distribution/releases/download/desktop-v0.2.2-rc.1.1/dsh-desktop-v0.2.2-rc.1.1-win-x64.zip)，
解压后右键 `scripts\Install-Desktop.ps1`。ZIP 包含固定插件与 manifest；官方程序不在 ZIP 内。
离线安装要求已有精确匹配的官方程序，否则仍会下载官方安装器。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Desktop.ps1 -Action Verify
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Desktop.ps1 -Action Rollback
```

默认使用当前用户 `.dsh` 的 `profiles/desktop`。安装前保存当前用户/SYSTEM 专属备份。
保留原有会话、工作区、pending、provider、模型、凭据、patch 和其他 bundle。
许可通过官方原子兼容 API 按固定包版本合并，已有记录保留，不授予通配版本。
准确的插件清单与版本以 ZIP 内固定 manifest 为准。

已有 rc.3.1 或 rc.5.1 发行 receipt 时，升级会先核对旧受管插件；改过的插件会停止覆盖。
本版六个插件全部保留；只为固定 GenUI/codeagents 包版本补充精确目标许可。

| 插件 | 版本 |
| --- | --- |
| @omdsh-dev/dsh-genui | 0.9.1-dsh021.3 |
| dsh-desktop-compat | 0.2.2-rc.1.1 |
| dsh-remote-control | 0.3.4-dsh022.1 |
| dsh-session-control | 0.8.6-dsh022.1 |
| dsh-subagent-code-agents | 0.2.4-dsh021.1 |
| dsh-tps-correction | 0.2.2-rc.1.1 |

重复安装核对后返回 `ALREADY_INSTALLED`。Rollback 撤回本次管理的插件、依赖、bundle
及新增许可，恢复旧受管插件和 receipt，并保留后来添加的其他设置。受管内容有冲突时
保存最新备份并拒绝自动覆盖。所有备份保留，不永久删除。

回退前先保存当时最新的完整 home、附件、pending 和配置。再按新旧程序的格式兼容性选择当前数据或升级前一致性冷备，并恢复配套官方程序。
脚本不自动降级程序或撤销数据迁移；恢复旧备份后，新历史不会自动合并，应保留最新备份供独立恢复。不要上传私有备份或 profile。

Verify 检查固定程序、插件文件和精确许可，不发模型请求。安装、离线检查、模拟回归
均不代表真实 provider、跨机 SSH、外部编码任务或 UI 目视已验收。
