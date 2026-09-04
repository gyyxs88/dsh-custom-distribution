[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [switch]$RequireRunning
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$state = Get-InstallState -InstallRoot $InstallRoot
$receipt = Read-JsonFile -Path (Join-Path $state.versionRoot 'install-receipt.json')
$failures = [System.Collections.Generic.List[string]]::new()

if ($receipt.status -ne 'installed' -or $receipt.version -ne $state.version) { $failures.Add('当前版本安装回执无效') }
$nodeExe = Join-Path $state.runtimeRoot 'node.exe'
$entrypoint = Join-Path $state.appRoot 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { $failures.Add('Node.js 不存在') }
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { $failures.Add('DSH 入口不存在') }
foreach ($scriptName in @('Service-Control-Launcher.ps1', 'Service-Control-Worker.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "bin\$scriptName") -PathType Leaf)) {
        $failures.Add("服务控制脚本不存在：$scriptName")
    }
}

$plugins = [ordered]@{
    'dsh-at-file' = '0.6.9'
    'dsh-local-service-control' = '0.2.0'
    'dsh-session-control' = '0.8.0'
    'dsh-remote-control' = '0.3.0'
    'dsh-subagent-code-agents' = '0.2.0'
}
foreach ($entry in $plugins.GetEnumerator()) {
    $path = Join-Path $InstallRoot "data\profiles\web\node_modules\$($entry.Key)\package.json"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures.Add("缺少插件 $($entry.Key)"); continue }
    $package = Read-JsonFile -Path $path
    if ($package.version -ne $entry.Value) { $failures.Add("插件版本错误 $($entry.Key): $($package.version)") }
}

$process = Test-RecordedDshProcess -InstallRoot $InstallRoot
if ($RequireRunning -and -not $process) { $failures.Add('DSH 未运行') }
if ($process) {
    $runState = Read-JsonFile -Path (Join-Path $InstallRoot 'data\run\web-ui.json')
    $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$runState.port) -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.ProcessId } | Select-Object -First 1
    if (-not $listener) { $failures.Add('记录的进程没有监听记录的端口') }
    $launchUri = $null
    try { $launchUri = [System.Uri][string]$runState.url }
    catch { $failures.Add('浏览器认证入口不是有效 URL') }
    if ($launchUri -and ($launchUri.Scheme -ne 'http' -or $launchUri.Host -ne '127.0.0.1' -or
        $launchUri.Port -ne [int]$runState.port -or $launchUri.AbsolutePath -ne '/' -or
        $launchUri.Query -notmatch '^\?token=[A-Za-z0-9_-]{43}$' -or $launchUri.Fragment -or $launchUri.UserInfo)) {
        $failures.Add('浏览器认证入口不满足回环地址、端口或令牌约束')
        $launchUri = $null
    }
    if ($launchUri) {
        $curlExe = Join-Path $env:SystemRoot 'System32\curl.exe'
        $cookieFile = Join-Path $InstallRoot ('data\run\.verify-cookie-' + [guid]::NewGuid().ToString('N') + '.txt')
        $htmlFile = Join-Path $InstallRoot ('data\run\.verify-html-' + [guid]::NewGuid().ToString('N') + '.html')
        $clientBundleFile = Join-Path $InstallRoot ('data\run\.verify-client-' + [guid]::NewGuid().ToString('N') + '.js')
        try {
            if (-not (Test-Path -LiteralPath $curlExe -PathType Leaf)) { throw 'Windows curl.exe 不存在' }
            $originUri = [System.Uri]::new($launchUri.GetLeftPart([System.UriPartial]::Authority) + '/')
            $exchangeStatus = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
                --output NUL --cookie-jar $cookieFile --write-out '%{http_code}' -- $launchUri.AbsoluteUri
            if ($LASTEXITCODE -ne 0 -or $exchangeStatus -ne '303') {
                $failures.Add("浏览器令牌交换状态异常：$exchangeStatus")
            }
            elseif (-not (Test-Path -LiteralPath $cookieFile -PathType Leaf) -or (Get-Item -LiteralPath $cookieFile).Length -lt 1) {
                $failures.Add('浏览器令牌交换没有生成认证 Cookie')
            }
            else {
                $responseStatus = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
                    --output $htmlFile --cookie $cookieFile --write-out '%{http_code}' -- $originUri.AbsoluteUri
                if ($LASTEXITCODE -ne 0 -or $responseStatus -ne '200') { $failures.Add("HTTP 状态异常：$responseStatus") }
                else {
                    $html = Get-Content -LiteralPath $htmlFile -Raw -Encoding UTF8
                    $bootMatch = [System.Text.RegularExpressions.Regex]::Match($html, 'globalThis\["__DSH_BOOT__"\] = (?<json>\{.*?\})</script>')
                    if (-not $bootMatch.Success) { $failures.Add('浏览器页面缺少客户端启动图') }
                    else {
                        $boot = $bootMatch.Groups['json'].Value | ConvertFrom-Json
                        $clientIds = @($boot.entries | ForEach-Object { [string]$_.id })
                        foreach ($requiredClientId in @('@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-ui-chat', 'dsh-at-file', 'dsh-local-service-control')) {
                            if ($clientIds -notcontains $requiredClientId) { $failures.Add("浏览器启动图缺少插件：$requiredClientId") }
                        }
                        $atFileEntry = @($boot.entries | Where-Object { $_.id -eq 'dsh-at-file' })
                        if ($atFileEntry.Count -eq 1) {
                            $clientBundleUri = [System.Uri]::new($originUri, [string]$atFileEntry[0].url)
                            $clientBundleStatus = & $curlExe --noproxy '*' --connect-timeout 5 --max-time 15 --silent --show-error `
                                --output $clientBundleFile --cookie $cookieFile --write-out '%{http_code}' -- $clientBundleUri.AbsoluteUri
                            if ($LASTEXITCODE -ne 0 -or $clientBundleStatus -ne '200') { $failures.Add("dsh-at-file 浏览器包状态异常：$clientBundleStatus") }
                            else {
                                $clientBundle = Get-Content -LiteralPath $clientBundleFile -Raw -Encoding UTF8
                                if ($clientBundle -notmatch 'require\("@deepseek-ai/dsh-client-store"\)') { $failures.Add('dsh-at-file 未使用 rc1 浏览器静态存储模块') }
                                if ($clientBundle -match 'require\("@deepseek-ai/dsh-client-runtime/client"\)') { $failures.Add('dsh-at-file 仍引用旧的浏览器运行时入口') }
                            }
                        }
                    }
                }
            }
        }
        catch { $failures.Add("HTTP 验证失败：$($_.Exception.Message)") }
        finally {
            Remove-Item -LiteralPath $cookieFile -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $htmlFile -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $clientBundleFile -Force -ErrorAction SilentlyContinue
        }
    }
    $moduleProxyPath = Join-Path $InstallRoot 'data\profiles\node_modules\@deepseek-ai\dsh-client-ui-chat'
    try {
        $moduleProxyItem = Get-Item -LiteralPath $moduleProxyPath -Force
        if (($moduleProxyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            $failures.Add('Windows profile 模块仍是 Junction，而不是受管 ESM proxy')
        }
        $moduleProxyManifest = Read-JsonFile -Path (Join-Path $moduleProxyPath 'package.json')
        if (-not $moduleProxyManifest.dsh.moduleFallback.targets) {
            $failures.Add('Windows profile 模块缺少受管 ESM proxy 记录')
        }
        if (-not $moduleProxyManifest.dsh.client) {
            $failures.Add('Windows profile 客户端模块 proxy 缺少浏览器元数据')
        }
        $clientExport = [string]$moduleProxyManifest.exports.'./client'
        $clientProxyPath = Join-Path $moduleProxyPath $clientExport.TrimStart('.', '/', '\')
        $clientProxySource = Get-Content -LiteralPath $clientProxyPath -Raw -Encoding UTF8
        if ($clientProxySource -notmatch 'window\.__ModuleLoader__\.load') {
            $failures.Add('Windows profile 客户端模块 proxy 没有镜像浏览器包')
        }
    }
    catch { $failures.Add("Windows profile 模块 proxy 验证失败：$($_.Exception.Message)") }
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }
    Write-Output 'VERIFY_STATUS=FAILED'
    exit 1
}

Write-Output 'VERIFY_STATUS=PASSED'
Write-Output "VERSION=$($state.version)"
Write-Output "RUNNING=$([bool]$process)"
if ($process) {
    $runState = Read-JsonFile -Path (Join-Path $InstallRoot 'data\run\web-ui.json')
    Write-Output "PID=$($process.ProcessId)"
    Write-Output "ORIGIN=$($runState.origin)"
    Write-Output 'MODULE_FALLBACK=proxy'
}
foreach ($entry in $plugins.GetEnumerator()) { Write-Output "PLUGIN_$($entry.Key.ToUpperInvariant().Replace('-', '_'))=$($entry.Value)" }
