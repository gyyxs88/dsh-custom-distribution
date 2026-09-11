# Third-party notices

本仓库是非官方社区发行层，不改变上游组件的所有权或许可证。

DeepSeek Harness 0.1.5-rc.2 固定上游提交 fb2c4b9e698e30edb738bca4cf0618587db7d203，采用 MIT 许可证。Node.js 24.19.0 保留官方归档与许可证集合。

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| @deepseek-ai/dsh-app-boot | 0.1.5-rc.2 | sources/dsh-app-boot-windows-module-proxy |
| @deepseek-ai/dsh-llm | 0.1.5-rc.2 | sources/dsh-llm-model-discovery-capabilities |
| @deepseek-ai/dsh-api-remotes | 0.1.5-rc.2 | sources/dsh-api-remotes-model-discovery-capabilities |
| @deepseek-ai/dsh-llm-pi-ai | 0.1.5-rc.2 | sources/dsh-llm-pi-ai-live-discovery |
| @deepseek-ai/dsh-client-ui-settings-models | 0.1.5-rc.2 | sources/dsh-client-ui-settings-models-image-modalities |
| @deepseek-ai/dsh-client-ui-workspace | 0.1.5-rc.2 | sources/dsh-client-ui-workspace-copy-session-id |
| @deepseek-ai/dsh-session-format-v0-to-v1 | 0.1.5-rc.2 | sources/dsh-session-format-v0-to-v1 |
| @deepseek-ai/dsh-client-modules | 0.1.5-rc.2 | sources/dsh-client-modules |
| dsh-at-file | 0.6.10 | sources/dsh-at-file-settings-rc1 |
| dsh-local-service-control | 0.2.1 | sources/dsh-local-service-control |
| @omdsh-dev/dsh-genui | 0.9.1-dsh015.1 | sources/dsh-genui / 1ca5da4eb9394972cce2c1ccacfedc22eec3166b |
| dsh-remote-control | 0.3.1 | https://github.com/gyyxs88/dsh-remote-control / 15232e72df4ebfcd5e1bd60a0e86614a61eba05f |
| dsh-session-control | 0.8.1 | https://github.com/gyyxs88/dsh-session-control / 077769e550cc52aafac2ff2fe1b7f9b3b502c5b9 |
| dsh-subagent-code-agents | 0.2.1 | https://github.com/gyyxs88/dsh-subagent-code-agents / f66bcd51138dd09adaf29b82dedfd2fe70e8fcdb |

上述组件的许可证均为 MIT，归档保留包内许可证和上游声明。GenUI 基于 1ca5da4eb9394972cce2c1ccacfedc22eec3166b，仅调整 rc2 兼容元数据。dsh-at-file 的上游 0.6.7 未声明源码仓库；保留已审阅制品，继续维护设置命名空间、浏览器静态存储及弃用依赖适配。

传递依赖各自遵守包内许可证。Claude Agent SDK 0.3.233 的许可标记为 `SEE LICENSE IN README.md`；其配套平台包固定为同一版本，保留上游声明。Node.js、SDK 和其他传递依赖不因本发行层采用 MIT 而变更许可。

八个官方修订包保留网络错误重试、实时模型发现、能力和路由设置、复制会话 ID、Windows 模块解析以及旧会话来源和描述符兼容。来源、正式插件提交和每个 SHA-256 以 manifest/release-lock.json 为准。
