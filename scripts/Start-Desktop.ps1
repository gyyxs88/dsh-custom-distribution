[CmdletBinding()]
param([string]$Executable = 'D:/DSH/DeepSeek Harness.exe')
$ErrorActionPreference = 'Stop'

function Get-DesktopProxyOverlay {
    param([System.Collections.IDictionary]$Caller, [System.Collections.IDictionary]$User, [System.Collections.IDictionary]$Machine)
    $result = @{}
    # Windows environment names are case insensitive. Keep caller spelling and values,
    # including empty values (an intentional opt-out); consult persistence only if absent.
    foreach ($key in $Caller.Keys) { $result[[string]$key] = $Caller[$key] }
    foreach ($source in @($User, $Machine)) {
        foreach ($key in $source.Keys) {
            if ([string]$key -match '^(?i:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$' -and -not $result.ContainsKey([string]$key)) {
                $result[[string]$key] = $source[$key]
            }
        }
    }
    return $result
}

function Get-PersistentDesktopProxy {
    param([string]$Scope)
    $result = @{}
    $location = if ($Scope -eq 'User') { 'HKCU:\Environment' } else { 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' }
    $key = Get-Item -LiteralPath $location -ErrorAction SilentlyContinue
    if ($key) {
        try {
            foreach ($name in $key.GetValueNames()) {
                if ($name -match '^(?i:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$') { $result[$name] = $key.GetValue($name) }
            }
        } finally { $key.Close() }
    }
    return $result
}

function Start-ManagedDesktop {
    param([string]$DesktopExecutable)
    $exe = (Resolve-Path -LiteralPath $DesktopExecutable).ProviderPath
    if ([IO.Path]::GetFileName($exe) -ne 'DeepSeek Harness.exe') { throw 'Expected official Desktop executable' }
    if ($env:DSH_HOME) { throw 'DSH_HOME isolation is set; launch Desktop from an ordinary user shell' }
    $identity = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($exe.ToLowerInvariant())).Replace('/','_')
    $mutex = New-Object Threading.Mutex($false, ('Local\DSH-Desktop-Launch-' + $identity))
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Another Desktop launch is in progress' }
        $existing = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object {
            $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '(?:--type=|--expose-internals|app\.asar.*dsh-desktop-host)'
        })
        if ($existing.Count -gt 0) { return [pscustomobject]@{ status='ALREADY_RUNNING'; mainPid=$existing[0].ProcessId; executable=$exe } }
        $caller = [Environment]::GetEnvironmentVariables('Process')
        $childEnv = Get-DesktopProxyOverlay $caller (Get-PersistentDesktopProxy User) (Get-PersistentDesktopProxy Machine)
        # Never carry Electron/Node test execution switches into the visible application.
        $removed = @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS')
        $logRoot = Join-Path $env:LOCALAPPDATA 'DSH-Desktop-Launcher'
        New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
        $helper = Join-Path $PSScriptRoot '../desktop/launch-desktop.cjs'
        try {
            foreach ($name in $childEnv.Keys) { [Environment]::SetEnvironmentVariable([string]$name,[string]$childEnv[$name],'Process') }
            foreach ($name in $removed) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
            # Installed Electron supplies its own Node runtime for this short helper.
            # The helper passes only the stable OS baseline plus selected proxy names
            # to the GUI, excluding provider/auth/test overrides without reading them.
            [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE','1','Process')
            $info = New-Object Diagnostics.ProcessStartInfo
            $info.FileName = $exe
            $info.Arguments = '"' + $helper + '"'
            $info.UseShellExecute = $false
            $info.CreateNoWindow = $true
            $info.RedirectStandardOutput = $true
            $info.RedirectStandardError = $true
            $helperProcess = [Diagnostics.Process]::Start($info)
            $recordTask = $helperProcess.StandardOutput.ReadToEndAsync()
            $errorTask = $helperProcess.StandardError.ReadToEndAsync()
            if (-not $helperProcess.WaitForExit(20000)) { throw 'Desktop launch helper timed out; check existing Desktop before retrying' }
            if ($helperProcess.ExitCode -ne 0) { throw 'Desktop launch helper failed' }
            $started = $recordTask.Result | ConvertFrom-Json
            $child = Get-Process -Id $started.mainPid
        } finally {
            foreach ($name in $childEnv.Keys) { [Environment]::SetEnvironmentVariable([string]$name,$caller[$name],'Process') }
            foreach ($name in $removed) { [Environment]::SetEnvironmentVariable($name,$caller[$name],'Process') }
        }
        # Hold the launch lock until the main process has initialized its singleton.
        $ready = $child.WaitForInputIdle(15000)
        return [pscustomobject]@{ status='STARTED'; mainPid=$child.Id; executable=$exe; windowReady=$ready; logs=$logRoot }
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') { Start-ManagedDesktop $Executable | ConvertTo-Json -Compress }
