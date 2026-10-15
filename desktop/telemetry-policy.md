# Official Desktop telemetry policy

For the official Desktop 0.2.0-rc.2, keep all services installed and add profile configuration for three independent upload paths:

| Entry | Configuration |
| --- | --- |
| `product-analytics` | `enabled: false` plus the complete existing config and `appVersion` |
| `session-log-deepseek` | `enabled: false` plus the complete existing config |
| `session-telemetry-otel` | `mode: DISABLED` plus the complete existing config |

Official profile patches replace a whole `config`; they do not merge individual keys. `telemetry-policy.cjs` safely parses YAML nodes, preserves `!!js` as tagged scalar text without evaluation, retains the complete effective target configs, and appends only needed override rows. All original bytes remain an identical prefix. Applying the policy twice yields the same bytes. It refuses unsupported target structure and missing official rows. It never installs a plugin or modifies ASAR, providers, models, account records, sessions, attachments or workspaces.

Use the installed Desktop Electron in Node mode with `--expose-internals`. Before `prepare`, create a fresh output directory and disable ACL inheritance, allowing only the current user and SYSTEM. The output contains private configuration and must stay restricted. Do not include credentials, auth files or `.env` in backups or evidence.

```text
DeepSeek Harness.exe --expose-internals telemetry-policy.cjs prepare PROFILE PRIVATE_OUTPUT
```

Set `ELECTRON_RUN_AS_NODE=1` for this helper invocation only. The default public code archive is `D:/DSH/resources/app.asar`; `DSH_POLICY_ARCHIVE` permits an explicitly selected installation. `prepare` produces `profile.before.yml`, `profile.candidate.yml` and `candidate-manifest.json`; existing evidence is never overwritten.

Before applying: review the exact candidate hash and changes, validate an isolated full Desktop Host with synthetic data and loopback transport, confirm live work is idle, freshly verify the profile baseline, and back up the five profile configuration/manifest files into another restricted directory. Stop only the verified Desktop process tree. `CloseMainWindow` hides this official version to the tray; process termination must follow the current controller's approved procedure.

```text
DeepSeek Harness.exe --expose-internals telemetry-policy.cjs apply PROFILE PRIVATE_OUTPUT ACCEPTED_CANDIDATE_SHA256
```

`apply` refuses a changed profile, candidate, metadata or generated policy result. It writes only the existing `cordis.patch.yml`, preserving its ACL. Clear helper/isolation environment before launching the real desktop. Redirect stdout/stderr to files. If temporarily enabling CDP, bind it to loopback, verify actual UI/RPC policy and restore a normal visible single instance with debug closed afterward.

To recover, first verify idle and stop the approved Desktop instance. Check that the current patch hash still equals the applied candidate, then restore only `cordis.patch.yml` from the restricted backup. Preserve all newer unrelated profile changes instead of blindly restoring a stale file. Restart the official Desktop and verify its visible window, Host process and listener. Retain all session logs and installed plugins. Official startup can append a session restore boundary; audit any such delta without truncating or restoring session data.

2026-10-15 evidence: `D:/Project/deepseek-harness-lab/temp/telemetry-disable-20261015/`. The accepted candidate SHA256 is `59fd2b19cc2cf9f23e680b7b11971be50f789de66e599e3bb8d7582e657b3c2e`. Isolated acceptance covers strict RPC disabled policy, typed events with zero exporter enqueue, durable local feedback with zero OTel capture, a successful official adapter synthetic loopback SSE response without `dsh_session_log`, retained account services and model route, and exporter flush/disposal with zero telemetry transport. No real provider, account sign-in or feedback was invoked.
