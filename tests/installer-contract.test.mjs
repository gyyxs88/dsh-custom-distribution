import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const common = readFileSync(join(root, "scripts", "Common.ps1"), "utf8");
const installer = readFileSync(join(root, "scripts", "Install-Bundle.ps1"), "utf8");
const start = readFileSync(join(root, "scripts", "Start-DSH.ps1"), "utf8");
const stop = readFileSync(join(root, "scripts", "Stop-DSH.ps1"), "utf8");

test("installer verifies every payload layer and artifact before activation", () => {
  assert.match(installer, /foreach \(\$entry in @\(\$payload\.files\)\)/u);
  assert.match(installer, /Assert-FileHash -Path \$runtimeArchive/u);
  assert.match(installer, /foreach \(\$artifact in @\(\$release\.artifacts\)\)/u);
  assert.match(installer, /packageJson\.name -ne \$artifact\.package/u);
  assert.match(installer, /Set-ActiveVersion/u);
});

test("program versions and private state have separate durable roots", () => {
  assert.match(common, /Join-Path 'versions' \$Version/u);
  assert.match(common, /Join-Path \$InstallRoot 'data\\profiles'/u);
  assert.match(common, /data\\backups\\profiles/u);
  assert.match(common, /Write-JsonAtomic/u);
  assert.match(common, /controllerSessionIds: \[\]/u);
  assert.match(common, /authorizeAllOrdinarySessions: true/u);
  assert.match(common, /sameWorkspaceOnly: false/u);
  assert.match(common, /id: action-advisor/u);
  assert.match(common, /executionPermission: read-only/u);
  assert.match(common, /backgroundOnly: true/u);
});

test("runtime channels use explicit existing executables and never PATH fallback", () => {
  assert.match(common, /Test-Path -LiteralPath \$codexJs -PathType Leaf/u);
  assert.match(common, /nodeExecutable/u);
  assert.match(common, /codexJs/u);
  assert.doesNotMatch(common, /Get-Command\s+(codex|claude|grok|opencode)/iu);
});

test("start and stop bind to loopback and validate the exact recorded process", () => {
  assert.match(start, /\$bindAddress = '127\.0\.0\.1'/u);
  assert.match(start, /--no-open/u);
  assert.match(stop, /process\.CommandLine -notlike/u);
  assert.match(stop, /拒绝停止 PID/u);
  assert.match(stop, /ParentProcessId -eq \$current\.ProcessId/u);
  assert.match(stop, /Sort-Object Depth -Descending/u);
  assert.match(stop, /DESCENDANTS_STOPPED/u);
});

test("scripts never persist or copy provider secrets", () => {
  const combined = [common, installer, start, stop].join("\n");
  assert.doesNotMatch(combined, /Copy-Item[^\n]*(\.credentials\.yaml|\.codex|\.claude|\.grok)/iu);
  assert.doesNotMatch(combined, /Get-Content[^\n]*(\.credentials\.yaml|auth\.json|oauth|cookie)/iu);
});
