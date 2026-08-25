# 升级与回滚

## 升级

运行安装目录中的：

```powershell
& "$env:LOCALAPPDATA\DSH-Custom\bin\Update-DSH.ps1"
```

升级器会记录当前是否运行，安全停止精确的 DSH PID，安装 GitHub 最新 Release，切换版本，验证后恢复原来的运行状态。旧版本目录不会删除。

如果新版本安装或验证失败，升级器会尽力恢复原来版本的运行进程；未得到有效安装回执的新版本不会成为当前版本。

## 回滚

```powershell
& "$env:LOCALAPPDATA\DSH-Custom\bin\Rollback-DSH.ps1"
```

默认切回 `current.json` 记录的上一版本；也可显式使用 `-Version 0.1.0`。回滚只切换程序与 profile，不删除新旧版本，不改写共享 `data/`。

## 状态兼容边界

程序回滚不等于数据模式回滚。若未来 DSH 上游引入不可逆的数据迁移，发布说明必须先声明兼容性和备份步骤；不能把“旧程序能启动”冒充成“新状态可安全降级”。首个 `0.1.0` 发行只有一个程序版本，因此没有伪造可用的上一版本。
