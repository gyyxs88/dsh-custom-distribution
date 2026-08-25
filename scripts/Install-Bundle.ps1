[CmdletBinding()]
param(
    [string]$BundleRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [ValidateRange(1, 65535)][int]$Port = 3080,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$BundleRoot = Get-FullPath -Path $BundleRoot
$InstallRoot = Get-FullPath -Path $InstallRoot
$releaseLockPath = Join-Path $BundleRoot 'manifest\release-lock.json'
$payloadLockPath = Join-Path $BundleRoot 'manifest\payload-lock.json'
$release = Read-JsonFile -Path $releaseLockPath
$payload = Read-JsonFile -Path $payloadLockPath
$version = [string]$release.distribution.version

if ($payload.distributionVersion -ne $version) { throw 'payload-lock 与 release-lock 的版本不一致。' }
if ($release.distribution.platform -ne 'win32' -or $release.distribution.architecture -ne 'x64') {
    throw '此安装器只接受 Windows x64 发行包。'
}

$installLock = Get-InstallLock -InstallRoot $InstallRoot
try {
    if (Test-RecordedDshProcess -InstallRoot $InstallRoot) {
        throw 'DSH 正在运行。升级请使用 bin\Update-DSH.ps1，它会安全停止并在完成后恢复运行。'
    }

    foreach ($entry in @($payload.files)) {
        $candidate = Join-Path $BundleRoot ([string]$entry.path)
        Assert-ChildPath -Parent $BundleRoot -Child $candidate | Out-Null
        Assert-FileHash -Path $candidate -Expected ([string]$entry.sha256)
    }

    $runtimeArchive = Join-Path $BundleRoot ('runtime\' + $release.node.archive)
    Assert-FileHash -Path $runtimeArchive -Expected ([string]$release.node.sha256)
    $runtimeDirectoryName = [System.IO.Path]::GetFileNameWithoutExtension([string]$release.node.archive)
    $runtimeParent = Join-Path $InstallRoot 'shared\runtime'
    $runtimeRoot = Join-Path $runtimeParent $runtimeDirectoryName
    New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null

    if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'node.exe') -PathType Leaf)) {
        $runtimeStage = Join-Path $runtimeParent ('.runtime-stage-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $runtimeStage | Out-Null
        try {
            Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $runtimeStage -Force
            $expandedRoot = Join-Path $runtimeStage $runtimeDirectoryName
            if (-not (Test-Path -LiteralPath (Join-Path $expandedRoot 'node.exe') -PathType Leaf)) {
                throw 'Node.js 归档结构与版本清单不一致。'
            }
            Move-Item -LiteralPath $expandedRoot -Destination $runtimeRoot
        }
        finally { Remove-SafeTree -Parent $runtimeParent -Path $runtimeStage }
    }
    $nodeVersion = (& (Join-Path $runtimeRoot 'node.exe') --version).TrimStart('v').Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne [string]$release.node.version) {
        throw "Node.js 版本不匹配：expected=$($release.node.version) actual=$nodeVersion"
    }

    $versionParent = Join-Path $InstallRoot 'versions'
    $versionRoot = Join-Path $versionParent $version
    New-Item -ItemType Directory -Force -Path $versionParent | Out-Null
    $reuse = $false
    if (Test-Path -LiteralPath $versionRoot) {
        $receiptPath = Join-Path $versionRoot 'install-receipt.json'
        if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
            throw "发现没有完成回执的版本目录，请人工检查后重试：$versionRoot"
        }
        $existingReceipt = Read-JsonFile -Path $receiptPath
        if ($existingReceipt.version -ne $version -or $existingReceipt.status -ne 'installed') {
            throw "已有版本目录的身份不一致：$versionRoot"
        }
        $reuse = $true
    }

    if (-not $reuse) {
        $versionStage = Join-Path $versionParent ('.version-stage-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path (Join-Path $versionStage 'app'), (Join-Path $versionStage 'profile\web') | Out-Null
        try {
            $appArchiveEntry = @($payload.files | Where-Object { $_.role -eq 'app' })
            $profileArchiveEntry = @($payload.files | Where-Object { $_.role -eq 'profile' })
            if ($appArchiveEntry.Count -ne 1 -or $profileArchiveEntry.Count -ne 1) { throw 'payload-lock 必须精确声明一个 app 和一个 profile 归档。' }
            Expand-Archive -LiteralPath (Join-Path $BundleRoot $appArchiveEntry[0].path) -DestinationPath (Join-Path $versionStage 'app') -Force
            Expand-Archive -LiteralPath (Join-Path $BundleRoot $profileArchiveEntry[0].path) -DestinationPath (Join-Path $versionStage 'profile\web') -Force

            $appPackage = Read-JsonFile -Path (Join-Path $versionStage 'app\node_modules\@deepseek-ai\dsh\package.json')
            if ($appPackage.version -ne [string]$release.base.version) { throw '预装 DSH 版本与 release-lock 不一致。' }

            foreach ($artifact in @($release.artifacts)) {
                $artifactPath = Join-Path $versionStage ('app\.packages\' + $artifact.file)
                Assert-FileHash -Path $artifactPath -Expected ([string]$artifact.sha256)
                $packageJsonText = & tar.exe -xOf $artifactPath 'package/package.json'
                if ($LASTEXITCODE -ne 0) { throw "无法读取包身份：$($artifact.file)" }
                $packageJson = ($packageJsonText -join "`n") | ConvertFrom-Json
                if ($packageJson.name -ne $artifact.package -or $packageJson.version -ne $artifact.version -or $packageJson.license -ne $artifact.license) {
                    throw "包身份与版本锁不一致：$($artifact.file)"
                }
            }

            $requiredProfilePackages = @('dsh-at-file', 'dsh-session-control', 'dsh-remote-control', 'dsh-subagent-code-agents')
            foreach ($packageName in $requiredProfilePackages) {
                if (-not (Test-Path -LiteralPath (Join-Path $versionStage "profile\web\node_modules\$packageName\package.json") -PathType Leaf)) {
                    throw "预装 profile 缺少插件：$packageName"
                }
            }

            Move-Item -LiteralPath $versionStage -Destination $versionRoot
            $profileRoot = Join-Path $versionRoot 'profile\web'
            $appRoot = Join-Path $versionRoot 'app'
            Write-ProfileConfiguration -DistributionRoot $BundleRoot -ProfileRoot $profileRoot -PackagesRoot (Join-Path $appRoot '.packages') -RuntimeRoot $runtimeRoot -DataRoot (Join-Path $InstallRoot 'data') -AppRoot $appRoot

            $receipt = [ordered]@{
                schemaVersion = 1
                version = $version
                status = 'installed'
                dshVersion = [string]$release.base.version
                nodeVersion = [string]$release.node.version
                nodeDirectory = $runtimeDirectoryName
                artifactSha256 = [ordered]@{}
                installedAt = (Get-Date).ToString('o')
            }
            foreach ($artifact in @($release.artifacts)) { $receipt.artifactSha256[$artifact.file] = $artifact.sha256 }
            Write-JsonAtomic -Value $receipt -Path (Join-Path $versionRoot 'install-receipt.json')
        }
        catch {
            if (Test-Path -LiteralPath $versionStage) { Remove-SafeTree -Parent $versionParent -Path $versionStage }
            if ((Test-Path -LiteralPath $versionRoot) -and -not (Test-Path -LiteralPath (Join-Path $versionRoot 'install-receipt.json'))) {
                Remove-SafeTree -Parent $versionParent -Path $versionRoot
            }
            throw
        }
    }
    else {
        Write-ProfileConfiguration -DistributionRoot $BundleRoot -ProfileRoot (Join-Path $versionRoot 'profile\web') -PackagesRoot (Join-Path $versionRoot 'app\.packages') -RuntimeRoot $runtimeRoot -DataRoot (Join-Path $InstallRoot 'data') -AppRoot (Join-Path $versionRoot 'app')
    }

    $previousVersion = $null
    $currentPath = Join-Path $InstallRoot 'current.json'
    if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
        $oldState = Read-JsonFile -Path $currentPath
        if ($oldState.version -ne $version) { $previousVersion = [string]$oldState.version }
        else { $previousVersion = [string]$oldState.previousVersion }
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'data'), (Join-Path $InstallRoot 'bin') | Out-Null
    $active = Set-ActiveVersion -InstallRoot $InstallRoot -Version $version -Port $Port -PreviousVersion $previousVersion

    $binRoot = Join-Path $InstallRoot 'bin'
    foreach ($scriptName in @('Common.ps1', 'Start-DSH.ps1', 'Stop-DSH.ps1', 'Verify-DSH.ps1', 'Rollback-DSH.ps1', 'Update-DSH.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $scriptName) -Destination (Join-Path $binRoot $scriptName) -Force
    }
    Copy-Item -LiteralPath (Join-Path $BundleRoot 'Install-DSH.ps1') -Destination (Join-Path $binRoot 'Install-DSH.ps1') -Force

    $cmdFiles = [ordered]@{
        'Start DSH.cmd' = 'Start-DSH.ps1'
        'Stop DSH.cmd' = 'Stop-DSH.ps1'
        'Verify DSH.cmd' = 'Verify-DSH.ps1'
        'Update DSH.cmd' = 'Update-DSH.ps1'
        'Rollback DSH.cmd' = 'Rollback-DSH.ps1'
    }
    foreach ($entry in $cmdFiles.GetEnumerator()) {
        $content = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0$($entry.Value)`"`r`npause`r`n"
        Set-Content -LiteralPath (Join-Path $binRoot $entry.Key) -Value $content -Encoding ASCII
    }

    $agentsPath = Join-Path $InstallRoot 'data\AGENTS.md'
    if (-not (Test-Path -LiteralPath $agentsPath)) {
        Copy-Item -LiteralPath (Join-Path $BundleRoot 'config\AGENTS.example.md') -Destination $agentsPath
    }

    if (-not $NoStart) {
        & (Join-Path $binRoot 'Start-DSH.ps1') -InstallRoot $InstallRoot -Port $Port
        if ($LASTEXITCODE -ne 0) { throw 'DSH 启动脚本返回失败。' }
        & (Join-Path $binRoot 'Verify-DSH.ps1') -InstallRoot $InstallRoot -RequireRunning
        if ($LASTEXITCODE -ne 0) { throw '安装后验证失败。' }
    }

    Write-Output 'INSTALL_STATUS=COMPLETED'
    Write-Output "VERSION=$version"
    Write-Output "INSTALL_ROOT=$InstallRoot"
    Write-Output "DATA_ROOT=$($active.dataRoot)"
    Write-Output "PRIVATE_STATE_MIGRATED=false"
}
finally { $installLock.Dispose() }
