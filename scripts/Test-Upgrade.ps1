[CmdletBinding()]
param([Parameter(Mandatory)][string]$PreviousBundle, [Parameter(Mandatory)][string]$PreviousSha256)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$distributionRoot = Split-Path -Parent $PSScriptRoot
$release = Read-JsonFile -Path (Join-Path $distributionRoot 'manifest\release-lock.json')
$fixture = Join-Path $distributionRoot ('.install-test\upgrade-' + [guid]::NewGuid().ToString('N'))
$oldBundle = Join-Path $fixture 'previous'
$newBundle = Join-Path $fixture 'new'
$installRoot = Join-Path $fixture 'installed'
New-Item -ItemType Directory -Force -Path $oldBundle, $newBundle | Out-Null
Assert-FileHash -Path $PreviousBundle -Expected $PreviousSha256
$newZip = Join-Path $distributionRoot ('dist\dsh-custom-distribution-v' + $release.distribution.version + '-win-x64.zip')
$newHash = ((Get-Content -LiteralPath ($newZip + '.sha256') -Raw).Trim() -split '\s+')[0]
Assert-FileHash -Path $newZip -Expected $newHash
Expand-Archive -LiteralPath $PreviousBundle -DestinationPath $oldBundle
Expand-Archive -LiteralPath $newZip -DestinationPath $newBundle
$installer = Join-Path $newBundle 'scripts\Install-Bundle.ps1'
# Use the current, recoverable installer for both versioned payloads. No production data is copied.
& $installer -BundleRoot $oldBundle -InstallRoot $installRoot -Port 31882 -NoStart
if ($LASTEXITCODE -ne 0) { throw '旧版安装失败。' }
$old = Get-InstallState -InstallRoot $installRoot
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot 'data\storages') | Out-Null
$marker = Join-Path $installRoot 'data\storages\upgrade-fixture.txt'
Set-Content -LiteralPath $marker -Value 'before-upgrade' -Encoding UTF8
& $installer -BundleRoot $newBundle -InstallRoot $installRoot -Port 31882 -NoStart
if ($LASTEXITCODE -ne 0) { throw '新版安装失败。' }
$upgraded = Get-InstallState -InstallRoot $installRoot
if ($upgraded.version -ne $release.distribution.version -or $upgraded.previousVersion -ne $old.version) { throw '升级版本指针不正确。' }
if ((Get-Content -LiteralPath $marker).Trim() -ne 'before-upgrade') { throw '升级改变了私有数据。' }
Set-Content -LiteralPath $marker -Value 'after-upgrade' -Encoding UTF8
& (Join-Path $installRoot 'bin\Rollback-DSH.ps1') -InstallRoot $installRoot
if ($LASTEXITCODE -ne 0) { throw '回滚失败。' }
$restored = Get-InstallState -InstallRoot $installRoot
if ($restored.version -ne $old.version -or (Get-Content -LiteralPath $marker).Trim() -ne 'before-upgrade') { throw '程序和数据未一起回滚。' }
$retained = @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'data\backups') -Directory -Filter 'before-restore-*')
if ($retained.Count -ne 1 -or (Get-Content -LiteralPath (Join-Path $retained[0].FullName 'storages\upgrade-fixture.txt')).Trim() -ne 'after-upgrade') { throw '升级后数据未保留。' }
Write-Output 'UPGRADE_ROLLBACK_ACCEPTANCE=PASSED'
Write-Output "FROM_VERSION=$($old.version)"
Write-Output "TO_VERSION=$($release.distribution.version)"
