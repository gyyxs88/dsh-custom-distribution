# Desktop 迁移与回退

退出 Desktop 和托盘后，备份整个 DSH home、其中链接到目录外的数据和原版本的官方程序。冷备应包含历史会话、附件、待处理消息、设置与定时任务数据。

从 `desktop-v0.2.2-rc.3.1` 升级时，先记录现有定时任务的状态、下次运行时间和会话关联，升级后逐项对照。首次从旧数据格式升级时，在首次启动前按 [旧 Schedule 离线迁移流程](https://github.com/gyyxs88/dsh-custom-distribution/blob/desktop-v0.2.2-rc.1.2/desktop/releases/0.2.2-rc.1.2/MIGRATION.md) 完成导入与对账，确保 `unresolved=[]`。先在冷备副本演练。安装脚本管理插件，历史迁移是单独的操作。

回退前先备份当时最新的完整数据。用本 Release 的入口运行 `-Action Rollback` 来恢复它管理的插件和发行记录。官方程序和历史需要回退时，另行恢复对应版本的程序并验证数据副本可读，保留升级后的历史副本。手动部署沿用本次部署记录的回退入口。
