import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readTpsPacked, sha256, assertTpsOutput } from './Tps-Official.mjs';
import { patchTrajectory021, chat021Sha256, replaceTpsOnce } from './Tps-Patch021.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function buildTps021(readyPath, output) {
  output = assertTpsOutput(output);
  const ready = JSON.parse(fs.readFileSync(readyPath));
  if (ready.version !== '0.2.1-rc.2' || ready.status !== 'READY' || sha256(fs.readFileSync(ready.archive)) !== ready.sha256.archive) throw Error('TPS candidate identity mismatch');
  const read = (pkg, file) => readTpsPacked(ready.archive, `dsh/node_modules/@deepseek-ai/${pkg}/${file}`);
  const chat = read('dsh-client-ui-chat', 'lib/client.js').toString();
  if (sha256(chat) !== chat021Sha256) throw Error('TPS_CHAT_021_SOURCE_MISMATCH');
  const trajectory = patchTrajectory021(read('dsh-client-ui-trajectory', 'lib/client.js'));
  function fn(name) {
    const start = chat.indexOf(`\t\tfunction ${name}(`);
    const end = chat.indexOf('\n\t\t}', start) + '\n\t\t}'.length;
    if (start < 0 || end < start) throw Error(`Missing official function ${name}`);
    return chat.slice(start, end);
  }
  function object(name) {
    const start = chat.indexOf(`\t\tvar ${name} = {`);
    const end = chat.indexOf('\n\t\t};', start) + '\n\t\t};'.length;
    if (start < 0 || end < start) throw Error(`Missing official object ${name}`);
    return chat.slice(start, end);
  }
  const start = chat.indexOf('\t\tconst ActivityPill =');
  const end = chat.indexOf('\n\t\t});', start) + '\n\t\t});'.length;
  let activity = chat.slice(start, end);
  activity = replaceTpsOnce(activity, 'const speed = stats.decodeMs > 0 ? decodeSpeed(stats, t) : null;', 'const reading = useProjection("tpsCorrectionV2");\nconst estimate = reading?.estimate;\nconst speed = "输出速度（估算）: " + (estimate?.version === 2 && estimate.status === "estimated" && Number.isFinite(estimate.tps) && estimate.tps > 0 ? estimate.tps.toFixed(1) + " tok/s" : "暂无法计算");');
  activity = replaceTpsOnce(activity, 'children: t("stats.dialog.speed")', 'children: "输出速度（估算）"');
  activity = replaceTpsOnce(activity, 'title: t("stats.dialog.title"),', 'title: t("stats.dialog.title"),\n titleValue: "当前模型合格完成请求加权均值；按接收内容估算，非实时速度",');
  const shared = ['usageOutputTokens', 'assistantStepReading', 'deriveStats', 'formatDuration', 'joined$1', 'useSessionStats', 'PlainPill', 'DialogPill', 'useStatDialog'].map(fn).join('\n');
  const client = `// MIT-derived official ActivityPill only; no usage or trajectory replacement.\nwindow.__ModuleLoader__.load({id:"dsh-tps-correction",factory:(require)=>{\nconst react=require("react"),react_dom=require("react-dom"),react_jsx_runtime=require("react/jsx-runtime");\nconst _deepseek_ai_dsh_client_ui_primitives=require("@deepseek-ai/dsh-client-ui-primitives");\nconst PANEL_MARGIN=12,PANEL_GAP=8,MEASURE_STYLE={visibility:"hidden",left:0,top:0};\n${object('StatsPills_module_css_default')}\n${object('stat_dialog_module_css_default')}\n${shared}\n${activity}\nreturn {inject:["slots","configForms"],apply(ctx){\nconst host=ctx.configForms.get("ui-chat");\nconst performanceUsage={getSnapshot:()=>host.getSnapshot().value?.performanceUsage??"detailed",subscribe:listener=>host.subscribe(listener)};\nctx.slots.inject("conversation.composer.dock",()=>ctx.slots.register({name:"conversation.composer.dock",id:"activity",priority:-100,order:0,locale:"chat",inject:()=>({hooks:{performanceUsage}})},ActivityPill));\n}};\n}});\n`;
  new vm.Script(client);
  const packageRoot = path.join(output, 'package'); fs.mkdirSync(packageRoot, { recursive: true });
  const manifest = { name: 'dsh-tps-correction', description:'DSH custom TPS supplement: receive estimate and generated trajectory overlay', version: '0.2.1-rc.2.1', private: true, type: 'module', main: 'index.js', exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' }, license: 'MIT', dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-settings'] } }, peerDependencies: { '@deepseek-ai/cordis': '4.0.5', '@deepseek-ai/dsh-client-ui-chat': '0.2.1-rc.2', '@deepseek-ai/dsh-client-ui-trajectory': '0.2.1-rc.2', zod: '4.6.5' } };
  const officialTrajectory = JSON.parse(read('dsh-client-ui-trajectory','package.json'));
  const overlayManifest = {name:officialTrajectory.name, description:'DSH custom TPS supplement (generated overlay, not an unmodified official package)', version:officialTrajectory.version, type:'module', main:'index.js', exports:{'.':'./index.js','./client':'./client.js','./package.json':'./package.json'},license:'MIT',dsh:{client:officialTrajectory.dsh.client},dshLocalPatch:{id:'tps-receipt-021.1',baseVersion:ready.version,sourceSha256:trajectory.beforeSha256,generated:true,canonicalIdentityReason:'Preserves the static client module ID and dependency references; exactly one active source.'}};
  const contract = { target: ready.version, commit: ready.sourceTag.object.sha, archiveSha256: ready.sha256.archive, trajectoryDelivery: 'generated-external-loader-overlay', asarModified: false, official: ['cordis', 'dsh-client-ui-chat', 'dsh-client-ui-trajectory'].map(pkg => ({name: '@deepseek-ai/' + pkg, version: JSON.parse(read(pkg, 'package.json')).version, ...(pkg.includes('client') ? {clientSha256: sha256(read(pkg, 'lib/client.js')), ...(pkg.includes('trajectory') ? {patchedSha256: trajectory.afterSha256} : {})} : {})})), activitySlot: {name:'conversation.composer.dock',id:'activity',priority:-100}, retainedOfficialSlots:['usage'], legacyStatsSlot: false, labels: {speed:'输出速度（估算）',missing:'暂无法计算'} };
  const contents = { 'package.json': JSON.stringify(manifest,null,2)+'\n', 'contract.json':JSON.stringify(contract,null,2)+'\n', 'client.js':client, 'cordis.patch.yml': "- id: ui-trajectory\n  name: '@deepseek-ai/dsh-client-ui-trajectory'\n  disabled: true\n- insert:\n    - id: tps-correction-021\n      name: ./index.js\n    - id: tps-trajectory-021\n      name: ./overlay/index.js\n", 'index.js': fs.readFileSync(path.join(root,'sources/dsh-tps-correction/rc021/index.js')), 'stream-estimate.js': fs.readFileSync(path.join(root,'sources/dsh-tps-correction/lib/stream-estimate.js')), 'README.md': fs.readFileSync(path.join(root,'sources/dsh-tps-correction/rc021/README.md')), 'LICENSE.deepseek':fs.readFileSync(path.join(root,'sources/dsh-tps-correction/LICENSE.deepseek')), 'overlay/package.json': JSON.stringify(overlayManifest,null,2)+'\n', 'overlay/index.js':read('dsh-client-ui-trajectory','lib/index.js'), 'overlay/client.js':trajectory.source, 'overlay/LICENSE':fs.readFileSync(path.join(root,'sources/dsh-tps-correction/LICENSE.deepseek')) };
  for (const [name, bytes] of Object.entries(contents)) {fs.mkdirSync(path.dirname(path.join(packageRoot,name)),{recursive:true});fs.writeFileSync(path.join(packageRoot,name),bytes);}
  const octal=(n,len)=>n.toString(8).padStart(len-1,'0')+'\0';
  function pack(){const parts=[];for(const name of Object.keys(contents).sort()){const data=Buffer.from(contents[name]);const h=Buffer.alloc(512);h.write('package/'+name,0,100);h.write(octal(0o644,8),100);h.write(octal(0,8),108);h.write(octal(0,8),116);h.write(octal(data.length,12),124);h.write(octal(0,12),136);h.fill(32,148,156);h.write('0',156);h.write('ustar\0',257);h.write('00',263);h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);parts.push(h,data,Buffer.alloc((512-data.length%512)%512));}return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]),{level:9});}
  const bytes=pack();if(!bytes.equals(pack()))throw Error('TPS build is not reproducible');
  const archive=path.join(output,manifest.name+'-'+manifest.version+'.tgz');fs.writeFileSync(archive,bytes);
  const unpacked=path.join(output,'verified-package'),tar=gunzipSync(bytes),seen=new Set();
  for(let offset=0;offset+512<=tar.length;){
    const h=tar.subarray(offset,offset+512);if(h.every(b=>b===0))break;
    const field=(a,b)=>h.subarray(a,b).toString().split('\0')[0];const full=field(0,100),size=parseInt(field(124,136).trim(),8),name=full.slice(8);
    if(!full.startsWith('package/')||!Object.hasOwn(contents,name)||seen.has(name)||!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw Error('TPS tar member rejected');
    const checksum=Buffer.from(h);checksum.fill(32,148,156);if(checksum.reduce((a,b)=>a+b,0)!==parseInt(field(148,156).trim(),8))throw Error('TPS tar checksum mismatch');
    const payload=tar.subarray(offset+512,offset+512+size);if(!payload.equals(Buffer.from(contents[name])))throw Error('TPS tar payload mismatch');
    fs.mkdirSync(path.dirname(path.join(unpacked,name)),{recursive:true});fs.writeFileSync(path.join(unpacked,name),payload);seen.add(name);offset+=512+Math.ceil(size/512)*512;
  }
  if(seen.size!==Object.keys(contents).length)throw Error('TPS tar member count mismatch');
  fs.writeFileSync(path.join(output,'trajectory-client.patched.js'),trajectory.source);
  const evidence={archive,sha256:sha256(bytes),bytes:bytes.length,reproducible:true,verifiedUnpacked:unpacked,sourceByteEquality:true,trajectory:{member:'dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js',delivery:'external-generated-overlay-only',asarModified:false,beforeSha256:trajectory.beforeSha256,afterSha256:trajectory.afterSha256,replacements:5},files:Object.keys(contents).sort().map(name=>({name,sha256:sha256(contents[name]),bytes:Buffer.byteLength(contents[name])})),contract};
  fs.writeFileSync(path.join(output,'build-evidence.json'),JSON.stringify(evidence,null,2)+'\n');return evidence;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.argv[2]||!process.argv[3])throw Error('Explicit ready pointer and TPS output required');console.log(JSON.stringify(buildTps021(process.argv[2],process.argv[3]),null,2));}
