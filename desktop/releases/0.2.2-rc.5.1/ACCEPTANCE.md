# Desktop 0.2.2-rc.5.1 验收

- 官方 stable 安装程序的大小、SHA-512 和 Authenticode 签名通过核对。候选运行时 EXE 和 ASAR 与 [固定 manifest](manifest.json) 一致。
- 兼容层与 TPS 两个包从冻结源码重打，与验收包逐字节一致。其余四包按上一发行的 SHA-256 核对。
- 隔离验收覆盖模型兼容、TPS 估算、官方 Desktop Host 加载、从 rc.3 升级以及回退后读取新版创建的测试会话和定时任务。正式环境切换后核对了插件激活、历史会话、附件、待处理消息及定时任务。
- Windows PowerShell 5.1 和 PowerShell 7 验证安装、旧发行升级、重复执行、核验和插件回退。测试使用已提取的官方程序、独立 profile 与合成数据。实际官方安装向导交互、外部模型和 SSH 调用不在本次验收范围。
