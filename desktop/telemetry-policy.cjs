/* Official profile policy only. Run with Desktop Electron in Node mode. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const archive = process.env.DSH_POLICY_ARCHIVE || 'D:/DSH/resources/app.asar';
const req = createRequire(archive + '/dsh/package.json');
const YAML = req('yaml');
const sha = b => createHash('sha256').update(b).digest('hex');
const targets = { 'product-analytics': ['enabled', false], 'session-log-deepseek': ['enabled', false], 'session-telemetry-otel': ['mode', 'DISABLED'] };
function parse(text) {
  const doc = YAML.parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }], keepSourceTokens: true, uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw Error('Unsafe/unsupported YAML: ' + [...doc.errors, ...doc.warnings].map(e => e.message).join(';'));
  if (!YAML.isSeq(doc.contents)) throw Error('Expected literal patch sequence');
  return doc;
}
// Keep expression tags in the semantic comparison; never compile/evaluate !!js.
function semantic(node) {
  if (YAML.isMap(node)) return Object.fromEntries(node.items.map(p => [String(p.key?.value ?? p.key), semantic(p.value)]));
  if (YAML.isSeq(node)) return node.items.map(semantic);
  if (YAML.isAlias(node)) throw Error('Aliases are not accepted by this maintenance policy');
  return node == null ? null : node.tag ? { tag: node.tag, value: node.value } : YAML.isScalar(node) ? node.value : node;
}
function fold(root, rows) {
  for (const row of rows.items) {
    if (!YAML.isMap(row)) throw Error('Expected literal patch mapping');
    const insert = row.get('insert', true);
    const id = row.get('id');
    if (insert) {
      if (id) {
        // No target is a group. Unrelated group contents cannot overwrite these ids silently.
        const walk = n => { if (YAML.isMap(n) && targets[n.get('id')]) throw Error('Target inside group insertion requires review'); if (n?.items) for (const c of n.items) { if (c.key) walk(c.value); else walk(c); } };
        walk(insert);
      } else for (const r of insert.items) {
        const rid = r.get('id');
        if (targets[rid]) root.set(rid, r.clone());
      }
    } else if (targets[id] && root.has(id)) {
      const target = root.get(id);
      if (row.get('name') && row.get('name') !== target.get('name')) throw Error('Target name assertion mismatch: ' + id);
      for (const pair of row.items) if (!['id','name'].includes(pair.key.value)) target.set(pair.key.value, pair.value?.clone());
    }
  }
  return root;
}
function defaults() {
  const m = new Map();
  for (const bundle of ['dsh-base','dsh-web-app']) fold(m, parse(fs.readFileSync(archive+'/dsh/node_modules/@deepseek-ai/'+bundle+'/cordis.patch.yml','utf8')).contents);
  for (const id of Object.keys(targets)) assert(m.has(id), 'Official target absent: '+id);
  return m;
}
function candidate(before) {
  const text = before.toString('utf8');
  assert(Buffer.from(text).equals(before), 'Non UTF-8 input');
  const doc = parse(text);
  const standard = defaults();
  const current = fold(new Map([...standard].map(([id,n])=>[id,n.clone()])), doc.contents);
  const additions = new YAML.Document(new YAML.YAMLSeq());
  const changed = [];
  for (const [id,[field,value]] of Object.entries(targets)) {
    const row = current.get(id);
    assert(row.get('disabled') !== true, 'Service already removed; requires review: '+id);
    let config = row.get('config',true)?.clone() || new YAML.YAMLMap();
    assert(YAML.isMap(config) && !config.tag, 'Nonliteral target config requires review: '+id);
    if (id === 'product-analytics' && !config.has('appVersion')) config.set('appVersion',standard.get(id).get('config',true).get('appVersion',true).clone());
    if (semantic(config.get(field,true)) === value && JSON.stringify(semantic(config)) === JSON.stringify(semantic(row.get('config',true)))) continue;
    const original = semantic(config);
    config.set(field,new YAML.Scalar(value));
    const patch = new YAML.YAMLMap(); patch.set('id',id); patch.set('config',config); additions.contents.add(patch);
    changed.push({id,field,before:original[field] ?? null,after:value,preservedKeys:Object.keys(original).filter(k=>k!==field)});
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const suffix = changed.length ? (text.endsWith('\n') ? '' : eol) + eol + '# Official telemetry policy: keep services and local feedback; disable all three uploads.'+eol + additions.toString({lineWidth:0}).replace(/\r?\n/g,eol) : '';
  const after = Buffer.concat([before,Buffer.from(suffix)]);
  assert(after.subarray(0,before.length).equals(before));
  const next = fold(defaults(),parse(after.toString('utf8')).contents);
  for (const [id,[field,value]] of Object.entries(targets)) {
    assert.equal(next.get(id).get('config',true).get(field),value);
    const was=semantic(current.get(id)),now=semantic(next.get(id));
    if (id==='product-analytics' && was.config?.appVersion===undefined) (was.config ||= {}).appVersion=semantic(standard.get(id).get('config',true).get('appVersion',true));
    (was.config ||= {})[field]=value;
    assert.deepEqual(now,was,'Unexpected target semantics changed: '+id);
  }
  return { after, manifest: { policy:1, archive, beforeSha256:sha(before), candidateSha256:sha(after), beforeBytes:before.length, candidateBytes:after.length,
    originalBytesPreservedAsPrefix:true, originalSemanticsUnchanged:true, customJavaScriptEvaluated:false, changed,
    permittedProductionFile:'cordis.patch.yml', requiredProfileBackupAcl:'current user and SYSTEM only, inheritance disabled before copy' } };
}
module.exports = { parse, semantic, fold, defaults, candidate, sha, archive, req };
if (require.main===module) {
  const [mode,profile,out,expected] = process.argv.slice(2);
  const target=path.join(profile||'', 'cordis.patch.yml');
  if(mode==='prepare') {
    // Caller must create this private output directory with restricted ACL first.
    const before=fs.readFileSync(target), result=candidate(before);
    assert(candidate(result.after).after.equals(result.after),'Policy not idempotent');
    fs.writeFileSync(path.join(out,'profile.before.yml'),before,{flag:'wx'});
    fs.writeFileSync(path.join(out,'profile.candidate.yml'),result.after,{flag:'wx'});
    const preservedFiles=['package.json','pnpm-lock.yaml','cordis.yml','pnpm-workspace.yaml'].map(name=>({name,sha256:sha(fs.readFileSync(path.join(profile,name)))}));
    fs.writeFileSync(path.join(out,'candidate-manifest.json'),JSON.stringify({...result.manifest,profile,preservedFiles,preparedAt:new Date().toISOString()},null,2),{flag:'wx'});
    console.log(JSON.stringify(result.manifest));
  } else if(mode==='apply') {
    // Controller receipt must name the exact accepted candidate hash. No implicit authorization.
    const m=JSON.parse(fs.readFileSync(path.join(out,'candidate-manifest.json')));
    assert.equal(expected,m.candidateSha256,'Controller acceptance hash missing/mismatched');
    assert.equal(path.resolve(profile),path.resolve(m.profile));
    const before=fs.readFileSync(target), after=fs.readFileSync(path.join(out,'profile.candidate.yml'));
    assert.equal(sha(before),m.beforeSha256,'Fresh profile drift; regenerate candidate and reaccept');
    assert.equal(sha(after),m.candidateSha256);
    assert(candidate(before).after.equals(after),'Policy/official-source drift');
    for(const f of m.preservedFiles) assert.equal(sha(fs.readFileSync(path.join(profile,f.name))),f.sha256,'Profile metadata drift: '+f.name);
    fs.writeFileSync(target,after); // Existing ACL remains attached to the existing file.
    assert.equal(sha(fs.readFileSync(target)),m.candidateSha256);
    console.log('APPLIED '+m.candidateSha256);
  } else throw Error('Usage: telemetry-policy.cjs prepare|apply PROFILE PRIVATE_OUTPUT [ACCEPTED_CANDIDATE_SHA256]');
}
