[CmdletBinding()]
param([switch]$ReuseCache)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$distributionRoot = Get-FullPath -Path (Split-Path -Parent $PSScriptRoot)
$release = Read-JsonFile -Path (Join-Path $distributionRoot 'manifest\release-lock.json')
$version = [string]$release.distribution.version
$distRoot = Join-Path $distributionRoot 'dist'
$artifactsRoot = Join-Path $distributionRoot '.artifacts'
$cacheRoot = Join-Path $distributionRoot '.cache'
$stageRoot = Join-Path $artifactsRoot ('release-' + $version)
$bundleRoot = Join-Path $stageRoot 'bundle'
$payloadBuildRoot = Join-Path $stageRoot 'build'

foreach ($path in @($distRoot, $stageRoot)) {
    if (Test-Path -LiteralPath $path) { Remove-SafeTree -Parent $distributionRoot -Path $path }
}
New-Item -ItemType Directory -Force -Path $distRoot, $bundleRoot, $payloadBuildRoot, $cacheRoot | Out-Null

foreach ($artifact in @($release.artifacts)) {
    $artifactPath = Join-Path $distributionRoot ('packages\' + $artifact.file)
    Assert-FileHash -Path $artifactPath -Expected ([string]$artifact.sha256)
}

$runtimeCache = Join-Path $cacheRoot ([string]$release.node.archive)
if (-not (Test-Path -LiteralPath $runtimeCache -PathType Leaf) -or (Get-Sha256 $runtimeCache) -ne [string]$release.node.sha256) {
    if (Test-Path -LiteralPath $runtimeCache) { Remove-Item -LiteralPath $runtimeCache -Force }
    Write-Output "DOWNLOAD_NODE=$($release.node.url)"
    Invoke-WebRequest -Uri $release.node.url -OutFile $runtimeCache -UseBasicParsing
}
Assert-FileHash -Path $runtimeCache -Expected ([string]$release.node.sha256)

$runtimeBuild = Join-Path $payloadBuildRoot 'runtime'
Expand-Archive -LiteralPath $runtimeCache -DestinationPath $runtimeBuild -Force
$runtimeDirectoryName = [System.IO.Path]::GetFileNameWithoutExtension([string]$release.node.archive)
$runtimeRoot = Join-Path $runtimeBuild $runtimeDirectoryName
$nodeExe = Join-Path $runtimeRoot 'node.exe'
$npmCli = Join-Path $runtimeRoot 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf) -or -not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw 'Node.js 运行时归档不完整。'
}

$appRoot = Join-Path $payloadBuildRoot 'app'
New-Item -ItemType Directory -Force -Path (Join-Path $appRoot '.packages') | Out-Null
Copy-Item -LiteralPath (Join-Path $distributionRoot 'templates\app\package.json') -Destination (Join-Path $appRoot 'package.json')
Copy-Item -LiteralPath (Join-Path $distributionRoot 'templates\app\package-lock.json') -Destination (Join-Path $appRoot 'package-lock.json')
foreach ($artifact in @($release.artifacts)) {
    Copy-Item -LiteralPath (Join-Path $distributionRoot ('packages\' + $artifact.file)) -Destination (Join-Path $appRoot ('.packages\' + $artifact.file))
}

$oldPath = $env:PATH
$oldNpmCache = $env:npm_config_cache
try {
    $env:PATH = "$runtimeRoot;$oldPath"
    $env:npm_config_cache = Join-Path $cacheRoot 'npm'
    Push-Location $appRoot
    try {
        & $nodeExe $npmCli ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci 失败，退出码 $LASTEXITCODE" }
    }
    finally { Pop-Location }
}
finally {
    $env:PATH = $oldPath
    $env:npm_config_cache = $oldNpmCache
}

$installedDsh = Read-JsonFile -Path (Join-Path $appRoot 'node_modules\@deepseek-ai\dsh\package.json')
if ($installedDsh.version -ne [string]$release.base.version) { throw '构建出的 DSH 版本漂移。' }

$profileHome = Join-Path $payloadBuildRoot 'profile-home'
$profileRoot = Join-Path $profileHome 'profiles\web'
New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
$profileTemplate = Get-Content -LiteralPath (Join-Path $distributionRoot 'templates\profile.package.json') -Raw -Encoding UTF8
$relativePackages = '../../../app/.packages'
Write-Utf8NoBom -Value ($profileTemplate.Replace('__PACKAGES__', $relativePackages)) -Path (Join-Path $profileRoot 'package.json')
Copy-Item -LiteralPath (Join-Path $distributionRoot 'templates\cordis.yml') -Destination (Join-Path $profileRoot 'cordis.yml')
Copy-Item -LiteralPath (Join-Path $distributionRoot 'templates\pnpm-workspace.yaml') -Destination (Join-Path $profileRoot 'pnpm-workspace.yaml')
Write-Utf8NoBom -Value '[]' -Path (Join-Path $profileRoot 'cordis.patch.yml')

$dshEntrypoint = Join-Path $appRoot 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$oldDshHome = $env:DSH_HOME
$oldPath = $env:PATH
try {
    $env:DSH_HOME = $profileHome
    $env:PATH = "$runtimeRoot;$oldPath"
    Push-Location $appRoot
    try {
        & $nodeExe $dshEntrypoint plugin --profile web install --force --ignore-scripts --frozen-lockfile=false
        if ($LASTEXITCODE -ne 0) { throw "DSH profile 安装失败，退出码 $LASTEXITCODE" }
        & $nodeExe $dshEntrypoint --profile web --dump-config | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'DSH profile 组合验证失败。' }
    }
    finally { Pop-Location }
}
finally {
    $env:DSH_HOME = $oldDshHome
    $env:PATH = $oldPath
}

foreach ($packageName in @('dsh-at-file', 'dsh-session-control', 'dsh-remote-control', 'dsh-subagent-code-agents')) {
    if (-not (Test-Path -LiteralPath (Join-Path $profileRoot "node_modules\$packageName\package.json") -PathType Leaf)) {
        throw "构建 profile 缺少插件：$packageName"
    }
}

$payloadOut = Join-Path $bundleRoot 'payload'
$runtimeOut = Join-Path $bundleRoot 'runtime'
New-Item -ItemType Directory -Force -Path $payloadOut, $runtimeOut | Out-Null
$appArchiveName = "dsh-app-v$version.zip"
$profileArchiveName = "dsh-profile-web-v$version.zip"
$appArchive = Join-Path $payloadOut $appArchiveName
$profileArchive = Join-Path $payloadOut $profileArchiveName
& tar.exe -a -cf $appArchive -C $appRoot .
if ($LASTEXITCODE -ne 0) { throw 'DSH app ZIP 创建失败。' }
& tar.exe -a -cf $profileArchive -C $profileRoot .
if ($LASTEXITCODE -ne 0) { throw 'DSH profile ZIP 创建失败。' }
$appArchiveList = & tar.exe -tf $appArchive
$sessionControlArtifact = @($release.artifacts | Where-Object { $_.package -eq 'dsh-session-control' })
if ($sessionControlArtifact.Count -ne 1) { throw 'release lock 必须包含一个 dsh-session-control artifact。' }
$sessionControlArchiveEntry = './.packages/' + [string]$sessionControlArtifact[0].file
if ($LASTEXITCODE -ne 0 -or $appArchiveList -notcontains './node_modules/@deepseek-ai/dsh/package.json' -or $appArchiveList -notcontains $sessionControlArchiveEntry) {
    throw 'DSH app ZIP 缺少关键文件。'
}
$profileArchiveList = & tar.exe -tf $profileArchive
if ($LASTEXITCODE -ne 0 -or $profileArchiveList -notcontains './node_modules/dsh-session-control/package.json' -or $profileArchiveList -notcontains './node_modules/dsh-subagent-code-agents/package.json') {
    throw 'DSH profile ZIP 缺少关键插件。'
}
Copy-Item -LiteralPath $runtimeCache -Destination (Join-Path $runtimeOut $release.node.archive)

$payloadLock = [ordered]@{
    schemaVersion = 1
    distributionVersion = $version
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    files = @(
        [ordered]@{ role = 'app'; path = "payload/$appArchiveName"; sha256 = Get-Sha256 $appArchive },
        [ordered]@{ role = 'profile'; path = "payload/$profileArchiveName"; sha256 = Get-Sha256 $profileArchive },
        [ordered]@{ role = 'runtime'; path = "runtime/$($release.node.archive)"; sha256 = [string]$release.node.sha256 }
    )
}

New-Item -ItemType Directory -Force -Path (Join-Path $bundleRoot 'manifest') | Out-Null
Copy-Item -LiteralPath (Join-Path $distributionRoot 'manifest\release-lock.json') -Destination (Join-Path $bundleRoot 'manifest\release-lock.json')
Write-JsonAtomic -Value $payloadLock -Path (Join-Path $bundleRoot 'manifest\payload-lock.json')
Copy-Item -LiteralPath (Join-Path $distributionRoot 'scripts') -Destination (Join-Path $bundleRoot 'scripts') -Recurse
Copy-Item -LiteralPath (Join-Path $distributionRoot 'templates') -Destination (Join-Path $bundleRoot 'templates') -Recurse
Copy-Item -LiteralPath (Join-Path $distributionRoot 'config') -Destination (Join-Path $bundleRoot 'config') -Recurse
Copy-Item -LiteralPath (Join-Path $distributionRoot 'docs') -Destination (Join-Path $bundleRoot 'docs') -Recurse
foreach ($file in @('README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'Install-DSH.ps1')) {
    Copy-Item -LiteralPath (Join-Path $distributionRoot $file) -Destination (Join-Path $bundleRoot $file)
}

$bundleName = "dsh-custom-distribution-v$version-win-x64.zip"
$bundlePath = Join-Path $distRoot $bundleName
& tar.exe -a -cf $bundlePath -C $bundleRoot .
if ($LASTEXITCODE -ne 0) { throw '发行 ZIP 创建失败。' }
$bundleHash = Get-Sha256 -Path $bundlePath
Set-Content -LiteralPath ($bundlePath + '.sha256') -Encoding ASCII -Value "$bundleHash  $bundleName"
Copy-Item -LiteralPath (Join-Path $distributionRoot 'Install-DSH.ps1') -Destination (Join-Path $distRoot 'Install-DSH.ps1')

Write-Output 'BUILD_STATUS=COMPLETED'
Write-Output "BUNDLE=$bundlePath"
Write-Output "SHA256=$bundleHash"
Write-Output "SIZE_BYTES=$((Get-Item -LiteralPath $bundlePath).Length)"
