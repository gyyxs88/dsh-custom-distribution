[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [ValidateRange(1, 65535)][int]$Port
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$state = Get-InstallState -InstallRoot $InstallRoot
$selectedPort = if ($PSBoundParameters.ContainsKey('Port')) { $Port } else { [int]$state.port }
$bindAddress = '127.0.0.1'
$nodeExe = Join-Path $state.runtimeRoot 'node.exe'
$entrypoint = Join-Path $state.appRoot 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$dataRoot = $state.dataRoot
$logRoot = Join-Path $dataRoot 'logs'
$runRoot = Join-Path $dataRoot 'run'
$pidFile = Join-Path $runRoot 'web-ui.pid'
$runStateFile = Join-Path $runRoot 'web-ui.json'

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw "Node.js 不存在：$nodeExe" }
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw "DSH 入口不存在：$entrypoint" }
New-Item -ItemType Directory -Force -Path $logRoot, $runRoot | Out-Null

$existing = Test-RecordedDshProcess -InstallRoot $InstallRoot
if ($existing) {
    $existingState = Read-JsonFile -Path $runStateFile
    Write-Output 'STATUS=ALREADY_RUNNING'
    Write-Output "PID=$($existing.ProcessId)"
    Write-Output "URL=$($existingState.url)"
    exit 0
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $runStateFile -Force -ErrorAction SilentlyContinue

function Test-PortListening([int]$Candidate) {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Candidate -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-AuthenticatedWebUrl {
    if (-not (Test-Path -LiteralPath $stdoutLog -PathType Leaf)) { return $null }
    try {
        $stream = [System.IO.FileStream]::new(
            $stdoutLog,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        )
        try {
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true, 1024, $true)
            try { $stdout = $reader.ReadToEnd() }
            finally { $reader.Dispose() }
        }
        finally { $stream.Dispose() }
    }
    catch { return $null }

    $portPattern = [System.Text.RegularExpressions.Regex]::Escape([string]$selectedPort)
    $pattern = "(?m)^dsh web: (?<url>http://127\.0\.0\.1:$portPattern/\?token=[A-Za-z0-9_-]{43})(?:\s+\(LAN:.*\))?\r?$"
    $match = [System.Text.RegularExpressions.Regex]::Match($stdout, $pattern)
    if (-not $match.Success) { return $null }

    try { $candidate = [System.Uri]$match.Groups['url'].Value }
    catch { return $null }
    if ($candidate.Scheme -ne 'http' -or $candidate.Host -ne $bindAddress -or $candidate.Port -ne $selectedPort -or
        $candidate.AbsolutePath -ne '/' -or $candidate.Query -notmatch '^\?token=[A-Za-z0-9_-]{43}$' -or
        $candidate.Fragment -or $candidate.UserInfo) {
        return $null
    }
    return $candidate.AbsoluteUri
}

$fallback = $false
if (Test-PortListening $selectedPort) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $probe.Start()
        $selectedPort = ([System.Net.IPEndPoint]$probe.LocalEndpoint).Port
    }
    finally { $probe.Stop() }
    $fallback = $true
}

$stdoutLog = Join-Path $logRoot 'web-ui.stdout.log'
$stderrLog = Join-Path $logRoot 'web-ui.stderr.log'
$oldDshHome = $env:DSH_HOME
$oldPath = $env:PATH
$hadNodeUseEnvProxy = Test-Path -LiteralPath 'Env:\NODE_USE_ENV_PROXY'
$oldNodeUseEnvProxy = $env:NODE_USE_ENV_PROXY
$hadNoProxy = Test-Path -LiteralPath 'Env:\NO_PROXY'
$oldNoProxy = $env:NO_PROXY
$hadDeepSeekApiKey = Test-Path -LiteralPath 'Env:\DEEPSEEK_API_KEY'
$oldDeepSeekApiKey = $env:DEEPSEEK_API_KEY
$hadModuleFallbackMode = Test-Path -LiteralPath 'Env:\DSH_MODULE_FALLBACK_MODE'
$oldModuleFallbackMode = $env:DSH_MODULE_FALLBACK_MODE
try {
    $env:DSH_HOME = $dataRoot
    $env:PATH = "$($state.runtimeRoot);$oldPath"
    $env:NODE_USE_ENV_PROXY = '1'
    $noProxyEntries = @()
    if (-not [string]::IsNullOrWhiteSpace($env:NO_PROXY)) {
        $noProxyEntries += $env:NO_PROXY -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }
    $noProxyEntries += @('127.0.0.1', 'localhost', '::1')
    $env:NO_PROXY = ($noProxyEntries | Select-Object -Unique) -join ','
    $env:DSH_MODULE_FALLBACK_MODE = 'proxy'
    Remove-Item -LiteralPath 'Env:\DEEPSEEK_API_KEY' -ErrorAction SilentlyContinue
    $argumentString = '"' + $entrypoint + '" web --host ' + $bindAddress + ' --port ' + $selectedPort + ' --no-open'
    $process = Start-Process -FilePath $nodeExe -ArgumentList $argumentString -WorkingDirectory $state.appRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
}
finally {
    $env:DSH_HOME = $oldDshHome
    $env:PATH = $oldPath
    if ($hadNodeUseEnvProxy) { $env:NODE_USE_ENV_PROXY = $oldNodeUseEnvProxy }
    else { Remove-Item -LiteralPath 'Env:\NODE_USE_ENV_PROXY' -ErrorAction SilentlyContinue }
    if ($hadNoProxy) { $env:NO_PROXY = $oldNoProxy }
    else { Remove-Item -LiteralPath 'Env:\NO_PROXY' -ErrorAction SilentlyContinue }
    if ($hadDeepSeekApiKey) { $env:DEEPSEEK_API_KEY = $oldDeepSeekApiKey }
    else { Remove-Item -LiteralPath 'Env:\DEEPSEEK_API_KEY' -ErrorAction SilentlyContinue }
    if ($hadModuleFallbackMode) { $env:DSH_MODULE_FALLBACK_MODE = $oldModuleFallbackMode }
    else { Remove-Item -LiteralPath 'Env:\DSH_MODULE_FALLBACK_MODE' -ErrorAction SilentlyContinue }
}

Set-Content -LiteralPath $pidFile -Encoding UTF8 -Value $process.Id
$deadline = (Get-Date).AddSeconds(60)
$listener = $null
$authenticatedUrl = $null
do {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if ($process.HasExited) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        throw "DSH 启动失败，退出码 $($process.ExitCode)。请查看 $stderrLog"
    }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $selectedPort -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id } | Select-Object -First 1
    if ($listener -and -not $authenticatedUrl) { $authenticatedUrl = Get-AuthenticatedWebUrl }
} while ((-not $listener -or -not $authenticatedUrl) -and (Get-Date) -lt $deadline)

if (-not $listener) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "DSH 在 60 秒内未监听 $bindAddress`:$selectedPort。请查看 $stderrLog"
}
if (-not $authenticatedUrl) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "DSH 在 60 秒内没有发布可验证的浏览器认证入口。请查看 $stderrLog"
}

$origin = "http://$bindAddress`:$selectedPort/"
$runState = [ordered]@{
    pid = $process.Id
    version = $state.version
    entrypoint = $entrypoint
    host = $bindAddress
    port = $selectedPort
    origin = $origin
    url = $authenticatedUrl
    authentication = 'browser-token-exchange'
    startedAt = (Get-Date).ToString('o')
    stdoutLog = $stdoutLog
    stderrLog = $stderrLog
}
Write-JsonAtomic -Value $runState -Path $runStateFile

Write-Output 'STATUS=STARTED'
Write-Output "VERSION=$($state.version)"
Write-Output "PID=$($process.Id)"
Write-Output "URL=$authenticatedUrl"
Write-Output "PORT_FALLBACK=$fallback"
