import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .split(/\r?\n/u)
  .filter(Boolean);

assert.ok(files.includes("manifest/release-lock.json"));
assert.ok(files.includes("scripts/Install-Bundle.ps1"));
assert.ok(files.includes("Install-DSH.ps1"));

const textExtensions = new Set([".md", ".json", ".mjs", ".ps1", ".yml", ".yaml", ".patch"]);
const forbidden = [
  new RegExp(String.raw`D:\\Project\\deepseek-` + "harness-lab", "iu"),
  new RegExp(String.raw`C:\\Users\\Admin` + "istrator", "iu"),
  new RegExp("session-142920bb-6a3c-455b-" + "a4e3-e8567aa0a249", "iu"),
];

for (const file of files) {
  const full = join(root, file);
  if (!existsSync(full)) continue;
  if (!statSync(full).isFile() || !textExtensions.has(extname(file).toLowerCase())) continue;
  const source = readFileSync(full, "utf8");
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `${file} contains a machine-specific or private value`);
  }
}

const scripts = files.filter((file) => file.endsWith(".ps1"));
for (const script of scripts) {
  const bytes = readFileSync(join(root, script));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${script} must carry an UTF-8 BOM for Windows PowerShell 5.1`);
  const command = `[void][scriptblock]::Create((Get-Content -LiteralPath '${join(root, script).replaceAll("'", "''")}' -Raw -Encoding UTF8))`;
  execFileSync("powershell", ["-NoProfile", "-Command", command], { cwd: root, stdio: "pipe" });
}

const release = JSON.parse(readFileSync(join(root, "manifest", "release-lock.json"), "utf8"));
assert.equal(release.distribution.version, JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
assert.equal(release.artifacts.length, 10);
assert.equal(new Set(release.artifacts.map((entry) => entry.file)).size, release.artifacts.length);
assert.ok(release.artifacts.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256)));

console.log(`CHECK_STATUS=PASSED files=${files.length} powershell=${scripts.length}`);
