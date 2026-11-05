# Desktop v0.2.2-rc.1.1

目标官方 Windows x64 runtime 为 `0.2.2-rc.1`；独立 Desktop prerelease，保持 Web Latest `v0.5.1`。
是否已冻结以 manifest.frozen 为准；尚未发布时下载链接不可用。
官方安装器经过大小/SHA512/发布者核验，EXE/ASAR 保持原始字节。

六包全部保留：compat/TPS `0.2.2-rc.1.1`、Session `0.8.6-dsh022.1`、remote `0.3.4-dsh022.1`；
GenUI `0.9.1-dsh021.3` 和 codeagents `0.2.4-dsh021.1` 复用原 tgz。
安装器仅为这两个固定复用版本合并目标运行时许可，保留旧兼容记录。

compat 将 pi-ai 身份请求头接入官方动态请求头 hook，退出旧 snapshot 头改写；
自定义复制会话 ID 入口退出，使用官方菜单。已验证的发现与错误分类补充继续保留。
Session/remote 更新工具、异步 Projection、模型选择与 Host Schedule 等目标 API 契约；
Session 附带旧 Schedule 离线迁移脚本。TPS 从目标官方客户端重建估算补充与外部 overlay，
保留官方 usage/思考展示和五项精确转换，ASAR 不修改。

已有历史必须在首次启动前完成一致性冷备和离线 Schedule 迁移/对账，要求 unresolved=[]。
官方 Host 不自动导入旧 schedule/change。安装器不自动迁移历史或启动程序；准确步骤见
[安装说明](../INSTALL.md) 和 [源码说明](README.md)。

固定 manifest 同时 pin 官方程序、六包与精确许可；支持旧 rc.3.1/rc.5.1 receipt 的受管升级。
安装前备份，文件改动或依赖冲突时拒绝覆盖，回退保留后来用户设置。旧 release 输入保持不变。
完整公开输入可重建四个适配包并核对两个复用包的全部载荷和固定字节。

发行资产为固定 ZIP、Install-Desktop.ps1、SHA256SUMS.txt、publish-assets.json。
公开下载、真实 provider、SSH、外部编码、NSIS 实际向导和 UI 目视验收均按实际记录披露，
不以源码重现或隔离模拟声称通过。
