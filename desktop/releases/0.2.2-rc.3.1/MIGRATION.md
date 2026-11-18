# Desktop 迁移与回退

先退出 Desktop，确认托盘和后台进程已经停止，再备份整个 DSH home，以及其中链接到目录外的数据。保留原官方程序或可核验的原版本安装器。冷备应包含会话数据库、附件、pending、配置、凭据和定时任务相关数据，并保存在当前机器控制的私有位置。

从已完成 0.2.2 历史迁移的 rc.1 升级时，核对现有定时任务和会话状态。首次从旧数据格式升级时，在第一次启动 rc.3 之前完成旧 Schedule 的离线迁移和对账，要求 `unresolved=[]`。先在冷备副本验证 [已有历史迁移流程](https://github.com/gyyxs88/dsh-custom-distribution/blob/desktop-v0.2.2-rc.1.2/desktop/releases/0.2.2-rc.1.2/MIGRATION.md)。安装器负责插件安装，历史迁移由操作者完成。

rc.3 的 AgentTeam 由官方运行时内置。安装时会从 Desktop profile 的 bundles 清单移除 rc.1 的实验 AgentTeam 条目。插件回退会恢复先前的条目、受管插件及发行收据。

回退前，先冷备当前的完整数据。用本 Release 的安装入口运行 `-Action Rollback` 来恢复由它安装的受管插件。需要回退官方程序及历史时，单独恢复对应版本的程序和兼容的数据副本。保留升级后新增历史的冷备，以便另行处理。手动部署使用其部署时记录的回退事务。
