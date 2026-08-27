# Windows 安装说明

## 图形化思路

当前首版使用一个签名边界清晰的 PowerShell 安装脚本，而不是传统 MSI。用户只需要从 GitHub Release 下载 `Install-DSH.ps1` 并运行；脚本会下载完整离线包、校验、安装、启动并验证。

默认不需要管理员权限，不写系统目录，不注册 Windows 服务，不修改系统级 PATH。

## 指定安装目录或端口

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-DSH.ps1 `
  -InstallRoot 'D:\Apps\DSH-Custom' `
  -Port 3080
```

如果端口已占用，启动器会选择一个空闲的 loopback 端口，并在输出和 `data\run\web-ui.json` 中记录实际地址。

启动器只为 DSH 子进程启用 Node 环境代理，使外部 provider 遵循当前用户已有的 `HTTP(S)_PROXY` / `ALL_PROXY`；`127.0.0.1`、`localhost` 和 `::1` 会被合并进 `NO_PROXY`，不会改写用户级或系统级环境变量。

## 完全离线安装

下载 Release zip 和同名 `.sha256` 到同一目录，解压 zip 后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Bundle.ps1 `
  -BundleRoot $PWD
```

离线包已经包含 Node、DSH 的 `node_modules` 和 profile 的 `node_modules`。目标电脑不需要 npm 安装，也不会执行第三方 lifecycle script。

## 首次配置

首次打开 DSH 后，由用户自己在界面中配置 provider 与模型。不要把旧电脑的 API key 粘进安装脚本，也不要把 `.credentials.yaml` 上传到 GitHub。

安装器会放置一个中性的 `data\AGENTS.md` 示例；如果该文件已经存在则绝不覆盖。公司或项目专用规则应在目标电脑上单独配置。
