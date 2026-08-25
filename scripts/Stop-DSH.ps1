[CmdletBinding()]
param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'))

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$pidFile = Join-Path $InstallRoot 'data\run\web-ui.pid'
$runStateFile = Join-Path $InstallRoot 'data\run\web-ui.json'
if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
    Write-Output 'STATUS=NOT_RUNNING'
    exit 0
}

$savedPid = 0
$text = (Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8).Trim()
if (-not [int]::TryParse($text, [ref]$savedPid)) { throw "PID 文件无效：$pidFile" }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
if (-not $process) {
    Remove-Item -LiteralPath $pidFile -Force
    Remove-Item -LiteralPath $runStateFile -Force -ErrorAction SilentlyContinue
    Write-Output 'STATUS=NOT_RUNNING_STALE_PID_CLEANED'
    exit 0
}

$runState = Read-JsonFile -Path $runStateFile
if (-not $runState.entrypoint -or $process.CommandLine -notlike "*$($runState.entrypoint)*") {
    throw "拒绝停止 PID $savedPid：它不是本发行版记录的 DSH 进程。"
}

Stop-Process -Id $savedPid -Force
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Process -Id $savedPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
if (Get-Process -Id $savedPid -ErrorAction SilentlyContinue) { throw "PID $savedPid 未在 10 秒内停止。" }

Remove-Item -LiteralPath $pidFile -Force
Remove-Item -LiteralPath $runStateFile -Force -ErrorAction SilentlyContinue
Write-Output 'STATUS=STOPPED'
Write-Output "PID=$savedPid"
