# DSH Desktop 0.2.2-rc.5.1 安装说明

本发行适用于 Windows x64，使用经过验收的 DeepSeek 官方 Windows stable 构建 `0.2.2-rc.5`。兼容层和 TPS 为 `0.2.2-rc.5.1`。Session Control、Remote Control、GenUI 和 Code Agents 沿用上一发行的制品，并添加针对 rc.5 的精确兼容许可。安装器通过官方运行时部署六个插件。身份及摘要见 [manifest.json](manifest.json)。

1. 保存工作并从托盘正常退出 Desktop。有既有数据时先按 [迁移与回退](MIGRATION.md) 完成冷备与定时任务对账。
2. 从 [GitHub Release](https://github.com/gyyxs88/dsh-custom-distribution/releases/tag/desktop-v0.2.2-rc.5.1) 下载 `Install-Desktop.ps1`，用 PowerShell 运行。也可以核对同一 Release 的 ZIP 的 SHA-256 后解压，运行包内 `scripts/Install-Desktop.ps1`。
3. 如果本机缺少匹配的官方程序，脚本会校验官方 stable 安装器的大小、SHA-512 和签名，再打开安装向导。向导结束时取消立即启动。自定义安装位置用 `-DesktopPath <目录>` 指定。核验以 EXE 和 ASAR 摘要为准。
4. 用同一脚本运行 `-Action Verify`。确认迁移对账完成后打开 Desktop，核对原有插件、会话和定时任务。

Release ZIP 包含插件与安装入口。需要离线安装时，先准备 [已验证的官方 stable 安装器](https://download.deepseek.com/dsh-desk/bin/win-x64/stable/deepseek-harness-0.2.2-rc.5-win-x64.exe) 对应的官方程序。官网通用入口可能提供同一版本号下的另一个构建。
