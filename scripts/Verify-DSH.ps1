[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [switch]$RequireRunning
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$state = Get-InstallState -InstallRoot $InstallRoot
$receipt = Read-JsonFile -Path (Join-Path $state.versionRoot 'install-receipt.json')
$failures = [System.Collections.Generic.List[string]]::new()

if ($receipt.status -ne 'installed' -or $receipt.version -ne $state.version) { $failures.Add('当前版本安装回执无效') }
$nodeExe = Join-Path $state.runtimeRoot 'node.exe'
$entrypoint = Join-Path $state.appRoot 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { $failures.Add('Node.js 不存在') }
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { $failures.Add('DSH 入口不存在') }

$plugins = [ordered]@{
    'dsh-at-file' = '0.6.7'
    'dsh-session-control' = '0.7.2'
    'dsh-remote-control' = '0.2.6'
    'dsh-subagent-code-agents' = '0.1.8'
}
foreach ($entry in $plugins.GetEnumerator()) {
    $path = Join-Path $InstallRoot "data\profiles\web\node_modules\$($entry.Key)\package.json"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures.Add("缺少插件 $($entry.Key)"); continue }
    $package = Read-JsonFile -Path $path
    if ($package.version -ne $entry.Value) { $failures.Add("插件版本错误 $($entry.Key): $($package.version)") }
}

$process = Test-RecordedDshProcess -InstallRoot $InstallRoot
if ($RequireRunning -and -not $process) { $failures.Add('DSH 未运行') }
if ($process) {
    $runState = Read-JsonFile -Path (Join-Path $InstallRoot 'data\run\web-ui.json')
    $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$runState.port) -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.ProcessId } | Select-Object -First 1
    if (-not $listener) { $failures.Add('记录的进程没有监听记录的端口') }
    try {
        $response = Invoke-WebRequest -Uri $runState.url -UseBasicParsing -TimeoutSec 15
        if ($response.StatusCode -ne 200) { $failures.Add("HTTP 状态异常：$($response.StatusCode)") }
    }
    catch { $failures.Add("HTTP 验证失败：$($_.Exception.Message)") }
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }
    Write-Output 'VERIFY_STATUS=FAILED'
    exit 1
}

Write-Output 'VERIFY_STATUS=PASSED'
Write-Output "VERSION=$($state.version)"
Write-Output "RUNNING=$([bool]$process)"
if ($process) {
    $runState = Read-JsonFile -Path (Join-Path $InstallRoot 'data\run\web-ui.json')
    Write-Output "PID=$($process.ProcessId)"
    Write-Output "URL=$($runState.url)"
}
foreach ($entry in $plugins.GetEnumerator()) { Write-Output "PLUGIN_$($entry.Key.ToUpperInvariant().Replace('-', '_'))=$($entry.Value)" }
