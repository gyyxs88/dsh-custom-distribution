[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [string]$ReleaseZip,
    [string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$current = Get-InstallState -InstallRoot $InstallRoot
$wasRunning = $null -ne (Test-RecordedDshProcess -InstallRoot $InstallRoot)
try {
    if ($wasRunning) { & (Join-Path $PSScriptRoot 'Stop-DSH.ps1') -InstallRoot $InstallRoot }
    $installer = Join-Path $PSScriptRoot 'Install-DSH.ps1'
    if ($ReleaseZip) {
        & $installer -InstallRoot $InstallRoot -Port ([int]$current.port) -BundlePath $ReleaseZip -ExpectedSha256 $ExpectedSha256 -NoStart
    }
    else {
        & $installer -InstallRoot $InstallRoot -Port ([int]$current.port) -NoStart
    }
    if ($LASTEXITCODE -ne 0) { throw '新版本安装器返回失败。' }
    if ($wasRunning) { & (Join-Path $PSScriptRoot 'Start-DSH.ps1') -InstallRoot $InstallRoot -Port ([int]$current.port) }
    & (Join-Path $PSScriptRoot 'Verify-DSH.ps1') -InstallRoot $InstallRoot -RequireRunning:$wasRunning
    if ($LASTEXITCODE -ne 0) { throw '升级后的验证失败。' }
    Write-Output 'UPDATE_STATUS=COMPLETED'
}
catch {
    if ($wasRunning -and -not (Test-RecordedDshProcess -InstallRoot $InstallRoot)) {
        try { & (Join-Path $PSScriptRoot 'Start-DSH.ps1') -InstallRoot $InstallRoot -Port ([int]$current.port) } catch { }
    }
    throw
}
