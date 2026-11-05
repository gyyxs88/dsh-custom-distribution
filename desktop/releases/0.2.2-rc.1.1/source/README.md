# Desktop 0.2.2-rc.1.1 公开源码与重现

本目录描述本轮六包，准确身份在 `../manifest.json`。manifest 的 frozen 为 false 时，
此树是预备快照；不能作为最终发行或以预备回归替代冻结后的消费者门禁。
`candidate.json` 记录交接状态与上游库存摘要，`input-files.json` 固定公开构建文件。

## 包与改动

| 包 | 版本 | 重现方式 |
| --- | --- | --- |
| dsh-desktop-compat | 0.2.2-rc.1.1 | 从 sources/dsh-desktop-0.2.2-rc.1.1/build-inputs/packages 的完整 JS 源固定打包 |
| dsh-tps-correction | 0.2.2-rc.1.1 | 从原始官方 ASAR 和 sources/dsh-desktop-0.2.2-rc.1.1/build-inputs/work 的生成器重建 |
| dsh-session-control | 0.8.6-dsh022.1 | 从 sources/dsh-desktop-0.2.2-rc.1.1/build-inputs/packages 固定打包，含离线 Schedule 迁移实现与 CLI |
| dsh-remote-control | 0.3.4-dsh022.1 | 从 sources/dsh-desktop-0.2.2-rc.1.1/build-inputs/packages 固定打包 |
| @omdsh-dev/dsh-genui | 0.9.1-dsh021.3 | 原 tgz 复用，完整源码/编译产物在 build-inputs/reused，逐文件核对后复制原字节 |
| dsh-subagent-code-agents | 0.2.4-dsh021.1 | 原 tgz 复用，完整源码/运行依赖在 build-inputs/reused，逐文件核对后复制原字节 |

compat 使用官方 `llm-pi-ai/request-headers` hook，退出对 snapshot 的自定义身份头改写；
复制会话 ID 由官方菜单提供。其余已验证的发现/错误分类补充按精确运行时契约保留。
Session/remote 适配官方 0.2.2 API；Session 按 Host Schedule/Storage Domain 契约接线，
旧 Session-owned schedule/change 不会被官方 Host 自动导入。
TPS 保留接收估算、官方 usage 与思考展示，按目标官方源生成外置 trajectory overlay，
不改写官方 EXE/ASAR。源码目录中的 rc021 名称属于生成器历史命名，不表示目标版本仍是 rc.2。

## 重现

```text
node desktop/releases/0.2.2-rc.1.1/Reproduce.mjs <原始官方resources/app.asar> <全新输出目录>
```

未冻结期间仅允许显式追加 `--preliminary`，输出状态为 PRELIMINARY_INPUTS_REPRODUCED。
正式入口检查 frozen，所有公开输入摘要、六包摘要与原始 ASAR 摘要。
重建 compat/session/remote/TPS 四包；GenUI/codeagents 的全部源码载荷与原 tgz 核对后
复制固定字节，不声称重新编译这两个历史包。官方二进制须由调用者取得，不包含在仓库或 ZIP。
无 npm 安装、生命周期脚本、provider、SSH、外部编码任务或机器状态导入。

候选的 TPS 暂存输出约束已在公开副本中改为“显式新/空输出目录”，不改变生成的包载荷。
历史包内部 README、示例与路径是原始载荷的一部分；不改包字节来更新历史说明。
本说明、发行说明与 INSTALL.md 描述当前版本，历史示例不参与安装定位。

## 离线 Schedule 迁移

先正常退出 Desktop，完成官方程序、整个 DSH home 和外部配置数据路径的一致性冷备。
确认正确的 sessionsRoot、storage-json root 和 Session Control stateDir，不猜测自定义路径。
使用精确官方 Electron 的 Node 模式运行包内 `scripts/Migrate-Schedules.mjs`：

```text
<官方Electron> <session包>/scripts/Migrate-Schedules.mjs <原始ASAR绝对路径> <sessionsRoot绝对路径> <storageJsonRoot绝对路径> <stateDir绝对路径> <输出报告绝对路径>
```

进程设置 `ELECTRON_RUN_AS_NODE=1`，DSH_HOME 指向待迁移的离线 home；所有参数为明确绝对路径。
默认 plan，`--apply` 才写 Host Schedule domain 与 operation 对账；压缩默认为 zstd，
无压缩历史显式用 `--compression=none`。要求 plan.unresolved 为空；apply 后复查报告和
持久状态，无未对账项后才能首次启动 Host。有未结/冲突时停止并保留现场。
脚本读取会话以保留旧任务 ID/精确记录，不重放业务、不启动模型。
离线 plan 会初始化所指定的存储/operation 目录，因此也须在冷备后、Desktop 停止时执行。

发行安装器仅管理插件与元数据，不自动迁移历史或启动 Desktop。
生产迁移报告属于本机私有验收材料，不进入公开源码或 Release。
回退前保存当时最新的完整 home、附件、pending 和配置；先评估格式兼容性，再选择当前数据或升级前一致性冷备。
旧备份不会自动合并升级后产生的新历史，保留最新备份供独立导出或恢复。

## 许可与验收

发行层采用仓库 LICENSE。保留各包中的 LICENSE、官方衍生 TPS 的 LICENSE.deepseek，
以及两个原包内依赖的许可文件。候选 API/权限/Projection/迁移检查与发行消费者门禁分开记录。
源码重现、官方 Host 加载和本机 mock 不能代替真实 provider、SSH、外部编码、NSIS 向导、
UI 目视或发布后从 GitHub 明确 tag 下载原 bootstrap 的验收。
