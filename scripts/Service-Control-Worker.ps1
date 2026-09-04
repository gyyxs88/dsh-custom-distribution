[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('restart', 'shutdown')][string]$Action,
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$ExpectedHarnessPid,
    [Parameter(Mandatory)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$InstallRoot = Get-FullPath -Path $InstallRoot
$logRoot = Join-Path $InstallRoot 'data\logs'
$logFile = Join-Path $logRoot 'service-control.log'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Write-ServiceControlLog([string]$Message) {
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ('{0} {1}' -f (Get-Date).ToString('o'), $Message)
}

try {
    Write-ServiceControlLog "ACTION=$Action EXPECTED_PID=$ExpectedHarnessPid HELPER_PID=$PID STATUS=STARTING"
    Start-Sleep -Milliseconds 750
    $running = Test-RecordedDshProcess -InstallRoot $InstallRoot
    if (-not $running -or [int]$running.ProcessId -ne $ExpectedHarnessPid) {
        throw "拒绝控制：当前 DSH PID 与请求中的 $ExpectedHarnessPid 不一致。"
    }
    $state = Get-InstallState -InstallRoot $InstallRoot
    & (Join-Path $PSScriptRoot 'Stop-DSH.ps1') -InstallRoot $InstallRoot |
        ForEach-Object { Write-ServiceControlLog "STOP $_" }
    if ($Action -eq 'restart') {
        & (Join-Path $PSScriptRoot 'Start-DSH.ps1') -InstallRoot $InstallRoot -Port ([int]$state.port) |
            ForEach-Object {
                if ($_ -match '^URL=') { Write-ServiceControlLog 'START URL=[REDACTED]' }
                else { Write-ServiceControlLog "START $_" }
            }
        Write-ServiceControlLog 'STATUS=RESTARTED'
    }
    else {
        Write-ServiceControlLog 'STATUS=SHUT_DOWN'
    }
}
catch {
    Write-ServiceControlLog "STATUS=FAILED MESSAGE=$($_.Exception.Message)"
    exit 1
}
