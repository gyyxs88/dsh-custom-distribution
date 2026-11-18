# DSH Desktop 0.2.2-rc.3.1 安装说明

本发行面向 Windows x64，使用官方 DeepSeek Harness Desktop `0.2.2-rc.3`。桌面兼容层和 TPS 插件升级到 `0.2.2-rc.3.1`，另外四个插件沿用上一发行的原始包，使用仅针对这个运行时的兼容许可。版本与摘要见 [manifest.json](manifest.json)。

1. 保存工作，正常退出 Desktop 和托盘。如有既有数据，先按 [迁移与回退](MIGRATION.md) 完成冷备和定时任务核对。
2. 从 [GitHub Release](https://github.com/gyyxs88/dsh-custom-distribution/releases/tag/desktop-v0.2.2-rc.3.1) 下载 `Install-Desktop.ps1`，在 PowerShell 中运行。也可校验并解压同一 Release 的 ZIP，运行其中的 `scripts/Install-Desktop.ps1`。
3. 如果本机没有匹配的官方程序，安装器会校验官方签名和固定摘要，再打开官方安装向导。向导结束时取消立即启动。自定义安装路径可用 `-DesktopPath <目录>` 指定。
4. 安装完成后用同一脚本运行 `-Action Verify`。确认迁移核对完成，再打开 Desktop，检查既有插件、历史和定时任务。

安装入口会固定 Release、manifest、官方程序和六个包的摘要。独立入口会核验下载的 ZIP。官方程序由 DeepSeek 提供，发行包只携带插件、安装入口和说明。
