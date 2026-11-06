# 既有历史的首次启动前置要求

官方 0.2.2-rc.1 的 Host Schedule 不自动导入旧版 Session-owned `schedule/change`。
已有历史的用户须完成以下步骤；新建空 profile 不需要迁移旧任务。

1. 正常退出 Desktop，包括托盘，确认无运行中任务。
2. 保存官方程序、整个 DSH home 及配置中使用的外部数据目录的一致性冷备；保留旧版本以便回退。
3. 安装本发行插件，但暂不打开新 Desktop。
4. 确认实际 sessionsRoot、storage-json root 和 Session Control stateDir。自定义路径须按原配置确定，不能猜测默认值。
5. 使用已安装 `dsh-session-control/scripts/Migrate-Schedules.mjs` 离线 plan，再 apply；核对任务 ID、记录、operation 对账和 `unresolved=[]` 后才打开 Desktop。冲突或未结项须先处理，不能跳过。

维护者执行方式（所有路径均为明确绝对路径）：

```text
<官方Electron> <session包>/scripts/Migrate-Schedules.mjs <原始ASAR> <sessionsRoot> <storageJsonRoot> <stateDir> <输出报告>
```

该进程设置 `ELECTRON_RUN_AS_NODE=1`，DSH_HOME 指向离线 home。默认只计算 plan，
plan 会初始化指定存储/operation 目录；也须先冷备并保持 Desktop 停止。
确认报告无未对账项后，使用新的输出报告路径追加 `--apply` 执行迁移，随后重新核对。
历史压缩默认为 zstd；无压缩存储显式加 `--compression=none`。
脚本保留旧任务 ID/精确记录，不发模型请求、不重放业务；所有备份保留。

本发行安装器仅管理插件和元数据，提示此要求，不自动迁移历史或启动 Desktop。
插件回退不会自动撤销 Schedule domain 或会话格式迁移。回退前先保存回退当时最新的完整 home、附件、pending 和配置，保留升级后新产生的数据。
根据新旧程序的数据格式兼容性，决定使用当前数据还是恢复升级前的一致性冷备，并恢复配套官方程序。
旧程序不兼容当前格式时，不要直接打开当前数据；恢复旧备份后，升级后的新历史不会自动合并，须保留最新备份供独立导出/恢复处理。
迁移报告、会话内容和私有备份只保存在本机，不提交或上传。
