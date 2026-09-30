# Independent Desktop rc.2 release

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
real service calls. All probes must pass for ELIGIBLE. The supplement's activation
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
