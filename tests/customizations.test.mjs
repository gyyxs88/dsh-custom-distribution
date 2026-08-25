import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function normalizeText(text) {
  return text.replaceAll("\r\n", "\n");
}

test("network_error package contains the reviewed transport classification", () => {
  const archive = join(root, "packages", "dsh-llm-pi-ai-0.1.1-rc.2-network-error-fix.1.tgz");
  const source = execFileSync("tar.exe", ["-xOf", archive, "package/lib/index.js"], { encoding: "utf8" });
  assert.match(source, /network\(\?:_error\)\?/u);
  assert.match(readFileSync(join(root, "patches", "dsh-llm-pi-ai-network-error.patch"), "utf8"), /network\(\?:_error\)\?/u);
});

test("conversation source labels are present in source snapshot and artifact", () => {
  const source = readFileSync(join(root, "sources", "dsh-client-ui-conversation-message-provenance", "lib", "client.js"), "utf8");
  assert.match(source, /event\.data\.source\.kind !== "user"/u);
  assert.match(source, /"message\.source\.plugin": "由插件 \{source\} 注入"/u);
  assert.match(source, /"message\.source\.schedule": "由定时任务发送"/u);
  assert.match(source, /"message\.source\.relay\.named": "由 \{sender\} 从任务「\{session\}」发送"/u);
});

test("session menu copies the durable session ID", () => {
  const source = readFileSync(join(root, "sources", "dsh-client-ui-workspace-copy-session-id", "lib", "client.js"), "utf8");
  assert.match(source, /id: "copy-session-id"/u);
  assert.match(source, /writeClipboard\)\(node\.id\)/u);
  assert.match(source, /"menu\.copySessionId": "复制会话 ID"/u);
});

test("source snapshots match their bundled artifacts", () => {
  const cases = [
    ["dsh-client-ui-conversation-message-provenance", "dsh-client-ui-conversation-0.1.1-rc.2-message-provenance.2.tgz"],
    ["dsh-client-ui-workspace-copy-session-id", "dsh-client-ui-workspace-0.1.1-rc.2-copy-session-id.1.tgz"],
  ];
  for (const [sourceName, archiveName] of cases) {
    const temp = mkdtempSync(join(tmpdir(), "dsh-distro-source-"));
    try {
      execFileSync("tar.exe", ["-xf", join(root, "packages", archiveName), "-C", temp]);
      const sourcePackage = JSON.parse(readFileSync(join(root, "sources", sourceName, "package.json"), "utf8"));
      const artifactPackage = JSON.parse(readFileSync(join(temp, "package", "package.json"), "utf8"));
      assert.equal(artifactPackage.name, sourcePackage.name);
      assert.equal(artifactPackage.version, sourcePackage.version);
      assert.equal(artifactPackage.dshLocalPatch, sourcePackage.dshLocalPatch);
      assert.equal(
        normalizeText(readFileSync(join(temp, "package", "lib", "client.js"), "utf8")),
        normalizeText(readFileSync(join(root, "sources", sourceName, "lib", "client.js"), "utf8")),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
