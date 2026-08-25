[CmdletBinding()]
param([ValidateRange(1, 65535)][int]$Port = 31880)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$distributionRoot = Get-FullPath -Path (Split-Path -Parent $PSScriptRoot)
$release = Read-JsonFile -Path (Join-Path $distributionRoot 'manifest\release-lock.json')
$version = [string]$release.distribution.version
$bundleName = "dsh-custom-distribution-v$version-win-x64.zip"
$bundlePath = Join-Path $distributionRoot ('dist\' + $bundleName)
$sidecar = $bundlePath + '.sha256'
if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) { throw '请先运行 npm run build。' }
$expected = ((Get-Content -LiteralPath $sidecar -Raw -Encoding UTF8).Trim() -split '\s+')[0]
Assert-FileHash -Path $bundlePath -Expected $expected

$testParent = Join-Path $distributionRoot '.install-test'
$installRoot = Join-Path $testParent 'DSH-Custom'
$expanded = Join-Path $testParent 'bundle'
if (Test-Path -LiteralPath $testParent) { Remove-SafeTree -Parent $distributionRoot -Path $testParent }
New-Item -ItemType Directory -Force -Path $testParent | Out-Null

$productionPidPath = Join-Path (Split-Path -Parent $distributionRoot) '.run\web-ui.pid'
$productionPidBefore = if (Test-Path -LiteralPath $productionPidPath) { (Get-Content -LiteralPath $productionPidPath -Raw -Encoding UTF8).Trim() } else { $null }

try {
    Expand-Archive -LiteralPath $bundlePath -DestinationPath $expanded -Force
    & (Join-Path $expanded 'scripts\Install-Bundle.ps1') -BundleRoot $expanded -InstallRoot $installRoot -Port $Port
    if ($LASTEXITCODE -ne 0) { throw '隔离安装失败。' }
    & (Join-Path $installRoot 'bin\Verify-DSH.ps1') -InstallRoot $installRoot -RequireRunning
    if ($LASTEXITCODE -ne 0) { throw '隔离运行验证失败。' }

    foreach ($privateFile in @('data\.credentials.yaml', 'data\settings.yaml')) {
        if (Test-Path -LiteralPath (Join-Path $installRoot $privateFile)) { throw "干净安装不应生成私有文件：$privateFile" }
    }
    $agents = Get-Content -LiteralPath (Join-Path $installRoot 'data\AGENTS.md') -Raw -Encoding UTF8
    if ($agents -notmatch '始终使用简体中文回复') { throw 'AGENTS 示例没有正确安装。' }

    $current = Read-JsonFile -Path (Join-Path $installRoot 'current.json')
    if ($current.previousVersion) { throw '首次安装不应伪造 previousVersion。' }
    if ($current.version -ne $version) { throw '隔离安装版本不正确。' }
}
finally {
    $stopScript = Join-Path $installRoot 'bin\Stop-DSH.ps1'
    if (Test-Path -LiteralPath $stopScript -PathType Leaf) {
        try { & $stopScript -InstallRoot $installRoot } catch { }
    }
}

$productionPidAfter = if (Test-Path -LiteralPath $productionPidPath) { (Get-Content -LiteralPath $productionPidPath -Raw -Encoding UTF8).Trim() } else { $null }
if ($productionPidAfter -ne $productionPidBefore) { throw '隔离验收意外改变了现役 DSH 的 PID 记录。' }

Write-Output 'ACCEPTANCE_STATUS=PASSED'
Write-Output "INSTALL_ROOT=$installRoot"
Write-Output "VERSION=$version"
Write-Output 'PRODUCTION_STATE_UNCHANGED=true'
