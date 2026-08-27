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

test("pi-ai package contains reviewed retry and live discovery policies", () => {
  const archive = join(root, "packages", "dsh-llm-pi-ai-0.1.1-rc.2-network-error-live-discovery-fix.3.tgz");
  const source = execFileSync("tar.exe", ["-xOf", archive, "package/lib/index.js"], { encoding: "utf8" });
  assert.match(source, /network\(\?:_error\)\?/u);
  assert.match(source, /LIVE_CATALOG_DISCOVERY_POLICIES/u);
  assert.match(source, /\["openrouter", "configured-or-catalog"\]/u);
  assert.match(source, /top_provider\?\.max_completion_tokens/u);
  assert.match(source, /architecture\?\.input_modalities/u);
  assert.match(source, /input: \[\.\.\.model\.input\]/u);
});

test("discovered image modalities survive RPC, browser parsing, and settings adoption", () => {
  const host = execFileSync("tar.exe", [
    "-xOf",
    join(root, "packages", "dsh-host-apiproxy-0.1.1-rc.2-discovered-input-modalities.1.tgz"),
    "package/lib/index.js",
  ], { encoding: "utf8" });
  assert.match(host, /input: z\$1\.array\(z\$1\.union\(\[z\$1\.literal\("text"\), z\$1\.literal\("image"\)\]\)\)\.min\(1\)\.optional\(\)/u);

  const connection = execFileSync("tar.exe", [
    "-xOf",
    join(root, "packages", "dsh-client-connection-0.1.1-rc.2-discovered-input-modalities.1.tgz"),
    "package/lib/client.js",
  ], { encoding: "utf8" });
  assert.match(connection, /input: array\(union\(\[literal\("text"\), literal\("image"\)\]\)\)\.min\(1\)\.optional\(\)/u);

  const settingsModels = execFileSync("tar.exe", [
    "-xOf",
    join(root, "packages", "dsh-client-ui-settings-models-0.1.1-rc.2-discovered-input-modalities.1.tgz"),
    "package/lib/client.js",
  ], { encoding: "utf8" });
  assert.match(settingsModels, /candidate\.input === void 0 \? \{\} : \{ input: \[\.\.\.candidate\.input\] \}/u);
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

test("pinned control artifacts include durable asynchronous reports and their Skills", () => {
  const sessionArchive = join(root, "packages", "dsh-session-control-0.7.1.tgz");
  const sessionNotifier = execFileSync(
    "tar.exe",
    ["-xOf", sessionArchive, "package/lib/operation-notifier.js"],
    { encoding: "utf8" },
  );
  const sessionSkill = execFileSync(
    "tar.exe",
    ["-xOf", sessionArchive, "package/skills/dsh-session-control/SKILL.md"],
    { encoding: "utf8" },
  );
  assert.match(sessionNotifier, /operation-terminal-report/u);
  assert.match(sessionNotifier, /completionDelivery === 'followup'/u);
  assert.match(sessionSkill, /completion_delivery=followup/u);

  const subagentArchive = join(root, "packages", "dsh-subagent-code-agents-0.1.7.tgz");
  const runNotifier = execFileSync(
    "tar.exe",
    ["-xOf", subagentArchive, "package/packages/plugin/lib/run-notifier.js"],
    { encoding: "utf8" },
  );
  const subagentSkill = execFileSync(
    "tar.exe",
    ["-xOf", subagentArchive, "package/packages/plugin/skills/dsh-code-agents/SKILL.md"],
    { encoding: "utf8" },
  );
  const subagentTool = execFileSync(
    "tar.exe",
    ["-xOf", subagentArchive, "package/packages/plugin/lib/tool.js"],
    { encoding: "utf8" },
  );
  const codexChannel = execFileSync(
    "tar.exe",
    ["-xOf", subagentArchive, "package/node_modules/@dsh-subagent-code-agents/channel-codex/lib/index.js"],
    { encoding: "utf8" },
  );
  assert.match(runNotifier, /run-terminal-report/u);
  assert.match(subagentSkill, /默认后台运行/u);
  assert.match(subagentSkill, /role=action-advisor/u);
  assert.match(subagentSkill, /默认后台运行并使用 `followup`/u);
  assert.match(subagentTool, /claimNativeJobNotice/u);
  assert.match(subagentTool, /jobs\.wait/u);
  assert.match(codexChannel, /sandbox_mode="read-only"/u);
  assert.doesNotMatch(codexChannel, /exec', 'resume'.*--sandbox/su);
});

test("source snapshots match their bundled artifacts", () => {
  const cases = [
    ["dsh-client-ui-conversation-message-provenance", "dsh-client-ui-conversation-0.1.1-rc.2-message-provenance.2.tgz", "lib/client.js"],
    ["dsh-client-ui-workspace-copy-session-id", "dsh-client-ui-workspace-0.1.1-rc.2-copy-session-id.1.tgz", "lib/client.js"],
    ["dsh-llm-pi-ai-live-discovery", "dsh-llm-pi-ai-0.1.1-rc.2-network-error-live-discovery-fix.3.tgz", "lib/index.js"],
    ["dsh-host-apiproxy-image-modalities", "dsh-host-apiproxy-0.1.1-rc.2-discovered-input-modalities.1.tgz", "lib/index.js"],
    ["dsh-client-connection-image-modalities", "dsh-client-connection-0.1.1-rc.2-discovered-input-modalities.1.tgz", "lib/client.js"],
    ["dsh-client-ui-settings-models-image-modalities", "dsh-client-ui-settings-models-0.1.1-rc.2-discovered-input-modalities.1.tgz", "lib/client.js"],
  ];
  for (const [sourceName, archiveName, mainFile] of cases) {
    const temp = mkdtempSync(join(tmpdir(), "dsh-distro-source-"));
    try {
      execFileSync("tar.exe", ["-xf", join(root, "packages", archiveName), "-C", temp]);
      const sourcePackage = JSON.parse(readFileSync(join(root, "sources", sourceName, "package.json"), "utf8"));
      const artifactPackage = JSON.parse(readFileSync(join(temp, "package", "package.json"), "utf8"));
      assert.equal(artifactPackage.name, sourcePackage.name);
      assert.equal(artifactPackage.version, sourcePackage.version);
      assert.deepEqual(artifactPackage.dshLocalPatch, sourcePackage.dshLocalPatch);
      assert.equal(
        normalizeText(readFileSync(join(temp, "package", mainFile), "utf8")),
        normalizeText(readFileSync(join(root, "sources", sourceName, mainFile), "utf8")),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
