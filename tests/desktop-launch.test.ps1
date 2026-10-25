$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/Start-Desktop.ps1')
function Assert-Value($condition, $label) { if (-not $condition) { throw $label } }
$caller = @{ https_proxy='http://caller.invalid:81'; NO_PROXY='keep.invalid'; unrelated='kept'; ALL_PROXY='' }
$user = @{ HTTPS_PROXY='http://user.invalid:82'; HTTP_PROXY='http://user.invalid:83'; ALL_PROXY='http://user.invalid:84'; SECRET='never-copy' }
$machine = @{ HTTP_PROXY='http://machine.invalid:85'; no_proxy='machine.invalid' }
$merged = Get-DesktopProxyOverlay $caller $user $machine
Assert-Value ($merged.https_proxy -ceq $caller.https_proxy) 'Caller wins, case insensitive'
Assert-Value ($merged.HTTP_PROXY -ceq $user.HTTP_PROXY) 'User wins over machine only for absent key'
Assert-Value ($merged.NO_PROXY -ceq $caller.NO_PROXY) 'NO_PROXY preserved verbatim'
Assert-Value ($merged.ALL_PROXY -ceq '') 'Explicit empty preserved'
Assert-Value ($merged.unrelated -ceq 'kept') 'Caller environment inherited'
Assert-Value (-not $merged.ContainsKey('SECRET')) 'Only proxy persistence allowed'
Assert-Value (-not $caller.ContainsKey('HTTP_PROXY')) 'Caller not mutated'
$machineOnly = Get-DesktopProxyOverlay @{} @{} @{ all_proxy='http://machine.invalid:86' }
Assert-Value ($machineOnly.all_proxy -ceq 'http://machine.invalid:86') 'Machine fallback'
Assert-Value (@($merged.Keys | Where-Object { $_ -ceq 'https_proxy' }).Count -eq 1) 'Caller spelling preserved'
Assert-Value (-not $merged.ContainsKey('NODE_USE_ENV_PROXY')) 'No Node proxy injection'
Write-Output 'DESKTOP_LAUNCH_ENV_TESTS_PASSED checks=10'
