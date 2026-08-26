Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-FullPath {
    param([Parameter(Mandatory)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Child
    )
    $parentFull = (Get-FullPath -Path $Parent).TrimEnd('\') + '\'
    $childFull = Get-FullPath -Path $Child
    if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝操作安装目录之外的路径：$childFull"
    }
    return $childFull
}

function Remove-SafeTree {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Path
    )
    $safePath = Assert-ChildPath -Parent $Parent -Child $Path
    if (Test-Path -LiteralPath $safePath) {
        Remove-Item -LiteralPath $safePath -Recurse -Force
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "缺少 JSON 文件：$Path"
    }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$Path
    )
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Path
    )
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory ('.' + [System.IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    Write-Utf8NoBom -Value ($Value | ConvertTo-Json -Depth 20) -Path $temporary
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $algorithm.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Assert-FileHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Expected
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "缺少受信文件：$Path"
    }
    $actual = Get-Sha256 -Path $Path
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 校验失败：$Path`nexpected=$Expected`nactual=$actual"
    }
}

function Get-InstallState {
    param([Parameter(Mandatory)][string]$InstallRoot)
    return Read-JsonFile -Path (Join-Path $InstallRoot 'current.json')
}

function Get-InstallLock {
    param([Parameter(Mandatory)][string]$InstallRoot)
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
    $lockPath = Join-Path $InstallRoot '.install.lock'
    try {
        return [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    }
    catch {
        throw "另一个 DSH 安装、升级或回滚正在进行：$lockPath"
    }
}

function ConvertTo-FileDependencyPath {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FullPath -Path $Path).Replace('\', '/')
}

function ConvertTo-YamlSingleQuoted {
    param([Parameter(Mandatory)][string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-LocalRuntimeOverrides {
    param([Parameter(Mandatory)][string]$RuntimeRoot)
    $overrides = [ordered]@{}

    $codexJs = if ($env:APPDATA) { Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\bin\codex.js' } else { $null }
    if ($codexJs -and (Test-Path -LiteralPath $codexJs -PathType Leaf)) {
        $overrides.codex = [ordered]@{
            nodeExecutable = Join-Path $RuntimeRoot 'node.exe'
            codexJs = $codexJs
        }
    }

    $claude = if ($env:APPDATA) { Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe' } else { $null }
    if ($claude -and (Test-Path -LiteralPath $claude -PathType Leaf)) {
        $overrides.claude = $claude
    }

    $grok = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.grok\bin\grok.exe' } else { $null }
    if ($grok -and (Test-Path -LiteralPath $grok -PathType Leaf)) {
        $overrides.grok = $grok
    }

    $opencode = if ($env:APPDATA) { Join-Path $env:APPDATA 'npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe' } else { $null }
    if ($opencode -and (Test-Path -LiteralPath $opencode -PathType Leaf)) {
        $overrides.opencode = $opencode
    }

    return $overrides
}

function Write-ProfileConfiguration {
    param(
        [Parameter(Mandatory)][string]$DistributionRoot,
        [Parameter(Mandatory)][string]$ProfileRoot,
        [Parameter(Mandatory)][string]$PackagesRoot,
        [Parameter(Mandatory)][string]$RuntimeRoot,
        [Parameter(Mandatory)][string]$DataRoot,
        [Parameter(Mandatory)][string]$AppRoot
    )
    New-Item -ItemType Directory -Force -Path $ProfileRoot | Out-Null
    $packageTemplate = Get-Content -LiteralPath (Join-Path $DistributionRoot 'templates\profile.package.json') -Raw -Encoding UTF8
    $packagePath = ConvertTo-FileDependencyPath -Path $PackagesRoot
    Write-Utf8NoBom -Value ($packageTemplate.Replace('__PACKAGES__', $packagePath)) -Path (Join-Path $ProfileRoot 'package.json')
    Copy-Item -LiteralPath (Join-Path $DistributionRoot 'templates\cordis.yml') -Destination (Join-Path $ProfileRoot 'cordis.yml') -Force
    Copy-Item -LiteralPath (Join-Path $DistributionRoot 'templates\pnpm-workspace.yaml') -Destination (Join-Path $ProfileRoot 'pnpm-workspace.yaml') -Force

    $runtimeOverrides = Get-LocalRuntimeOverrides -RuntimeRoot $RuntimeRoot
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('# Generated by dsh-custom-distribution. Do not put credentials in this file.')

    $lines.Add('- id: coding-agent-tools-auto')
    $lines.Add('  config:')
    $lines.Add('    excludedPresets:')
    $lines.Add('      - minimal')
    $lines.Add('    roles:')
    $lines.Add('      - id: action-advisor')
    $lines.Add('        channel: codex')
    $lines.Add('        model: gpt-5.6-sol')
    $lines.Add('        reasoningEffort: xhigh')
    $lines.Add('        executionPermission: read-only')
    $lines.Add('        backgroundOnly: true')
    $lines.Add('        allowDelegation: false')
    $lines.Add("        instructions: '你是 Codex 行动顾问。只做只读研究、根因分析、方案设计和执行后审阅，不修改文件、不执行有副作用的操作。首次咨询以 PLAN 开头；收到执行报告后只以 APPROVED 或 RETRY 开头给出结论。不得委派其他 Agent；后台完成后直接回报主会话，不要求主会话轮询或等待。'")

    if ($runtimeOverrides.codex) {
        $lines.Add('- id: coding-agent-codex')
        $lines.Add('  config:')
        $lines.Add('    channel: codex')
        $lines.Add('    providerName: coding-agent/codex')
        $lines.Add('    nodeExecutable: ' + (ConvertTo-YamlSingleQuoted $runtimeOverrides.codex.nodeExecutable))
        $lines.Add('    codexJs: ' + (ConvertTo-YamlSingleQuoted $runtimeOverrides.codex.codexJs))
    }
    if ($runtimeOverrides.claude) {
        $lines.Add('- id: coding-agent-claude-code')
        $lines.Add('  config:')
        $lines.Add('    channel: claude-code')
        $lines.Add('    providerName: coding-agent/claude-code')
        $lines.Add('    claudeExecutable: ' + (ConvertTo-YamlSingleQuoted $runtimeOverrides.claude))
    }
    if ($runtimeOverrides.grok) {
        $lines.Add('- id: coding-agent-grok-build')
        $lines.Add('  config:')
        $lines.Add('    channel: grok-build')
        $lines.Add('    providerName: coding-agent/grok-build')
        $lines.Add('    grokExecutable: ' + (ConvertTo-YamlSingleQuoted $runtimeOverrides.grok))
    }
    if ($runtimeOverrides.opencode) {
        $lines.Add('- insert:')
        $lines.Add('    - id: coding-agent-acp-opencode')
        $lines.Add("      name: 'dsh-subagent-code-agents'")
        $lines.Add('      config:')
        $lines.Add('        channel: acp')
        $lines.Add('        id: opencode')
        $lines.Add('        command: ' + (ConvertTo-YamlSingleQuoted $runtimeOverrides.opencode))
        $lines.Add('        args:')
        $lines.Add('          - acp')
    }

    $lines.Add('- id: authorized-session-control')
    $lines.Add('  config:')
    $lines.Add('    controllerSessionIds: []')
    $lines.Add('    authorizeAllOrdinarySessions: true')
    $lines.Add('    stateDir: ' + (ConvertTo-YamlSingleQuoted (Join-Path $DataRoot 'session-control')))
    $lines.Add('    sameWorkspaceOnly: false')
    $lines.Add('    maxPendingPerTarget: 3')
    $lines.Add('    maxPendingPerSource: 10')
    $lines.Add('    rateLimitPerMinute: 5')
    $lines.Add('    maxOperations: 500')
    $lines.Add('    approvalDelegationTimeoutMs: 900000')

    $lines.Add('- id: dsh-remote-control')
    $lines.Add('  config:')
    $lines.Add('    controllerSessionIds: []')
    $lines.Add('    authorizeAllOrdinarySessions: true')
    $lines.Add('    stateDir: ' + (ConvertTo-YamlSingleQuoted (Join-Path $DataRoot 'remote-control')))
    $lines.Add('    dshRecipeRoot: ' + (ConvertTo-YamlSingleQuoted $AppRoot))
    $lines.Add('    sessionControlPackageRoot: ' + (ConvertTo-YamlSingleQuoted (Join-Path $ProfileRoot 'node_modules\dsh-session-control')))

    Write-Utf8NoBom -Value ($lines -join "`r`n") -Path (Join-Path $ProfileRoot 'cordis.patch.yml')
}

function Test-RecordedDshProcess {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [switch]$ReturnProcess
    )
    $pidFile = Join-Path $InstallRoot 'data\run\web-ui.pid'
    $stateFile = Join-Path $InstallRoot 'data\run\web-ui.json'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf) -or -not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
        return $null
    }
    $savedPid = 0
    $text = (Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8).Trim()
    if (-not [int]::TryParse($text, [ref]$savedPid)) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $runState = Read-JsonFile -Path $stateFile
    if (-not $runState.entrypoint -or $process.CommandLine -notlike "*$($runState.entrypoint)*") { return $null }
    return $process
}

function Set-ActiveVersion {
    param(
        [Parameter(Mandatory)][string]$InstallRoot,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][int]$Port,
        [string]$PreviousVersion
    )
    $versionRoot = Join-Path $InstallRoot (Join-Path 'versions' $Version)
    $receiptPath = Join-Path $versionRoot 'install-receipt.json'
    $receipt = Read-JsonFile -Path $receiptPath
    if ($receipt.version -ne $Version -or $receipt.status -ne 'installed') {
        throw "目标版本没有有效安装回执：$Version"
    }
    $sourceProfile = Join-Path $versionRoot 'profile\web'
    if (-not (Test-Path -LiteralPath (Join-Path $sourceProfile 'node_modules\dsh-session-control\package.json') -PathType Leaf)) {
        throw "目标版本的 profile 不完整：$sourceProfile"
    }
    if (Test-RecordedDshProcess -InstallRoot $InstallRoot) {
        throw 'DSH 仍在运行。请先停止后再切换版本。'
    }

    $profilesRoot = Join-Path $InstallRoot 'data\profiles'
    $activeProfile = Join-Path $profilesRoot 'web'
    $stagingProfile = Join-Path $profilesRoot ('.web-staging-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $profilesRoot | Out-Null
    Copy-Item -LiteralPath $sourceProfile -Destination $stagingProfile -Recurse -Force

    if (Test-Path -LiteralPath $activeProfile) {
        $backupRoot = Join-Path $InstallRoot 'data\backups\profiles'
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        $backupName = 'web-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
        Move-Item -LiteralPath $activeProfile -Destination (Join-Path $backupRoot $backupName)
    }
    Move-Item -LiteralPath $stagingProfile -Destination $activeProfile

    $state = [ordered]@{
        schemaVersion = 1
        version = $Version
        previousVersion = $PreviousVersion
        versionRoot = $versionRoot
        appRoot = Join-Path $versionRoot 'app'
        runtimeRoot = Join-Path $InstallRoot (Join-Path 'shared\runtime' $receipt.nodeDirectory)
        dataRoot = Join-Path $InstallRoot 'data'
        port = $Port
        activatedAt = (Get-Date).ToString('o')
    }
    Write-JsonAtomic -Value $state -Path (Join-Path $InstallRoot 'current.json')
    return $state
}
