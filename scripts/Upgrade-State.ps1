Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DurableStateItems {
    param([Parameter(Mandatory)][string]$DataRoot)
    if (-not (Test-Path -LiteralPath $DataRoot)) { return @() }
    return @(Get-ChildItem -LiteralPath $DataRoot -Force | Where-Object { $_.Name -notin @('profiles', 'logs', 'run', 'backups') })
}

function New-UpgradeSnapshot {
    param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$FromVersion, [Parameter(Mandatory)][string]$ToVersion)
    if (Test-RecordedDshProcess -InstallRoot $InstallRoot) { throw '创建升级快照前必须停止 DSH。' }
    $dataRoot = Join-Path $InstallRoot 'data'
    $snapshotRoot = Assert-ChildPath -Parent $InstallRoot -Child (Join-Path $dataRoot ('backups\upgrades\' + [guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Path $snapshotRoot -Force | Out-Null
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $snapshotRoot /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法限制升级快照的访问权限。' }
    $stateRoot = Join-Path $snapshotRoot 'state'
    New-Item -ItemType Directory -Path $stateRoot | Out-Null
    $items = @(Get-DurableStateItems -DataRoot $dataRoot)
    foreach ($item in $items) {
        $source = Assert-ChildPath -Parent $dataRoot -Child $item.FullName
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or @(
            Get-ChildItem -LiteralPath $source -Recurse -Force -ErrorAction Stop | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
        ).Count -gt 0) { throw '升级快照不接受外部链接；原数据保留。' }
        Copy-Item -LiteralPath $source -Destination (Join-Path $stateRoot $item.Name) -Recurse -Force
    }
    Write-JsonAtomic -Path (Join-Path $snapshotRoot 'snapshot-receipt.json') -Value ([ordered]@{
        schemaVersion = 1; status = 'complete'; fromVersion = $FromVersion; toVersion = $ToVersion
        createdAt = (Get-Date).ToUniversalTime().ToString('o'); items = @($items | ForEach-Object { $_.Name })
    })
    return $snapshotRoot
}

function Get-RollbackSnapshot {
    param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$FromVersion, [Parameter(Mandatory)][string]$ToVersion)
    $root = Join-Path $InstallRoot 'data\backups\upgrades'
    if (Test-Path -LiteralPath $root) {
        foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory | Sort-Object LastWriteTimeUtc -Descending)) {
            $path = Join-Path $directory.FullName 'snapshot-receipt.json'
            if (-not (Test-Path -LiteralPath $path)) { continue }
            $receipt = Read-JsonFile -Path $path
            if ($receipt.status -eq 'complete' -and $receipt.fromVersion -eq $ToVersion -and $receipt.toVersion -eq $FromVersion) { return $directory.FullName }
        }
    }
    throw '没有与这次版本切换匹配的完整数据快照；拒绝让旧版程序读取新版会话数据。'
}

function Restore-UpgradeSnapshot {
    param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$SnapshotRoot)
    if (Test-RecordedDshProcess -InstallRoot $InstallRoot) { throw '恢复数据前必须停止 DSH。' }
    $dataRoot = Join-Path $InstallRoot 'data'
    $SnapshotRoot = Assert-ChildPath -Parent (Join-Path $dataRoot 'backups\upgrades') -Child $SnapshotRoot
    $receipt = Read-JsonFile -Path (Join-Path $SnapshotRoot 'snapshot-receipt.json')
    if ($receipt.status -ne 'complete') { throw '数据快照不完整。' }
    foreach ($name in @($receipt.items)) {
        if ([IO.Path]::GetFileName($name) -ne $name -or $name -in @('.', '..', 'profiles', 'logs', 'run', 'backups')) { throw '快照包含非法路径。' }
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $SnapshotRoot 'state') $name))) { throw "快照内容缺失：$name" }
    }
    $retained = Assert-ChildPath -Parent $InstallRoot -Child (Join-Path $dataRoot ('backups\before-restore-' + [guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Path $retained | Out-Null
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $retained /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法保护回滚前的数据。' }
    foreach ($item in @(Get-DurableStateItems -DataRoot $dataRoot)) {
        $source = Assert-ChildPath -Parent $dataRoot -Child $item.FullName
        $target = Assert-ChildPath -Parent $retained -Child (Join-Path $retained $item.Name)
        Move-Item -LiteralPath $source -Destination $target
    }
    foreach ($name in @($receipt.items)) {
        Copy-Item -LiteralPath (Join-Path (Join-Path $SnapshotRoot 'state') $name) -Destination (Join-Path $dataRoot $name) -Recurse -Force
    }
    Write-Output 'DATA_RESTORE=COMPLETED'
}
