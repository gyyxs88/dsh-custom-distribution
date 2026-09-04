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

function Get-ProductionSnapshot {
    $productionRoot = Split-Path -Parent $distributionRoot
    $pidPath = Join-Path $productionRoot '.run\web-ui.pid'
    $statePath = Join-Path $productionRoot '.run\web-ui.json'
    $recordedPid = if (Test-Path -LiteralPath $pidPath) { (Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8).Trim() } else { $null }
    $recordedState = if (Test-Path -LiteralPath $statePath) { Read-JsonFile -Path $statePath } else { $null }
    $productionPort = if ($recordedState -and $recordedState.port) { [int]$recordedState.port } else { 3080 }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $productionPort -ErrorAction SilentlyContinue | Select-Object -First 1
    $listenerProcess = if ($listener) { Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue } else { $null }
    return [ordered]@{
        recordedPid = $recordedPid
        recordedUrl = if ($recordedState) { $recordedState.url } else { $null }
        listenerPid = if ($listener) { [int]$listener.OwningProcess } else { $null }
        listenerCommandLine = if ($listenerProcess) { $listenerProcess.CommandLine } else { $null }
        listenerCreated = if ($listenerProcess) { [string]$listenerProcess.CreationDate } else { $null }
    } | ConvertTo-Json -Compress
}

function Test-ServiceControlRestart {
    param([Parameter(Mandatory)][string]$Root)
    $runStatePath = Join-Path $Root 'data\run\web-ui.json'
    $state = Read-JsonFile -Path $runStatePath
    $oldPid = [int]$state.pid
    $origin = "http://127.0.0.1:$([int]$state.port)"
    $curlExe = Join-Path $env:SystemRoot 'System32\curl.exe'
    $cookieFile = Join-Path $Root 'data\run\.service-control-acceptance-cookie.txt'
    if (Test-Path -LiteralPath $cookieFile) { throw '服务控制验收 Cookie 临时文件已存在。' }
    try {
        $exchange = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
            --output NUL --cookie-jar $cookieFile --write-out '%{http_code}' -- ([string]$state.url)
        if ($LASTEXITCODE -ne 0 -or $exchange -ne '303') { throw "服务控制验收令牌交换失败：$exchange" }
        $before = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
            --output NUL --cookie $cookieFile --write-out '%{http_code}' -- "$origin/"
        if ($LASTEXITCODE -ne 0 -or $before -ne '200') { throw "服务控制验收重启前 Cookie 失败：$before" }
        $restart = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
            --output NUL --cookie $cookieFile --request POST --header "Origin: $origin" `
            --header 'x-dsh-service-control: 1' --write-out '%{http_code}' -- "$origin/api/local-service-control/restart"
        if ($LASTEXITCODE -ne 0 -or $restart -ne '202') { throw "服务控制验收重启请求失败：$restart" }

        $deadline = (Get-Date).AddSeconds(90)
        $newState = $null
        do {
            Start-Sleep -Milliseconds 500
            if (Test-Path -LiteralPath $runStatePath) {
                try {
                    $candidate = Read-JsonFile -Path $runStatePath
                    if ([int]$candidate.pid -ne $oldPid) {
                        $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$candidate.port) -ErrorAction SilentlyContinue |
                            Where-Object { $_.OwningProcess -eq [int]$candidate.pid } | Select-Object -First 1
                        if ($listener) { $newState = $candidate }
                    }
                }
                catch { }
            }
        } while (-not $newState -and (Get-Date) -lt $deadline)
        if (-not $newState) { throw '服务控制验收重启后 90 秒内未恢复。' }

        $after = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
            --output NUL --cookie $cookieFile --write-out '%{http_code}' -- "$origin/"
        if ($LASTEXITCODE -ne 0 -or $after -ne '200') { throw "服务控制验收重启后旧 Cookie 失败：$after" }
        $serviceLog = Join-Path $Root 'data\logs\service-control.log'
        if ((Test-Path -LiteralPath $serviceLog) -and (Select-String -LiteralPath $serviceLog -Pattern 'token=' -Quiet)) {
            throw '服务控制日志泄露了浏览器启动令牌。'
        }
        return [int]$newState.pid
    }
    finally {
        if ([System.IO.File]::Exists($cookieFile)) { [System.IO.File]::Delete($cookieFile) }
    }
}

$productionBefore = Get-ProductionSnapshot

try {
    Expand-Archive -LiteralPath $bundlePath -DestinationPath $expanded -Force
    $installOutput = @(& (Join-Path $expanded 'scripts\Install-Bundle.ps1') -BundleRoot $expanded -InstallRoot $installRoot -Port $Port)
    if ($LASTEXITCODE -ne 0) { throw '隔离安装失败。' }
    foreach ($line in $installOutput) {
        if ([string]$line -match '^URL=') { Write-Output 'URL=[REDACTED]' }
        else { Write-Output $line }
    }
    & (Join-Path $installRoot 'bin\Verify-DSH.ps1') -InstallRoot $installRoot -RequireRunning
    if ($LASTEXITCODE -ne 0) { throw '隔离运行验证失败。' }

    $restartedPid = Test-ServiceControlRestart -Root $installRoot
    & (Join-Path $installRoot 'bin\Verify-DSH.ps1') -InstallRoot $installRoot -RequireRunning
    if ($LASTEXITCODE -ne 0) { throw '隔离服务控制重启后的验证失败。' }
    Write-Output "SERVICE_CONTROL_RESTART=PASSED PID=$restartedPid COOKIE_REUSED=true"

    $current = Read-JsonFile -Path (Join-Path $installRoot 'current.json')
    $node = Join-Path ([string]$current.runtimeRoot) 'node.exe'
    & $node (Join-Path $PSScriptRoot 'Test-ModelDiscovery.mjs') ([string]$current.appRoot)
    if ($LASTEXITCODE -ne 0) { throw '隔离模型能力发现验证失败。' }

    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'data\.credentials.yaml') -PathType Leaf)) {
        throw 'DSH rc1 没有生成预期的本机浏览器认证凭据。'
    }
    if (Test-Path -LiteralPath (Join-Path $installRoot 'data\settings.yaml')) {
        throw '干净安装不应预置用户设置。'
    }
    $agents = Get-Content -LiteralPath (Join-Path $installRoot 'data\AGENTS.md') -Raw -Encoding UTF8
    if ($agents -notmatch '始终使用简体中文回复') { throw 'AGENTS 示例没有正确安装。' }

    if ($current.previousVersion) { throw '首次安装不应伪造 previousVersion。' }
    if ($current.version -ne $version) { throw '隔离安装版本不正确。' }
}
finally {
    $stopScript = Join-Path $installRoot 'bin\Stop-DSH.ps1'
    if (Test-Path -LiteralPath $stopScript -PathType Leaf) {
        try { & $stopScript -InstallRoot $installRoot } catch { }
    }
}

$productionAfter = Get-ProductionSnapshot
if ($productionAfter -ne $productionBefore) { throw '隔离验收意外改变了现役 DSH 的 PID、监听者或进程身份。' }

Write-Output 'ACCEPTANCE_STATUS=PASSED'
Write-Output "INSTALL_ROOT=$installRoot"
Write-Output "VERSION=$version"
Write-Output 'PRODUCTION_STATE_UNCHANGED=true'
