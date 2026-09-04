# Third-party notices

本仓库是非官方社区发行层，不改变上游组件的所有权或许可证。

| 组件 | 固定版本/提交 | 许可证 | 来源 |
| --- | --- | --- | --- |
| DeepSeek Harness | 0.1.2-rc.1 / a66e470 | MIT | https://github.com/deepseek-ai/deepseek-harness |
| @deepseek-ai/dsh-app-boot | 0.1.2-rc.1 + windows-module-fallback-proxy.2 | MIT | 本仓库 `sources/dsh-app-boot-windows-module-proxy`；上游 https://github.com/deepseek-ai/deepseek-harness |
| Node.js | 24.19.0 | Node.js 许可证集合 | https://nodejs.org/dist/v24.19.0/ |
| dsh-genui | 1ca5da4eb9394972cce2c1ccacfedc22eec3166b | 以组件仓库为准 | https://github.com/omdsh-dev/dsh-genui |
| dsh-local-service-control | 0.2.0 | MIT | 本仓库 `sources/dsh-local-service-control` |
| dsh-session-control | 0.8.0 / a2b819c | MIT | https://github.com/gyyxs88/dsh-session-control |
| dsh-remote-control | 0.3.0 / 495ecea | MIT | https://github.com/gyyxs88/dsh-remote-control |
| dsh-subagent-code-agents | 0.2.0 / 82f8ed0 | MIT | https://github.com/gyyxs88/dsh-subagent-code-agents |
| dsh-at-file | 0.6.9（基于 0.6.7） | MIT | 本仓库 `sources/dsh-at-file-settings-rc1` |

`dsh-at-file@0.6.7` 的包元数据没有声明源码仓库，且该版本不在公开 npm registry 中。发行版保留其 MIT 制品内容，并在 `0.6.9` 快照中迁移 DSH `0.1.2` 删除的设置命名空间辅助函数，同时对齐 rc1 浏览器静态模块表；若后续找到正式源码仓库，应补齐来源并重新固定摘要。

六个 DeepSeek Harness 本地修订包均保留其包内 MIT LICENSE：

- `@deepseek-ai/dsh-app-boot`：便携 Windows 启动器可显式选择 DSH 自身的 ESM module proxy，避免依赖安装卷的 Junction 遍历能力；
- `@deepseek-ai/dsh-llm-pi-ai`：把供应商 `network_error` 归类为可重试的 `TRANSPORT`，并为明确登记的 OpenRouter/OpenCode 路由提供实时模型发现与安全静态回退；
- `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-api-remotes`：在核心服务与浏览器 RPC 中保留模型图片和思维能力；
- `@deepseek-ai/dsh-client-ui-settings-models`：编辑模型能力、默认思维强度与 OpenRouter 上游路由；
- `@deepseek-ai/dsh-client-ui-workspace`：会话菜单复制持久会话 ID。

非用户消息来源显示由上游 DSH `0.1.2-rc.1` 的官方 Chat 投影提供，本发行不再覆盖该组件。

完整文件名、版本、来源和 SHA-256 以 `manifest/release-lock.json` 为准。Node.js 运行时随 Release 打包时保持官方 zip 原样，并在安装前再次校验官方 SHA-256。
