# 发行架构

## 为什么单独建仓库

`dsh-session-control`、`dsh-remote-control`、`dsh-subagent-code-agents` 仍是各自独立的源码和发布仓库。本仓库只负责把一组已经验收的版本组合成完整 DSH，避免把插件源码、DSH 上游源码和本机运行状态混在一个仓库中。

版本关系由 `manifest/release-lock.json` 固定。每次发行都必须显式更新版本、提交和 SHA-256，不能使用 `latest`、版本范围或运行时 PATH 猜测。

## Release 结构

Windows Release zip 内包含：

- 官方 Node.js x64 zip，保持原始 SHA-256；
- 已按根 `package-lock.json` 完成安装的 DSH app 压缩层；
- 已按 profile 清单完成安装的插件压缩层；
- 安装、启停、验证、升级和回滚脚本；
- 版本锁、模板、许可证和公开文档。

外层 zip 有独立 `.sha256`。安装器先校验外层包，再校验 Node、app、profile 和十四个定制 tgz；任何摘要或包身份漂移都会停止安装。

## 安装布局

默认根目录：`%LOCALAPPDATA%\DSH-Custom`。

```text
DSH-Custom/
  bin/                    日常操作入口
  current.json            当前与上一版本指针
  shared/runtime/         固定 Node.js
  versions/0.1.0/
    app/                  DSH 与根依赖
    profile/web/          插件层的可回滚副本
    install-receipt.json  持久安装回执
  data/
    profiles/web/         当前激活的 profile
    sessions/             私有会话状态
    storages/             私有工作区和应用状态
    session-control/      私有会话控制状态
    remote-control/       私有远程主机状态
    logs/                 本机日志
    run/                  PID 与访问地址
    backups/              切换版本时保留的 profile
```

程序版本不可变地保留在 `versions/`；私有状态只在共享的 `data/` 下。激活新版本时先复制完整 profile 到临时目录，再保留旧 profile 备份，最后原子写入 `current.json`。

## Runtime 与认证边界

发行版不复制本机已登录的 Codex、Claude Code、Grok Build 或 OpenCode/ACP。安装器只检查当前用户目录中已知的绝对入口，并把实际存在的入口写入 profile。Claude Agent SDK 及其 Windows 平台配套包按固定版本安装，不包含本机工具的账户或登录状态。

发行版不读取或复制这些工具的登录目录。升级快照只在本机复制 DSH 持久数据，不解析或输出凭据内容；快照不会打包或上传。远端 Runtime 仍由 `dsh-remote-control` 的受信制品和认证流程管理。
