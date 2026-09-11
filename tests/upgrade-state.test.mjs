import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('upgrade snapshot restores old data, preserves newer data, and rejects unmatched rollback', () => {
  const fixture=mkdtempSync(join(tmpdir(),'dsh-upgrade-state-'));
  const scripts=resolve(import.meta.dirname,'../scripts');
  const q=s=>"'"+s.replaceAll("'","''")+"'";
  const command=`
    . ${q(join(scripts,'Common.ps1'))}
    . ${q(join(scripts,'Upgrade-State.ps1'))}
    $root = ${q(fixture)}
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'data\\sessions'), (Join-Path $root 'data\\profiles') | Out-Null
    Set-Content -LiteralPath (Join-Path $root 'data\\sessions\\fixture.jsonl') -Value 'legacy-fixture'
    Set-Content -LiteralPath (Join-Path $root 'data\\profiles\\marker') -Value 'profile-must-stay'
    $snapshot = New-UpgradeSnapshot -InstallRoot $root -FromVersion '0.3.1' -ToVersion '0.4.0'
    if (Test-Path -LiteralPath (Join-Path $snapshot 'profiles')) { throw 'profile copied into durable state snapshot' }
    Set-Content -LiteralPath (Join-Path $root 'data\\sessions\\fixture.jsonl') -Value 'new-format-fixture'
    Set-Content -LiteralPath (Join-Path $root 'data\\added-after-upgrade') -Value 'retained'
    $resolved = Get-RollbackSnapshot -InstallRoot $root -FromVersion '0.4.0' -ToVersion '0.3.1'
    if ($resolved -ne $snapshot) { throw 'snapshot mismatch' }
    Restore-UpgradeSnapshot -InstallRoot $root -SnapshotRoot $resolved
    if ((Get-Content -LiteralPath (Join-Path $root 'data\\sessions\\fixture.jsonl')).Trim() -ne 'legacy-fixture') { throw 'legacy data not restored' }
    if (Test-Path -LiteralPath (Join-Path $root 'data\\added-after-upgrade')) { throw 'new state leaked into old format' }
    $saved = @(Get-ChildItem -LiteralPath (Join-Path $root 'data\\backups') -Directory -Filter 'before-restore-*')
    if ($saved.Count -ne 1 -or -not (Test-Path -LiteralPath (Join-Path $saved[0].FullName 'added-after-upgrade'))) { throw 'new data not retained' }
    $rejected = $false
    try { Get-RollbackSnapshot -InstallRoot $root -FromVersion '0.4.0' -ToVersion 'unknown' } catch { $rejected = $true }
    if (-not $rejected) { throw 'unmatched rollback accepted' }
    Write-Output 'UPGRADE_STATE=PASSED'
  `;
  const output=execFileSync('powershell',['-NoProfile','-Command',command],{encoding:'utf8'});
  assert.match(output,/UPGRADE_STATE=PASSED/);
});
