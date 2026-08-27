# Third-party notices

本仓库是非官方社区发行层，不改变上游组件的所有权或许可证。

| 组件 | 固定版本/提交 | 许可证 | 来源 |
| --- | --- | --- | --- |
| DeepSeek Harness | 0.1.1-rc.2 | MIT | https://github.com/deepseek-ai/deepseek-harness |
| Node.js | 24.19.0 | Node.js 许可证集合 | https://nodejs.org/dist/v24.19.0/ |
| dsh-genui | 1ca5da4eb9394972cce2c1ccacfedc22eec3166b | 以组件仓库为准 | https://github.com/omdsh-dev/dsh-genui |
| dsh-session-control | 0.7.1 / 14c80dc | MIT | https://github.com/gyyxs88/dsh-session-control |
| dsh-remote-control | 0.2.5 / dff388d | MIT | https://github.com/gyyxs88/dsh-remote-control |
| dsh-subagent-code-agents | 0.1.7 / 0d62c85 | MIT | https://github.com/gyyxs88/dsh-subagent-code-agents |
| dsh-at-file | 0.6.7 | MIT | 精确制品随本仓库保留 |

`dsh-at-file@0.6.7` 的包元数据没有声明源码仓库，且该版本不在公开 npm registry 中。为保证当前发行可重现，本仓库只保留原包内标为 MIT 的精确 tgz，不声称拥有缺失的上游源码来源。若后续找到正式源码仓库，应在新的发行版本中补齐来源并重新固定摘要。

三个 DeepSeek Harness 本地修订包均保留其包内 MIT LICENSE：

- `@deepseek-ai/dsh-llm-pi-ai`：把供应商 `network_error` 归类为可重试的 `TRANSPORT`，并为明确登记的 OpenRouter/OpenCode 路由提供实时模型发现与安全静态回退；
- `@deepseek-ai/dsh-client-ui-conversation`：显示非用户消息的可信来源；
- `@deepseek-ai/dsh-client-ui-workspace`：会话菜单复制持久会话 ID。

完整文件名、版本、来源和 SHA-256 以 `manifest/release-lock.json` 为准。Node.js 运行时随 Release 打包时保持官方 zip 原样，并在安装前再次校验官方 SHA-256。
