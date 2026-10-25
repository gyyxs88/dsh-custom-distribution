# Desktop rc.3 安装与发行

家中电脑首次安装或从 rc.2 升级，先正常退出 Desktop（含托盘），下载固定
[Install-Desktop.ps1](https://github.com/gyyxs88/dsh-custom-distribution/releases/download/desktop-v0.2.1-rc.3.1/Install-Desktop.ps1)，
右键“使用 PowerShell 运行”。无需管理员、Node/npm 或编译工具。

脚本检测当前用户已安装的精确官方 rc.3；缺失或版本不符时下载固定官方安装器，
校验大小、SHA512 与 Authenticode 发布者后打开官方向导。完成页取消立即启动，
插件安装完成后从官方快捷方式打开。

[Desktop prerelease](https://github.com/gyyxs88/dsh-custom-distribution/releases/tag/desktop-v0.2.1-rc.3.1)
提供六个固定插件 tgz 的 ZIP、manifest 和安装/检查/回退入口，与旧 Web Latest 分开。
官方 EXE 与 ASAR 不做修改；当前用户配置、会话、provider、默认模型、patch 和兼容记录保留。
安装前自动私有备份，回退只撤回安装器管理的插件与元数据改动。

完整步骤、参数、离线安装、检查/回退及验收边界见 [桌面安装发行说明](../docs/桌面安装发行说明.md)。

维护者用 `node scripts/Build-DesktopBundle.mjs <空输出目录> <六包所在目录>` 生成 ZIP、
内嵌 ZIP SHA256 的独立 bootstrap、校验表和资产清单。构建不发布、不执行 npm 安装、
不重建插件；六包身份和兼容协议以 `releases/0.2.1-rc.3.1/manifest.json` 为准。
插件直接离线安装，由官方 Desktop Host 提供运行模块解析；许可通过官方 API 合并。

针对当前发布的隔离安装测试位于 `tests/desktop-install*`。
历史 rc.2 工程说明见 [原升级记录](../docs/desktop-0.2.1-rc.2-upgrade.md)，不作为当前安装入口。
