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

$processSnapshot = @(Get-CimInstance Win32_Process)
$descendants = @()
$frontier = @([pscustomobject]@{ ProcessId = $savedPid; Depth = 0 })
while ($frontier.Count -gt 0) {
    $current = $frontier[0]
    $frontier = @($frontier | Select-Object -Skip 1)
    $children = @($processSnapshot | Where-Object { $_.ParentProcessId -eq $current.ProcessId })
    foreach ($child in $children) {
        $entry = [pscustomobject]@{
            ProcessId = [int]$child.ProcessId
            Depth = [int]$current.Depth + 1
        }
        $descendants += $entry
        $frontier += $entry
    }
}

$stopOrder = @($descendants | Sort-Object Depth -Descending | Select-Object -ExpandProperty ProcessId)
$stopOrder += $savedPid
foreach ($processId in $stopOrder) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
$deadline = (Get-Date).AddSeconds(10)
while ((@($stopOrder | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -gt 0) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
$remaining = @($stopOrder | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
if ($remaining.Count -gt 0) { throw "DSH 进程树未在 10 秒内停止：$($remaining -join ', ')" }

Remove-Item -LiteralPath $pidFile -Force
Remove-Item -LiteralPath $runStateFile -Force -ErrorAction SilentlyContinue
Write-Output 'STATUS=STOPPED'
Write-Output "PID=$savedPid"
Write-Output "DESCENDANTS_STOPPED=$($descendants.Count)"
