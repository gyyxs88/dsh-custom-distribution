import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

if (process.argv[2]) {
  const root = path.resolve(process.argv[2]);
  const ready = JSON.parse(fs.readFileSync(path.join(root, 'candidate-ready.json')));
  const home = process.env.DSH_HOME;
  assert.ok(home?.startsWith(root) && home.includes('permissions-fixture'));
  const runtime = `${ready.archive}/dsh`;
  const base = `${runtime}/node_modules/@deepseek-ai/`;
  const { loadLayeredEnv, loadProfileDirectory } = await import(pathToFileURL(`${base}dsh-app-boot/lib/index.js`));
  const { runProfile } = await import(pathToFileURL(`${base}dsh/lib/profile-boot.js`));
  const profileDir = path.join(home, 'profiles/desktop');
  const installAnchor = `${base}dsh/package.json`;
  const profile = loadProfileDirectory('dsh', profileDir, installAnchor);
  const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop',
    resolvedProfile: { profile, installAnchor }, patchFiles: [], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] });
  const report = { status: 'RUNNING', cases: [], realOfficialHost: true, realProviderRequests: 0 };
  let handle;
  const add = name => report.cases.push({ name, passed: true });
  try {
    const rows = await ctx.sessionPersistence.list({});
    const selected = rows.find(row => row.header.origin === undefined && row.header.agentPreset !== 'minimal');
    assert.ok(selected);
    handle = await ctx.agents.resume({ resumeSessionId: selected.header.id, agentOptions: { provider: 'fixture', model: 'fixture-model' } });
    const agent = handle.agent;
    assert.equal(ctx.agents.get(agent.id), agent);
    add('old ordinary root resumes through the actual official factory');
    const settle = async expected => {
      for (let i = 0; i < 100; i++) {
        if (!!ctx.tools.get('session_workspace_list', agent) === expected) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail('permission tool mount did not settle');
    };
    ctx.permissionPresets.set(agent.session, 'danger-full-access');
    await settle(true);
    const list = ctx.tools.get('session_workspace_list', agent);
    const exec = { agent, signal: AbortSignal.timeout(10000) };
    const listed = await list.execute({}, exec);
    assert.equal(listed.ok, true);
    assert.equal(listed.count, ctx.workspaceRegistry.list().length);
    assert.ok(ctx.tools.get('remote_host_list', agent));
    add('unlisted Full Access root receives session and remote tools and lists actual workspaces');
    const made = [];
    for (let i = 0; i < 2; i++) {
      const directory = path.join(home, `workspace-test-${i}`);
      const result = await ctx.tools.get('session_workspace_add', agent).execute({ path: directory, idempotency_key: `upgrade021-add-${i}` }, exec);
      assert.equal(result.ok, true);
      fs.writeFileSync(path.join(directory, 'keep.txt'), 'keep');
      made.push({ directory, id: result.workspace.workspace_id, i });
    }
    for (const { directory, id, i } of made) {
      const tool = ctx.tools.get('session_workspace_remove', agent);
      const args = { workspace_id: id, expected_path: directory, idempotency_key: `upgrade021-remove-${i}` };
      assert.equal((await tool.execute(args, exec)).ok, true);
      assert.equal((await tool.execute(args, exec)).duplicate, true);
      assert.equal(fs.readFileSync(path.join(directory, 'keep.txt'), 'utf8'), 'keep');
    }
    add('batch workspace register/unregister uses real registry; repeat is idempotent and directories survive');
    ctx.permissionPresets.set(agent.session, 'workspace-write');
    await settle(false);
    assert.equal(ctx.tools.get('remote_host_list', agent), undefined);
    await assert.rejects(list.execute({}, exec), /控制权限/);
    add('downgrade revokes actual tool definitions and cached handles refuse execution');
    ctx.permissionPresets.set(agent.session, 'danger-full-access');
    await settle(true);
    assert.equal((await ctx.tools.get('session_workspace_list', agent).execute({}, exec)).ok, true);
    add('official three-event regrant restores tools without a control-session allowlist');
    report.status = 'PASSED';
  } catch (error) { report.status = 'FAILED'; report.error = { name: error.name, message: error.message }; process.exitCode = 1; }
  finally {
    await handle?.dispose();
    fs.writeFileSync(path.join(root, 'permissions-host-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    await shutdown.shutdown(process.exitCode ?? 0);
  }
}
