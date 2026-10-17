# Independent Desktop 0.2.1-rc.2 release

The 2026-10-17 candidate uses the signed official Windows installer without ASAR
changes. `sources/dsh-desktop-compat` is now pinned to the reviewed 0.2.1-rc.2
adapters and Cordis 4.0.5. Its discovery supplement only handles catalog routes;
uncatalogued routes delegate to official live discovery. The copy-ID bundle and
inactive OpenCode wrapper retire from the active Desktop profile. Their archives
and history remain available. GenUI's generated client must be rebuilt from the
settle-fixed TypeScript source before packing; stale tracked build output does
not contain the previous fix.

For isolated release gates, pass all three explicit paths:

```powershell
node scripts/Release-Desktop.mjs <output> <official-app.asar> <official-electron.exe>
```

`scripts/Prepare-Upgrade021Fixture.mjs <task-root> <fixture-name>` consumes the
accepted `candidate-ready.json` and `artifact-set.json`. It creates an ACL protected
home containing read-only copies of sessions, attachments, storages and workspace
state, replaces credentials and model routes with offline fixtures, and extracts
only the selected TGZs. Its modified profile is never a production deployment
source. Production changes are separately proposed in
`deployment-manifest-proposal.json`; preserve the live patch file bytes.

`scripts/Start-Upgrade021Fixture.mjs <task-root> <fixture-name>` starts the exact
official Desktop Host on an OS-assigned loopback port. The authentication URL is
written only to the protected `<fixture-name>/ready-private.json`. A prompt
containing `genui` returns streamed dsh-ui plus ordinary JSON; `fixture:region`,
`fixture:forbidden`, `fixture:quota` and `fixture:auth` return controlled errors.
Create `<fixture-name>/stop-request` to request official idle inspection and
shutdown over IPC. Active or unknown work refuses shutdown. The process owner
and lifecycle are recorded in the private ready file and lifecycle.json.

The accepted TPS supplement is supplied independently by executor B. It uses
public external composition and a generated trajectory module overlay; it is
custom supplemental code. The official ASAR must retain its initial hash.

## Persistent Desktop launch

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Desktop.ps1`
starts the installed `D:/DSH/DeepSeek Harness.exe` with the stable OS launch baseline
plus the caller's proxy variables. Provider/auth and test environment overrides are
excluded, retaining the previous production credential precedence. The short tracked
helper `desktop/launch-desktop.cjs` runs using installed Electron's Node runtime.
Missing proxy names alone fall back to current-user and then machine persistence;
explicit values, casing and NO_PROXY are retained. Routing remains owned by official
`dsh-http-proxy`. No Node proxy flag or fetch patch is added. Windows environment
names are case insensitive. Existing Desktop instances are reused under a launch
mutex; this entry never stops a running app. Official executable and updater remain
unchanged. Launch logs are under `%LOCALAPPDATA%/DSH-Desktop-Launcher` and may contain
official private access URLs; do not publish their raw content. Isolated DSH_HOME is
refused; Electron/Node test execution switches are removed for the child only.
The Desktop shortcut may point to this tracked script; keep the separate Web shortcut.

This track leaves the existing Web/legacy `build`, `test` and `acceptance` commands intact.
Use Node 24.19.0 for these entrypoints. The real adapter tests use installed Electron
Node mode (currently Node 24.18.1) with an explicitly isolated environment and mock
credentials, never the running Desktop/Web service.

```powershell
& D:/Project/deepseek-harness-lab/web-validation/.runtime/node-v24.19.0-win-x64/node.exe scripts/Release-Desktop.mjs
```

Independent steps: `Build-Desktop.mjs [candidate-directory] [asar]`,
`Test-Desktop.mjs [output-directory] [asar] [electron] [entry]`, and
`Test-DesktopRetirement.mjs [output-directory] [asar] [electron]`.
The retirement check applies no supplement; exit 2 means measured NOT_ELIGIBLE,
exit 1 means an execution failure or unknown official API shape requiring probe adaptation.
Retirement probes record the installed official versions/hashes without enforcing rc.2.
They never import or apply the supplement, and measure every coverage result from
real service calls. The current probe covers legacy Go/discovery/network behavior.
If those checks all pass, it returns NEEDS_ADAPTATION until the rc.2.3 error
classification, native/account/Files and normal-retry coverage is measured too;
legacy success alone must never declare ELIGIBLE or remove this supplement.
The current rc.2 legacy failures still return NOT_ELIGIBLE. The supplement's activation
contract remains strictly pinned to reviewed rc.2 source.

The release entry builds a deterministic package, verifies every member against
source, runs real ASAR adapter/service tests against the unpacked package, checks
the official baseline for retirement, then verifies source/package agreement again.
Outputs default to `temp/desktop-repair-20260930` in the engineering workspace,
including `候选/`, `packaged-test/`, `retirement/`, and `desktop-release-gates.json`.
No package manager install, official dependency copies, production edits or restart.

The package replaces `dsh-desktop-opencode-session`. The main controller must
remove the old bundle and add this candidate in its isolated deployment, verify
official Loader resolution and runtime behavior, and accept before publishing.
Local source commit is provided to the main controller; push belongs to it.
