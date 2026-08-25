[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [string]$Version
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$lock = Get-InstallLock -InstallRoot $InstallRoot
try {
    $current = Get-InstallState -InstallRoot $InstallRoot
    $target = if ($PSBoundParameters.ContainsKey('Version')) { $Version } else { [string]$current.previousVersion }
    if (-not $target) { throw '没有可回滚的上一个版本。' }
    if ($target -eq $current.version) { throw '目标版本已经是当前版本。' }
    $wasRunning = $null -ne (Test-RecordedDshProcess -InstallRoot $InstallRoot)
    if ($wasRunning) { & (Join-Path $PSScriptRoot 'Stop-DSH.ps1') -InstallRoot $InstallRoot }
    $newState = Set-ActiveVersion -InstallRoot $InstallRoot -Version $target -Port ([int]$current.port) -PreviousVersion ([string]$current.version)
    if ($wasRunning) { & (Join-Path $PSScriptRoot 'Start-DSH.ps1') -InstallRoot $InstallRoot -Port ([int]$current.port) }
    & (Join-Path $PSScriptRoot 'Verify-DSH.ps1') -InstallRoot $InstallRoot -RequireRunning:$wasRunning
    if ($LASTEXITCODE -ne 0) { throw '回滚后的验证失败。' }
    Write-Output 'ROLLBACK_STATUS=COMPLETED'
    Write-Output "VERSION=$($newState.version)"
    Write-Output "PREVIOUS_VERSION=$($newState.previousVersion)"
}
finally { $lock.Dispose() }
