[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('restart', 'shutdown')][string]$Action,
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$ExpectedHarnessPid,
    [Parameter(Mandatory)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot 'Service-Control-Worker.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) { throw "服务控制工作脚本不存在：$worker" }
if (-not (Test-Path -LiteralPath $powerShell -PathType Leaf)) { throw "Windows PowerShell 不存在：$powerShell" }

function Quote-Argument([string]$Value) {
    if ($Value.Contains('"')) { throw '控制脚本参数不能包含双引号。' }
    return '"' + $Value + '"'
}

# Start-Process keeps the worker independent from the short-lived launcher while
# avoiding WMI creation failures seen for otherwise valid install roots.
$result = Start-Process -FilePath $powerShell -ArgumentList @(
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    (Quote-Argument $worker)
    '-Action'
    $Action
    '-ExpectedHarnessPid'
    [string]$ExpectedHarnessPid
    '-InstallRoot'
    (Quote-Argument $InstallRoot)
) -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
if (-not $result -or $result.Id -le 0) {
    throw '无法启动独立服务控制进程。'
}

Write-Output 'STATUS=CONTROL_LAUNCHED'
Write-Output "PID=$($result.Id)"
