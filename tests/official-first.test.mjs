import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=relative=>fs.readFileSync(new URL(relative,root),'utf8');
test('default profile delegates file references to official modules without erasing legacy artifacts',()=>{
  const release=JSON.parse(read('manifest/release-lock.json'));
  const profile=JSON.parse(read('templates/profile.package.json'));
  const app=JSON.parse(read('templates/app/package.json'));
  assert.deepEqual(profile.dsh.profile.bundles,release.profile.bundles);
  assert.ok(!profile.dsh.profile.bundles.includes('dsh-at-file'));
  assert.equal(release.artifacts.find(a=>a.package==='dsh-at-file').activation,'opt-in-legacy');
  for(const name of ['dsh-file-reference','dsh-file-reference-local','dsh-client-ui-reference','dsh-http-proxy'])assert.equal(app.dependencies['@deepseek-ai/'+name],release.base.version);
});
