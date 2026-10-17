# Desktop 0.2.1-rc.2 upgrade

Date: 2026-10-17. Scope: `D:/DSH` Desktop. Web validation on port 3080 is unchanged.

## Official package

- Release: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2
- Source tag: `687f282e8625c6b8d11ff58211a90524be2e4317`.
- Installer SHA256: `72e4a8579f11b5428dd0a1506532777924adba7ecaacc710a7e429085796537f`.
- Official ASAR SHA256: `47874618bf5b3011fcaac10cd4c85f69da333e70d4f99b921207c78d0999512a`.
- Installer and extracted executable have valid DeepSeek Authenticode signatures. No ASAR modifications or repacking.

The packaged runtime reports DSH 0.2.1-rc.2, Cordis 4.0.5 and pi-ai 1.1.0. Baked client build identifiers differ from the source tag; compatibility checks pin the actual packaged modules and their hashes.

## Official feature convergence

| Area | Decision and evidence |
| --- | --- |
| Copy Session ID | Retire the local active bundle and dependency. The official menu supplies the action and success/failure notifications; both paths were checked in the candidate UI. Keep historical source and archives. |
| Legacy OpenCode session wrapper | Remove the already inactive default dependency. The compatibility supplement owns the remaining request identity gap. |
| Model discovery | Delegate uncatalogued providers to official live discovery. Retain endpoint-first discovery only for providers for which the official adapter still returns a static catalog. |
| TPS | Retire the old full stats replacement. Keep a supplement for the activity slot and a generated external trajectory overlay with five exact-source transformations. The official usage slot and ASAR remain unchanged. Withdrawal restores the built-in trajectory. |
| Session management | Keep durable cross-session and workspace tools. Actual official Host tests cover Full Access admission, permission downgrade, cached-handle refusal, regrant and workspace removal without deleting directories. |
| Remote management | Keep host registry, desired state and gateway policies. Native SSH primitives do not cover those contracts. No live remote server was changed or tested in this upgrade. |
| External coding agents | Keep persistent external sessions, owned-run receipts, advisor roles and Grok/ACP channels. Preserve the existing native defaults. Channel verification uses mock wires, not external model calls. |
| GenUI | Keep source-verified dsh-ui rendering and panels. Rebuild the previously stale tracked client from the existing settle-fixed source. Streaming, completion and reload preserve components; ordinary JSON remains code. |
| Error classification, retries and Go session identity | Keep the measured gaps. The official adapter still misclassifies structured 403 errors and preserves stale Go identity headers. Official retry policy remains responsible for retry decisions. |
| Launcher and privacy settings | Preserve proxy inheritance, duplicate-launch protection and all three telemetry disables. Preserve models, credentials, default selection, workspaces and session data. |

Inactive historical Web/internal replacement packages remain inactive in Desktop and available for recovery.

## Accepted supplemental artifacts

| Package | Version | SHA256 |
| --- | --- | --- |
| dsh-desktop-compat | 0.2.1-rc.2.2 | `71edf945c13ad2efb6de75ae29058f5b3ae106e8aefaa03c467a35fd78919f02` |
| dsh-remote-control | 0.3.3-dsh021.2 | `93712a097c2737db90b8dd443451a15ca3ee5b3428dffabdf9506fbe31e5930a` |
| dsh-session-control | 0.8.5-dsh021.1 | `960f55fdb83396f39dedc26bc344688f1d2fd8fb4dc517cf1fb87e6aa49dadbd` |
| dsh-subagent-code-agents | 0.2.4-dsh021.1 | `8f2923e4d76a9b6c8af58b75e912f0aa12a0f4933da778d996816c731e33632b` |
| @omdsh-dev/dsh-genui | 0.9.1-dsh021.2 | `aa76c1b0d15b2a8ec75694a82403a062895d448cb55afe5e2c9a3497660439b0` |
| dsh-tps-correction | 0.2.1-rc.2.1 | `c20db4c248b9521db7b5684f4b0147fcaa9153b619144859b6480add867e7c3f` |

The remote-control peer range explicitly accepts the session-control prerelease. Ordinary `>=0.8.0 <0.9.0` excludes it.

## Candidate acceptance

- Packaged adapter integration: 102 checks; native/account/Files/retry integration: 29 checks.
- Actual complete official Host permission and workspace API: five cases passed.
- Session management: 17 tests; remote management: 13 passed, two platform skips; coding plugin: 48 tests; channel/policy: 55 passed, one optional-service skip.
- GenUI: 22 passed, two private-fixture skips. The rebuilt client equals the previously accepted production client hash.
- TPS: 11 replay groups / 17 cases, exact module hashes, generated package reproducibility, Loader lifecycle and UI acceptance.
- Official CLI: offline add succeeded; restart loaded the supplement. Remove succeeded; restart restored the official trajectory with no overlay entries.
- Main independent UI: historical title/body, unique native copy action and failure toast, GenUI stream/completion/reload, ordinary JSON, single estimated speed with matching trajectory detail, usage/cache, accurate region failure and unavailable-speed fallback. No page errors or unexpected external requests. The 1600 x 1000 shell fit the viewport.
- Before deployment, all 463 production files in the preservation snapshot were unchanged by isolation tests. Tests used copied sessions and synthetic local model endpoints. No paid provider requests were made.

Detailed local evidence is retained under `temp/upgrade-021rc2-20261017` in this repository and the workspace root. Private authentication URLs and copied history are not committed.

## Production acceptance

Candidate accepted and installed on 2026-10-17. The production ASAR matches the official hash above. A fresh program/home backup passed full file/link comparison: 9,773 program entries and 10,017 home entries, with no mismatches. Backup ACLs allow only the current user and SYSTEM. The rollback plan preserves current session/settings/credential data rather than restoring an older home snapshot automatically.

Independent production checks confirmed a normal visible cold launch, one main window and one Host, an actual loopback listener and no debugging flags. Reopening the persistent launcher returned `ALREADY_RUNNING` for the same main process. Selected environment inspection confirmed that both main and Host inherit the v2rayN proxy on port 10808. Process/User/Machine proxy fingerprints and Windows proxy settings were unchanged.

Of the 463 protected data/configuration files, 459 remained byte-identical. The four differences were the intended plugin manifest, a process lock, one derived projection cache, and an 82-byte append to an existing session. The original session prefix is unchanged; independent zstd decoding found only `session/end-seed`. Models, credentials, workspace data and the profile patch remained byte-identical.

Final production Loader/API acceptance passed: DSH 0.2.1-rc.2 / Cordis 4.0.5, authenticated HTTP succeeds, unauthenticated RPC returns 401, all required supplemental entries are active, retired entries are absent, and all 169 existing sessions are listed. No enabled entry is left pending or failed.

The installed official Host and PiAiAdapter completed controlled SSE requests for `openai-completions`, `openai-responses` and `anthropic-messages`. Socket metadata records three actual connections to v2rayN at `127.0.0.1:10808`; loopback access remains direct. There were no real provider calls or messages sent to production sessions.

Artifacts are retained in `plugin-development/releases/dsh-desktop-0.2.1-rc.2/upgrade-20261017`. The verified backup, deployment journal and guarded `Rollback-Production.ps1` are retained in this repository's task directory. Rollback path validation is performed without applying a production rollback; full disaster recovery was not rehearsed against the live installation. The normal visible Desktop remains running after acceptance.
