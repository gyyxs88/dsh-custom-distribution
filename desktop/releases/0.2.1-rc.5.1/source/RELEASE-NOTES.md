# Desktop v0.2.1-rc.5.1

本独立 Desktop prerelease 固定官方 runtime `0.2.1-rc.5`，与旧 Web Latest 分开。
官方安装器、EXE、ASAR 均采用 manifest 指定的原始程序，不重打包 ASAR。

compat 和 TPS 更新为 `0.2.1-rc.5.1`。compat 只更新精确版本契约与诊断文字；
TPS 从 rc.5 官方客户端生成 ActivityPill 补充与 trajectory overlay，保留五个精确转换，
不替换官方 chat 本体，保留 rc.5 新思考展示。两个适配包均可从公开冻结输入和原始 ASAR 重建。

GenUI `0.9.1-dsh021.3`、remote `0.3.3-dsh021.3`、session-control `0.8.5-dsh021.2`、
codeagents `0.2.4-dsh021.1` 直接复用原 tgz，不重建。安装器为这四个精确包版本合并 rc.5 许可，
保留既有兼容记录、其它插件和用户数据。旧 rc.3 发行目录保持可用；回退需匹配旧 runtime 与适配包。

验收范围包括既有隔离模拟、实际官方模块加载、组件契约回放和本机安装数据检查；
当前检查验证六包固定字节、两个适配包重现和正常 Release/Test 隔离模拟入口。
真实 provider 业务调用、跨机 SSH、外部编码、NSIS 实际交互向导及 UI 目视尚未验收。
程序签名和摘要核验不等同于实际向导或视觉验收。

下载固定 Release 的 `Install-Desktop.ps1`，正常退出 Desktop（含托盘）后右键使用 PowerShell 运行。
如需安装官方 runtime，完成向导时取消立即启动，待插件安装完成后从官方快捷方式启动。
安装、检查与回退参数见仓库的桌面安装发行说明。
