# DSH rc.2 输出速度估算补充

目标固定为官方 Desktop **0.2.0-rc.2 / 04f392c9ddd144fa426da2045178797da6db6c11**。包版本 `0.1.0-rc.2.2`；安装只增加外置 profile bundle，不修改 ASAR。它补充一个统一的流式接收 TPS 估算，所有可见入口始终标为 **输出速度（估算）**，不足为 **暂无法计算**。不显示第二种速度。

## 估算口径

仅取最终 `assistant/message` 自己的 `data.stream`，不继承 earlier retry 的首 token 时间。展开 packed `time0 + dt`，包括空片段的时间推进；text、reasoning 和非空 `argumentsDelta` 按 Unicode code point 计内容单位，同时间合批。name-only 工具片段不作内容；跨 delta surrogate pair 在完成时计一个单位。最终 content 与 delta 累积内容核对，未观察到的末尾正文/思考/参数不混入估算。

令该次实际 `usage.outputTokens=U`，总接收单位 `W`，首批单位 `W0`：

`estimatedTokens = U * (W-W0) / W`

`estimatedReceiveTPS = estimatedTokens * 1000 / (lastContentTime-firstContentTime)`

不逐批取整；usage/finish 的网络拖尾不计时。总 usage 按已接收内容单位分摊是假设，不能解释为精确 token 对时或服务器 decode 性能。它也不表示包含首 token 等待的端到端速度。账单原 usage 不变。

至少四个不同内容时间批次、跨度至少200ms；首批占比超过80%，或任意200ms窗口占总单位/扣首批后单位超过80%则排除。还排除缺 usage、缺 provider/model 身份、取消/未完成、无效时序/packed结构、已知不可观测 reasoning、最终内容不匹配。阈值仅排除明显缓冲，不能证明网络无缓冲。异常只输出固定 reason code，不包含参数或正文片段。

会话统计按当前实际 provider/model 分组，对全历史合格请求做 `SUM(estimatedTokens)/SUM(receiveMs)`。A→B→A 恢复 A 组；最新不合格步骤不清空已测均值，运行中的 step 可继续显示已完成请求均值。身份缺失显示不可用，不混其他组。统计 tooltip 明确这是合格完成请求加权平均，非实时速度。Trajectory 每步详情仍按该步单独判断，不合格时不可用。

## 公开接入及官方功能

- 保持官方 Chat 与 `sessionStats`、`tokenUsage` 原投影；后两者继续负责轮步/LLM/tool/TTFT/账单。
- 独立 `tpsCorrectionV2` projection，`stateVersion=2`；官方框架重读原日志生成新派生缓存，不改原日志，不沿用旧 TPS cache。
- `conversation.composer.dock / id=stats` 公开 priority 覆盖统计组件。组件来自固定官方 StatsPills 源片段，保留完整/简洁模式、两类统计详情、精确 token/cache 数字、原样式和关闭/锚定行为；只替换速度读取。缺新投影一律不可用，窗口 fallback 不算速度；一个简单的低优先级占位组件也不使用旧公式。
- 公开 Cordis bundle patch 按官方 id/name 断言停用 `ui-trajectory`，再 insert 唯一外置修订来源。不能用既有 patch 的 `name` 重定向——它只是断言。
- `compat/trajectory` 保持官方 package name/bundle id、全部客户端代码/资源/导出和 `dsh.client` 依赖。仅嵌入共享估算器、从最终消息投影估算结果、替换 throughput 呈现和估算标签。分页、选择详情、正文/思考/工具、耗时与账单功能不删减。

根插件激活时校验当前官方 Chat/Trajectory 的版本及源摘要；上游变化会拒绝激活，须重新审查。`upstream-manifest.json` 固定原始源，`scripts/build-compat.mjs` 要求每个替换锚点精确匹配，生成 `compat-build.json`。MIT 版权及完整许可保存在 `LICENSE.deepseek`、上游和 trajectory 子包 LICENSE。没有 alpha 核心、网络依赖安装或私有猴补丁。

## 构建和验证

从本目录用工程 Node 24 运行：

```powershell
node scripts/build-compat.mjs
node --test test/*.test.mjs
node scripts/pack.mjs D:/Project/deepseek-harness-lab/temp/tps-fix-20261015
```

packer 两次构建逐字节比对，校验 tgz 成员和源摘要，解包到独立版本目录并实际导入共享指标。安装验收另用官方 `D:/DSH/resources/runtime/cli/bin/dsh.cmd plugin --profile desktop add <tgz> --offline --ignore-scripts`，仅在隔离 home 执行；再由同一安装中的官方 `runProfile` 公开入口以 desktop context 启动完整 Host 和浏览器图。真实历史只在内存读取/计算 metadata，不保存正文。全部验证不请求模型、不执行真实管理工具。

本轮主控已独立验收正常/混合/单批/85步分页与刷新、简洁模式和布局；生产发布仍须主控对固定 tgz/离线安装证据给出单独放行。

## 部署、备份与撤回

用户2026-10-15授权验证后更新桌面。开发子agent `01a13e99-4f76-77f2-9916-9c768f4b6bdb` 实现，主控独立验收；主控放行前生产配置和进程不动。

放行后先对外置 profile 的插件 package/lock/patch 做受限ACL备份并固定 SHA；保留现有其他插件和 provider/model 配置。通过官方离线入口添加固定 tgz，让官方 bundle composition 精确停用旧 trajectory/启用唯一替代来源，不 eval 用户 patch 的 `!js`。对用户 patch 的任何必要调整只走 AST 并验证无关语义不变。没有冲突时不改用户 patch。空闲窗口按授权重启，核对 Main/Host/19387、全部 TPS 入口与生产数据完整性。备份不包含凭据正文。

回滚通过官方包入口撤下该 bundle，恢复插件登记/锁及必要 patch 的受限备份；重新加载后恢复官方 trajectory 与 stats 原入口。原始日志、附件、workspace及账单未被本包改变。官方完整覆盖并在无补充的隔离环境通过同样历史/混合/burst/分页验收后，撤下本补充，不仅凭版本号判断。
