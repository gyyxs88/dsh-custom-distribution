import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function archiveSource(file, member) {
  return execFileSync("tar.exe", ["-xOf", join(root, "packages", file), `package/${member}`], { encoding: "utf8" });
}

function normalizeText(text) {
  return text.replaceAll("\r\n", "\n");
}

test("pi-ai package contains reviewed transport, discovery, capability, and routing policies", () => {
  const source = archiveSource("dsh-llm-pi-ai-0.1.2-rc.1-model-capability-routing.2.tgz", "lib/index.js");
  assert.match(source, /network\(\?:_error\)\?/u);
  assert.match(source, /LIVE_CATALOG_DISCOVERY_POLICIES/u);
  assert.match(source, /\["openrouter", "configured-or-catalog"\]/u);
  assert.match(source, /top_provider\?\.max_completion_tokens/u);
  assert.match(source, /architecture\?\.input_modalities/u);
  assert.match(source, /defaultReasoningEffort/u);
  assert.match(source, /openRouterRouting/u);
});

test("portable Windows startup uses the fail-closed DSH module proxy fallback", () => {
  const source = archiveSource("dsh-app-boot-0.1.2-rc.1-windows-module-fallback-proxy.1.tgz", "lib/index.js");
  assert.match(source, /DSH_MODULE_FALLBACK_MODE/u);
  assert.match(source, /must be "proxy" when set/u);
  assert.match(source, /mode === "proxy"/u);
  const start = readFileSync(join(root, "scripts", "Start-DSH.ps1"), "utf8");
  assert.match(start, /\$env:DSH_MODULE_FALLBACK_MODE = 'proxy'/u);
});

test("discovered capabilities survive the core service, remote API, and browser editor", () => {
  const llm = archiveSource("dsh-llm-0.1.2-rc.1-discovered-model-capabilities.2.tgz", "lib/index.js");
  assert.match(llm, /rawReasoningEfforts/u);
  assert.match(llm, /defaultReasoningEffort in reasoningEfforts/u);
  const typert = archiveSource("dsh-llm-0.1.2-rc.1-discovered-model-capabilities.2.tgz", "lib/typert.host.js");
  assert.match(typert, /'input': z\.array/u);
  assert.match(typert, /'reasoningEfforts': z\.union/u);
  assert.match(typert, /'defaultReasoningEffort': z\.union/u);

  const remotes = archiveSource("dsh-api-remotes-0.1.2-rc.1-discovered-model-capabilities.2.tgz", "lib/client.js");
  assert.match(remotes, /defaultReasoningEffort/u);
  assert.match(remotes, /input.*literal\("image"\)/su);

  const settings = archiveSource("dsh-client-ui-settings-models-0.1.2-rc.1-model-capability-editor.2.tgz", "lib/client.js");
  assert.match(settings, /candidate\.input === void 0 \? \{\} : \{ input: \[\.\.\.candidate\.input\] \}/u);
  assert.match(settings, /function OpenRouterRoutingEditor/u);
  assert.match(settings, /function DefaultModelEditor/u);
  assert.match(settings, /reasoningSelectionUnavailable/u);
});

test("the rc1 official conversation UI owns message provenance", () => {
  const app = JSON.parse(readFileSync(join(root, "templates", "app", "package.json"), "utf8"));
  assert.equal(app.dependencies["@deepseek-ai/dsh-client-ui-conversation"], "0.1.2-rc.1");
  assert.equal(Object.keys(app.dependencies).some(name => name.includes("message-provenance")), false);
  assert.equal(Object.values(app.dependencies).some(value => String(value).includes("message-provenance")), false);
});

test("session menu copies the durable session ID", () => {
  const source = readFileSync(join(root, "sources", "dsh-client-ui-workspace-copy-session-id", "lib", "client.js"), "utf8");
  assert.match(source, /id: "copy-session-id"/u);
  assert.match(source, /writeClipboard\)\(node\.id\)/u);
  assert.match(source, /"menu.copySessionId": "复制会话 ID"/u);
});

test("portable service control is bundled and retains PID and loopback gates", () => {
  const host = archiveSource("dsh-local-service-control-0.2.0.tgz", "lib/index.js");
  assert.match(host, /isLoopbackAddress/u);
  assert.match(host, /isSameOrigin/u);
  assert.match(host, /'-InstallRoot'/u);
  const common = readFileSync(join(root, "scripts", "Common.ps1"), "utf8");
  const launcher = readFileSync(join(root, "scripts", "Service-Control-Launcher.ps1"), "utf8");
  const worker = readFileSync(join(root, "scripts", "Service-Control-Worker.ps1"), "utf8");
  const releaseAcceptance = readFileSync(join(root, "scripts", "Test-Release.ps1"), "utf8");
  assert.match(common, /local-service-control/u);
  assert.match(launcher, /Start-Process/u);
  assert.match(launcher, /-WindowStyle Hidden/u);
  assert.doesNotMatch(launcher, /Win32_Process/u);
  assert.match(worker, /ProcessId -ne \$ExpectedHarnessPid/u);
  assert.match(releaseAcceptance, /URL=\[REDACTED\]/u);
});

test("at-file uses the DSH 0.1.2 settings namespace contract", () => {
  const host = archiveSource("dsh-at-file-0.6.8.tgz", "lib/index.js");
  assert.match(host, /AT_FILE_NAMESPACE = "at-file"/u);
  assert.doesNotMatch(host, /settingsNamespace/u);
});

test("pinned control artifacts include durable asynchronous reports and their Skills", () => {
  const sessionFile = "dsh-session-control-0.8.0.tgz";
  const sessionNotifier = archiveSource(sessionFile, "lib/operation-notifier.js");
  const sessionSkill = archiveSource(sessionFile, "skills/dsh-session-control/SKILL.md");
  const sessionSecurity = archiveSource(sessionFile, "lib/security.js");
  const sessionEvents = archiveSource(sessionFile, "lib/session-events.js");
  assert.match(sessionNotifier, /operation-terminal-report/u);
  assert.match(sessionNotifier, /completionDelivery === 'followup'/u);
  assert.match(sessionSkill, /completion_delivery=followup/u);
  assert.match(sessionSkill, /不能剥离 `session-` 前缀/u);
  assert.match(sessionSkill, /自动兼容 live\/cold/u);
  assert.match(sessionSecurity, /data\?\.message\?\.source\?\.callId/u);
  assert.match(sessionEvents, /snapshotEvents/u);

  const remotePackage = JSON.parse(archiveSource("dsh-remote-control-0.3.0.tgz", "package.json"));
  assert.equal(remotePackage.peerDependencies["dsh-session-control"], ">=0.8.0 <0.9.0");

  const subagentFile = "dsh-subagent-code-agents-0.2.0.tgz";
  const runNotifier = archiveSource(subagentFile, "packages/plugin/lib/run-notifier.js");
  const subagentSkill = archiveSource(subagentFile, "packages/plugin/skills/dsh-code-agents/SKILL.md");
  const subagentTool = archiveSource(subagentFile, "packages/plugin/lib/tool.js");
  const ownedRuns = archiveSource(subagentFile, "packages/plugin/lib/owned-runs.js");
  const codexChannel = archiveSource(subagentFile, "node_modules/@dsh-subagent-code-agents/channel-codex/lib/index.js");
  assert.match(runNotifier, /snapshotEvents/u);
  assert.match(subagentSkill, /默认后台运行/u);
  assert.match(subagentSkill, /role=action-advisor/u);
  assert.match(subagentTool, /claimNativeJobNotice/u);
  assert.match(subagentTool, /jobs\.wait/u);
  assert.match(subagentSkill, /先用 `coding_run_read`/u);
  assert.match(ownedRuns, /const VERSION = 2/u);
  assert.match(codexChannel, /sandbox_mode="read-only"/u);
});

test("source snapshots match their bundled artifacts", () => {
  const cases = [
    ["dsh-app-boot-windows-module-proxy", "dsh-app-boot-0.1.2-rc.1-windows-module-fallback-proxy.1.tgz", "lib/index.js"],
    ["dsh-at-file-settings-rc1", "dsh-at-file-0.6.8.tgz", "lib/index.js"],
    ["dsh-llm-model-discovery-capabilities", "dsh-llm-0.1.2-rc.1-discovered-model-capabilities.2.tgz", "lib/index.js"],
    ["dsh-api-remotes-model-discovery-capabilities", "dsh-api-remotes-0.1.2-rc.1-discovered-model-capabilities.2.tgz", "lib/client.js"],
    ["dsh-llm-pi-ai-live-discovery", "dsh-llm-pi-ai-0.1.2-rc.1-model-capability-routing.2.tgz", "lib/index.js"],
    ["dsh-client-ui-settings-models-image-modalities", "dsh-client-ui-settings-models-0.1.2-rc.1-model-capability-editor.2.tgz", "lib/client.js"],
    ["dsh-client-ui-workspace-copy-session-id", "dsh-client-ui-workspace-0.1.2-rc.1-copy-session-id.2.tgz", "lib/client.js"],
    ["dsh-local-service-control", "dsh-local-service-control-0.2.0.tgz", "lib/index.js"],
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
