# Desktop rc.5 安装与发行

首次安装或从旧桌面版升级，先正常退出 Desktop（含托盘），下载固定
[Install-Desktop.ps1](https://github.com/gyyxs88/dsh-custom-distribution/releases/download/desktop-v0.2.1-rc.5.1/Install-Desktop.ps1)，
右键“使用 PowerShell 运行”。无需管理员、Node/npm 或编译工具。

脚本检测当前用户已安装的精确官方 rc.5；缺失或版本不符时下载固定官方安装器，
校验大小、SHA512 与 Authenticode 发布者后打开官方向导。完成页取消立即启动，
插件安装完成后从官方快捷方式打开。

[Desktop prerelease](https://github.com/gyyxs88/dsh-custom-distribution/releases/tag/desktop-v0.2.1-rc.5.1)
提供六个固定插件 tgz 的 ZIP、manifest 和安装/检查/回退入口，与旧 Web Latest 分开。
官方 EXE 与 ASAR 不做修改；当前用户配置、会话、provider、默认模型、patch 和兼容记录保留。
安装前自动私有备份，回退只撤回安装器管理的插件与元数据改动。

完整步骤、参数、离线安装、检查/回退及验收边界见 [桌面安装发行说明](../docs/桌面安装发行说明.md)。

维护者用 `node scripts/Build-DesktopBundle.mjs <空输出目录> <六包所在目录>` 生成 ZIP、
内嵌 ZIP SHA256 的独立 bootstrap、校验表和资产清单。构建不发布、不执行 npm 安装、
不重建插件；六包身份和兼容协议以 `releases/0.2.1-rc.5.1/manifest.json` 为准。
插件直接离线安装，由官方 Desktop Host 提供运行模块解析；许可通过官方 API 合并。

当前 runtime 为 `0.2.1-rc.5`，compat/TPS 为 `0.2.1-rc.5.1`。GenUI、remote、session-control、
codeagents 四包沿用原 tgz；对这四个精确包版本加入 rc.5 兼容许可，并保留旧许可。
旧 `releases/0.2.1-rc.3.1` 仍保留，可用于配套旧 runtime 的回退。

维护者可用以下入口重建两个适配包；四个复用包只验证固定字节，不重建：

```text
node desktop/releases/0.2.1-rc.5.1/Reproduce.mjs <official-app.asar> <new-output-directory>
node scripts/Build-Desktop.mjs <new-output-directory> <official-app.asar>
node scripts/Build-Tps021.mjs <ready-pointer.json> <new-output-directory>
node scripts/Release-Desktop.mjs <new-output-directory> <official-app.asar> <official-electron.exe>
node scripts/Test-Desktop.mjs <isolated-output-directory> <official-app.asar> <official-electron.exe>
```

`ready-pointer.json` 包含 `status: "READY"`、`version: "0.2.1-rc.5"`、相对该文件的 `archive` 路径及
`sha256.archive`；必须对应 manifest 指定的原始 ASAR。构建不修改官方程序。
Release/Test 保持原有隔离模拟集成门禁；Source/Reproduce 检查可单独运行。
发布仍需主控独立验收。

既有验收覆盖隔离 HTTP/SSE 模拟、插件加载、TPS/思考展示的组件契约及本机安装数据检查。
这些结果不代表真实 provider 业务调用、跨机 SSH、外部编码流程、NSIS 实际交互向导或 UI 目视验收。
本次源码、固定字节、重现及隔离模拟检查不计为上述未验收项目的通过。
公开来源与许可见 [provenance](releases/0.2.1-rc.5.1/source/provenance.json)，
发行说明见 [rc.5.1 说明](releases/0.2.1-rc.5.1/source/RELEASE-NOTES.md)。

针对当前发布的隔离安装测试位于 `tests/desktop-install*`。
历史 rc.2 工程说明见 [原升级记录](../docs/desktop-0.2.1-rc.2-upgrade.md)，不作为当前安装入口。
