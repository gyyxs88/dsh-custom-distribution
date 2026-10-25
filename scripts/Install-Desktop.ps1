#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Verify', 'Rollback')][string]$Action = 'Install',
    [string]$BundlePath,
    [string]$DesktopPath,
    [string]$DshHome = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'),
    [string]$BackupId
)
$ErrorActionPreference = 'Stop'
$releaseTag = 'desktop-v0.2.1-rc.3.1'
$assetName = 'dsh-desktop-v0.2.1-rc.3.1-win-x64.zip'
$releaseBase = "https://github.com/gyyxs88/dsh-custom-distribution/releases/download/$releaseTag"
# The bundle builder substitutes the digest in the separately downloadable bootstrap.
$bundleSha256 = '__DESKTOP_BUNDLE_SHA256__'

function Protect-DesktopDirectory([string]$Path) {
    [void](New-Item -ItemType Directory -Path $Path -Force)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    foreach ($identity in @($sid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-DesktopSignature([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch 'O="?Hangzhou DeepSeek Artificial Intelligence Co\.,? Ltd\.') {
        throw 'Official DeepSeek signature validation failed. No installer/program will be run.'
    }
}
function Assert-DesktopStopped([string]$Program) {
    $defaultHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'")
    foreach ($process in $processes) {
        if ($DshHome -eq $defaultHome -or $process.ExecutablePath -eq $Program) {
            throw 'Please quit DeepSeek Harness normally (including the tray icon), finish any work, then run this installer again. No processes were stopped.'
        }
    }
}
function Get-DesktopCandidates {
    if ($DesktopPath) {
        if ([IO.Path]::GetExtension($DesktopPath) -eq '.exe') { $DesktopPath }
        else { Join-Path $DesktopPath 'DeepSeek Harness.exe' }
    }
    $keys = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)
    foreach ($key in $keys) {
        if ($key.DisplayName -like '*DeepSeek Harness*' -and $key.InstallLocation) {
            Join-Path $key.InstallLocation 'DeepSeek Harness.exe'
        }
    }
    Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
    Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\DeepSeek Harness.exe'
}
function Find-Desktop([object]$Official) {
    foreach ($program in @(Get-DesktopCandidates | Select-Object -Unique)) {
        $asar = Join-Path (Split-Path $program -Parent) 'resources\app.asar'
        if ((Test-Path -LiteralPath $program -PathType Leaf) -and (Test-Path -LiteralPath $asar -PathType Leaf)) {
            if ((Get-FileHash -LiteralPath $program -Algorithm SHA256).Hash -eq $Official.exeSha256 -and
                (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -eq $Official.appAsarSha256) {
                Assert-DesktopSignature $program
                return $program
            }
        }
    }
    return $null
}
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    $DshHome = [IO.Path]::GetFullPath($DshHome)
    if ([IO.Path]::GetPathRoot($DshHome) -eq $DshHome) { throw 'Choose a home directory below the drive root.' }
    # Check before downloads or starting the official installer. Also catches an older rc.2.
    $requested = $null
    if ($DesktopPath) {
        $requested = $DesktopPath
        if ([IO.Path]::GetExtension($requested) -ne '.exe') { $requested = Join-Path $requested 'DeepSeek Harness.exe' }
    }
    Assert-DesktopStopped $requested
    if (-not $BundlePath) {
        $beside = Split-Path $PSScriptRoot -Parent
        if (Test-Path -LiteralPath (Join-Path $beside 'manifest.json')) { $BundlePath = $beside }
        else {
            if ($bundleSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Use the built Release bootstrap, or pass -BundlePath with an extracted Desktop bundle.' }
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $cache = Join-Path $env:LOCALAPPDATA ('DSH-Desktop-Install\' + [guid]::NewGuid().ToString('N'))
            Protect-DesktopDirectory $cache
            $zip = Join-Path $cache $assetName
            Write-Host 'Downloading the fixed Desktop plugin bundle...'
            Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$assetName" -OutFile $zip
            if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $bundleSha256) { throw 'Desktop bundle checksum mismatch.' }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [IO.Compression.ZipFile]::OpenRead($zip)
            try {
                foreach ($entry in $archive.Entries) {
                    $target = [IO.Path]::GetFullPath((Join-Path $cache ('bundle\' + $entry.FullName)))
                    $prefix = (Join-Path $cache 'bundle') + [IO.Path]::DirectorySeparatorChar
                    if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe Desktop ZIP entry.' }
                }
            } finally { $archive.Dispose() }
            $BundlePath = Join-Path $cache 'bundle'
            [IO.Compression.ZipFile]::ExtractToDirectory($zip, $BundlePath)
        }
    }
    $BundlePath = (Resolve-Path -LiteralPath $BundlePath).Path
    $manifest = Get-Content -LiteralPath (Join-Path $BundlePath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.releaseTag -ne $releaseTag -or $manifest.runtimeVersion -ne '0.2.1-rc.3') { throw 'Unexpected Desktop release manifest.' }
    $official = $manifest.official.windowsX64
    $program = Find-Desktop $official
    if (-not $program) {
        if ($Action -ne 'Install') { throw 'Install official Desktop 0.2.1-rc.3 first, or specify -DesktopPath.' }
        $cache = Join-Path $env:LOCALAPPDATA ('DSH-Desktop-Install\' + [guid]::NewGuid().ToString('N'))
        Protect-DesktopDirectory $cache
        $installer = Join-Path $cache 'deepseek-harness-0.2.1-rc.3-win-x64.exe'
        if ($official.url -ne 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.3-win-x64.exe') { throw 'Unexpected official download URL.' }
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'Installing official Desktop rc.3 for the current user. Finish the wizard and leave its launch checkbox unchecked.'
        Invoke-WebRequest -UseBasicParsing -Uri $official.url -OutFile $installer
        if ((Get-Item -LiteralPath $installer).Length -ne $official.size) { throw 'Official installer size mismatch.' }
        $sha512 = [Security.Cryptography.SHA512]::Create()
        $stream = [IO.File]::OpenRead($installer)
        try { $digest = [Convert]::ToBase64String($sha512.ComputeHash($stream)) }
        finally { $stream.Dispose(); $sha512.Dispose() }
        if ($digest -ne $official.sha512Base64) { throw 'Official installer SHA512 mismatch.' }
        Assert-DesktopSignature $installer
        # Use the signed current-user NSIS wizard, without guessed switches or elevation.
        $setup = Start-Process -FilePath $installer -PassThru -Wait
        if ($setup.ExitCode -ne 0) { throw 'Official installer did not finish successfully. Re-run after completing official installation.' }
        $program = Find-Desktop $official
        if (-not $program) { throw 'Official rc.3 was not found. Re-run with -DesktopPath pointing to the directory selected in the wizard.' }
    }
    Assert-DesktopStopped $program
    $saved = @{}
    foreach ($name in @('ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'DSH_HOME')) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        $env:DSH_HOME = $DshHome
        Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
        Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
        # A pipeline also waits for the GUI-subsystem Electron EXE in Windows PowerShell.
        & $program (Join-Path $BundlePath 'desktop\installer.mjs') $Action.ToLowerInvariant() $BundlePath (Split-Path $program -Parent) $DshHome $BackupId | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Desktop plugin operation failed. Review the error above; existing private backups are retained.' }
    } finally {
        foreach ($name in $saved.Keys) {
            if ($null -eq $saved[$name]) { [Environment]::SetEnvironmentVariable($name, [NullString]::Value, 'Process') }
            else { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
        }
    }
    Write-Host 'Done. You may now open DeepSeek Harness from its official shortcut.'
} catch {
    Write-Error $_
    exit 1
}
