[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH-Custom'),
    [ValidateRange(1, 65535)][int]$Port = 3080,
    [string]$BundlePath,
    [string]$ExpectedSha256,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$repository = 'gyyxs88/dsh-custom-distribution'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-custom-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null

try {
    if ($BundlePath) {
        $zipPath = [System.IO.Path]::GetFullPath($BundlePath)
        if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "发行包不存在：$zipPath" }
        if (-not $ExpectedSha256) {
            $sidecar = $zipPath + '.sha256'
            if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) { throw '本地发行包必须同时提供 .sha256 文件，或显式传入 -ExpectedSha256。' }
            $ExpectedSha256 = ((Get-Content -LiteralPath $sidecar -Raw -Encoding UTF8).Trim() -split '\s+')[0]
        }
    }
    else {
        $headers = @{ 'User-Agent' = 'dsh-custom-distribution-installer' }
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers $headers
        $zipAsset = @($release.assets | Where-Object { $_.name -match '^dsh-custom-distribution-v.+-win-x64\.zip$' })
        if ($zipAsset.Count -ne 1) { throw '最新 Release 没有精确的 Windows x64 发行包。' }
        $hashAsset = @($release.assets | Where-Object { $_.name -eq ($zipAsset[0].name + '.sha256') })
        if ($hashAsset.Count -ne 1) { throw '最新 Release 缺少对应的 SHA-256 文件。' }
        $zipPath = Join-Path $temporaryRoot $zipAsset[0].name
        $hashPath = $zipPath + '.sha256'
        Invoke-WebRequest -Uri $zipAsset[0].browser_download_url -Headers $headers -OutFile $zipPath -UseBasicParsing
        Invoke-WebRequest -Uri $hashAsset[0].browser_download_url -Headers $headers -OutFile $hashPath -UseBasicParsing
        $ExpectedSha256 = ((Get-Content -LiteralPath $hashPath -Raw -Encoding UTF8).Trim() -split '\s+')[0]
    }

    $stream = [System.IO.File]::OpenRead($zipPath)
    try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try { $actual = ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $algorithm.Dispose() }
    }
    finally { $stream.Dispose() }
    if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "发行包 SHA-256 校验失败。expected=$ExpectedSha256 actual=$actual"
    }

    $expanded = Join-Path $temporaryRoot 'bundle'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded -Force
    $bundleInstaller = Join-Path $expanded 'scripts\Install-Bundle.ps1'
    if (-not (Test-Path -LiteralPath $bundleInstaller -PathType Leaf)) { throw '发行包中缺少内部安装器。' }
    & $bundleInstaller -BundleRoot $expanded -InstallRoot $InstallRoot -Port $Port -NoStart:$NoStart
    if ($LASTEXITCODE -ne 0) { throw '内部安装器返回失败。' }
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
