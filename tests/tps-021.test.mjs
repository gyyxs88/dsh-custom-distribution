import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { sha256, readTpsPacked, readTpsArchive } from '../scripts/Tps-Official.mjs';
import { patchTrajectory021 } from '../scripts/Tps-Patch021.mjs';
import { estimateAssistantEvent, foldStreamEvent, initialStreamState, streamStateView, formatStreamEstimate } from '../sources/dsh-tps-correction/lib/stream-estimate.js';

if(!process.argv[2]||!process.argv[3]) {
  await test('TPS exact candidate replay requires Test-Tps021.mjs', {skip:true},()=>{});
} else {
const ready=JSON.parse(fs.readFileSync(process.argv[2])),out=process.argv[3];
const builtPackage=path.resolve(process.argv[4] ?? path.join(out,'../build/verified-package'));
const base=ready.archive.replaceAll('\\','/')+'/dsh/node_modules/';
const officialRequire=createRequire(base+'@deepseek-ai/dsh/package.json');
const redirects=new Map(['zod',...['cordis','dsh-client-modules','dsh-client-ui-chat','dsh-client-ui-trajectory'].flatMap(pkg=>['@deepseek-ai/'+pkg,'@deepseek-ai/'+pkg+'/package.json'])].map(spec=>[spec,officialRequire.resolve(spec)]));
registerHooks({resolve(specifier,context,next){
  if(redirects.has(specifier))return next(context.conditions.includes('require')?redirects.get(specifier):pathToFileURL(redirects.get(specifier)).href,context);
  return next(specifier,context);
}});
const officialStats=await import(pathToFileURL(base+'@deepseek-ai/dsh-session-stats/lib/index.js'));
const llm=await import(pathToFileURL(base+'@deepseek-ai/dsh-llm/lib/index.js'));
let definition;officialStats.apply({sessionProjections:{register:d=>{definition=d;}}});
const original=readTpsPacked(ready.archive,'dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js').toString();
const patched=patchTrajectory021(original);
const evidence={version:ready.version,archiveSha256:sha256(readTpsArchive(ready.archive)),electronVersion:process.versions.electron,nodeVersion:process.versions.node,statsModuleSha256:sha256(readTpsPacked(ready.archive,'dsh/node_modules/@deepseek-ai/dsh-session-stats/lib/index.js')),cases:[],productionWrites:0,providerCalls:0,asarModified:false};
assert.equal(evidence.archiveSha256,ready.sha256.archive);
function make({offset=1000,tail=0,step=1,rate=100,model='A',channel='text',parts=Array(11).fill('a'.repeat(100))}={}){
  const acc=new llm.AssistantStreamAccumulator();
  for(const [i,text]of parts.entries())acc.push({time:offset+i*1000,chunk:{type:channel+'-delta',index:0,text}});
  const end=offset+(parts.length-1)*1000;
  const usage={inputTokens:20,outputTokens:parts.length*rate};
  acc.push({time:end+tail,chunk:{type:'usage',usage}});
  acc.push({time:end+tail,chunk:{type:'finish',reason:'stop'}});
  const message={id:'fixture-'+step,source:{provider:'fixture',model},content:[{type:channel,text:parts.join('')}]};
  return {type:'assistant/message',seq:step*10+1,time:end+tail,data:{turn:1,step,stream:acc.snapshot(),usage,message}};
}
function timeline(message,{start=0,attempt}={}){
  const row=[{type:'step/start',seq:message.seq-3,time:start,data:{turn:1,step:message.data.step}}];
  if(attempt)row.push(attempt,{type:'llm/retry',time:attempt.time+1,seq:message.seq-1,data:{turn:1,step:message.data.step,retry:1,mode:'normal',maxRetries:3,delayMs:10000,failure:{message:'synthetic retry'}}});
  row.push(message,{type:'step/end',seq:message.seq+1,time:message.time,data:{turn:1,step:message.data.step}});return row;
}
function replay(events){let s=definition.init(),c=initialStreamState();for(const e of events){s=definition.apply(s,e);c=foldStreamEvent(c,e);}return {official:definition.wire.view(s),corrected:streamStateView(c),state:c};}
function record(name,events){const r=replay(events);const metric=r.corrected.estimate;evidence.cases.push({name,officialTps:r.official.decodeMs>0?r.official.decodeTokens*1000/r.official.decodeMs:null,estimatedTps:metric.tps,reason:metric.reason,officialDecodeMs:r.official.decodeMs,estimatedMs:metric.milliseconds??null});return r;}

await test('real candidate accumulator, projection and final usage replay normal and chunk aggregation',()=>{
  const event=make();assert.equal(llm.expandAssistantStream(event.data.stream).length,13);
  const r=record('normal-packed-stream',timeline(event));assert.equal(r.official.decodeTokens,1100);assert.equal(r.official.decodeMs,10000);assert.equal(r.corrected.estimate.tps,100);
  const raw=structuredClone(event);raw.data.stream=llm.expandAssistantStream(raw.data.stream).map(x=>({type:'chunk',...x}));assert.equal(estimateAssistantEvent(raw).tps,100);
  const variable=make({parts:['a'.repeat(550),...Array(10).fill('b'.repeat(55))]});assert.equal(estimateAssistantEvent(variable).tps,55);record('unequal-chunk-size',timeline(variable));
});
await test('TTFT and idle/usage tail do not contaminate the corrected receive interval',()=>{
  const late=record('long-ttft',timeline(make({offset:51000})));assert.equal(late.official.ttftMs,51000);assert.equal(late.corrected.estimate.tps,100);
  const tail=record('usage-final-idle-tail-10s',timeline(make({tail:10000})));assert.equal(tail.official.decodeMs,20000);assert.equal(tail.official.decodeTokens*1000/tail.official.decodeMs,55);assert.equal(tail.corrected.estimate.tps,100);
});
await test('retry original candidate keeps first attempt timestamp; correction pairs only final attempt',()=>{
  const final=make({offset:21000});const attempt={type:'assistant/attempt',seq:2,time:2000,data:{turn:1,step:1,stream:[{type:'text-chunks',index:0,time0:1000,dt:[],texts:['failed']}],usage:{inputTokens:0,outputTokens:90}}};
  const r=record('retry-then-success',timeline(final,{attempt}));assert.equal(r.official.decodeMs,30000);assert.equal(r.corrected.estimate.tps,100);assert.equal(r.corrected.eligible,1);
});
await test('multi-step whole history pairs receive tokens and time; unrelated tool/idle time excluded',()=>{
  const first=make(),second=make({offset:71000,rate:200,step:2});
  const events=[...timeline(first),{type:'tool/call',seq:15,time:12000,data:{callId:'synthetic'}},{type:'tool/result',seq:16,time:61000,data:{message:{source:{callId:'synthetic'}}}},...timeline(second,{start:61000})];
  const r=record('multi-step-tool-idle',events);assert.equal(r.corrected.estimate.tps,150);assert.equal(r.corrected.eligible,2);assert.equal(r.official.toolMs,49000);
});
await test('single burst, missing/zero/final-only usage, cancellation and hidden reasoning use unavailable semantics',()=>{
  for(const [name,change] of [
    ['single-batch',e=>{e.data.stream=[{type:'text-chunks',index:0,time0:1000,dt:[],texts:['a'.repeat(1100)]}];}],
    ['missing-usage',e=>{delete e.data.usage;}],['zero-output',e=>{e.data.usage.outputTokens=0;}],['cancelled',e=>{e.data.interrupted=true;}],['unobserved-reasoning',e=>{e.data.usage.reasoningTokens=100;}],['unobserved-final-content',e=>{e.data.message.content[0].text+='extra';}]
  ]){const e=structuredClone(make());change(e);const reading=estimateAssistantEvent(e);assert.equal(reading.status,'unavailable',name);assert.equal(formatStreamEstimate(reading).value,'暂无法计算');record(name,timeline(e));}
  const finalOnly=structuredClone(make());finalOnly.data.stream=finalOnly.data.stream.filter(r=>r.chunk?.type!=='usage');assert.equal(estimateAssistantEvent(finalOnly).tps,100);record('usage-only-on-final-event',timeline(finalOnly));
});
await test('official packed mixed text/reasoning/tool arguments and Unicode/empty-delta clocks',()=>{
  const event=structuredClone(make()),acc=new llm.AssistantStreamAccumulator();
  const args='{"q":"'+ 'z'.repeat(102)+'"}';
  const parts=Array.from({length:11},(_,i)=>args.slice(i*10,(i+1)*10));
  // Tool name is metadata; the following actual argument stream defines receipt timing.
  acc.push({time:0,chunk:{type:'tool-call-delta',index:0,id:'test-tool',name:'lookup',argumentsDelta:''}});
  for(const [i,argumentsDelta]of parts.entries())acc.push({time:1000+i*1000,chunk:{type:'tool-call-delta',index:0,id:'test-tool',argumentsDelta}});
  event.data.stream=acc.snapshot();event.data.message.content=[{type:'tool-call',id:'test-tool',name:'lookup',arguments:JSON.parse(args)}];
  assert.equal(args.length,110);assert.equal(estimateAssistantEvent(event).tps,100);record('tool-name-only-plus-arguments',timeline(event));
  const unicode=make({parts:['\ud83d','\ude00','A','','B','C','D','E','F','G','H'],rate:10});assert.equal(estimateAssistantEvent(unicode).firstTime,2000);assert.equal(llm.expandAssistantStream(unicode.data.stream)[4].time,5000);record('unicode-empty-chunk-time',timeline(unicode));
  const mixed=structuredClone(make());const frames=[];const content=[];for(let b=0;b<2;b++){const type=b?'text':'reasoning';content.push({type,text:'x'.repeat(550)});for(let i=0;i<11;i++)frames.push({time:1000+i*1000,chunk:{type:type+'-delta',index:b,text:'x'.repeat(50)}});}frames.sort((a,b)=>a.time-b.time);const mixAcc=new llm.AssistantStreamAccumulator();for(const f of frames)mixAcc.push(f);mixed.data.stream=mixAcc.snapshot();mixed.data.message.content=content;assert.equal(estimateAssistantEvent(mixed).tps,100);record('mixed-text-reasoning',timeline(mixed));
});
await test('route A B A, reload/pagination and schema do not mix output or store content',async()=>{
  const a=make(),b=make({model:'B',rate:300,step:2}),a2=make({rate:200,step:3});const events=[...timeline(a),...timeline(b),...timeline(a2)];
  const r=record('route-A-B-A',events);assert.equal(r.corrected.estimate.tps,150);assert.equal(r.corrected.eligible,2);assert.deepEqual(streamStateView(JSON.parse(JSON.stringify(r.state))),r.corrected);
  assert.doesNotMatch(JSON.stringify(r.state),/aaaa|stream|content/);
  const plugin=await import(pathToFileURL(path.join(builtPackage,'index.js')));let registered;plugin.apply({sessionProjections:{register:d=>{registered=d;}}});assert.equal(registered.key,'tpsCorrectionV2');registered.stateSchema.parse(r.state);registered.wire.viewSchema.parse(r.corrected);
});

// Actual shipped client factory functions, with rendering dependencies stubbed.
// This is a component/contract replay, not a browser layout acceptance.
const jsx=(type,props)=>({type,props});
const react={memo:fn=>fn,useMemo:fn=>fn(),useState:initial=>[initial,()=>{}],useRef:()=>({current:null}),useEffect:()=>{},useCallback:fn=>fn,forwardRef:fn=>fn,createContext:()=>({}),useSyncExternalStore:(_subscribe,get)=>get()};
const fallback=new Proxy(()=>null,{get:()=>fallback});
function loadFactory(source,expose=''){
 let registration;const sandbox={window:{__ModuleLoader__:{load:r=>{registration=r;}}},console,TextEncoder,TextDecoder,URL,Map,Set,WeakMap,Symbol,Date,Number,Array,JSON,Object};
 if(expose)source=source.replace('\t\treturn module.exports;',`\t\texports.__test={${expose}};\n\t\treturn module.exports;`);
 vm.runInNewContext(source,sandbox);
 return registration.factory(spec=>spec==='react'?react:spec==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:spec==='react-dom'?{createPortal:node=>node}:fallback);
}
function expand(node){if(node==null||node===false)return null;if(Array.isArray(node))return node.map(expand);if(typeof node!=='object')return node;if(typeof node.type==='function')return expand(node.type(node.props));return {type:node.type,props:{...node.props,children:expand(node.props?.children)}};}
function texts(node){if(node==null||node===false)return '';if(Array.isArray(node))return node.map(texts).join(' ');if(typeof node!=='object')return String(node);return texts(node.props?.children);}
await test('generated public activity replaces only activity; detailed, compact and missing show one speed',()=>{
 const client=loadFactory(fs.readFileSync(path.join(builtPackage,'client.js'),'utf8'));
 const rows=[];client.apply({configForms:{get:()=>({getSnapshot:()=>({value:{performanceUsage:'detailed'}}),subscribe:()=>()=>{}})},slots:{inject:(_slot,fn)=>fn(),register:(opts,component)=>{rows.push({opts,component});}}});
 assert.equal(rows.length,1);assert.equal(rows[0].opts.id,'activity');assert.equal(rows[0].opts.priority,-100);
 const stats=replay(timeline(make()));const t=(key,args)=>key==='stats.counts'?`${args.turns}轮 ${args.steps}步`:key;
 for(const mode of ['detailed','compact'])for(const available of [true,false]){
   const tree=expand(rows[0].component({usePerformanceUsage:fn=>fn(mode),useChat:fn=>fn({legacy:{nodes:[]}}),useProjection:key=>key==='sessionStats'?stats.official:available?stats.corrected:undefined,t}));
   const text=texts(tree);assert.equal((text.match(/tok\/s/g)??[]).length,available?1:0);assert.match(text,/输出速度（估算）/);assert.match(text,available?/100.0 tok\/s/:/暂无法计算/);
 }
 evidence.activity={publicSlot:'activity',untouchedUsage:true,modes:['detailed','compact'],speedReadingsPerPill:1};
});
await test('real original and transformed trajectory functions preserve timing while replacing its sole speed',()=>{
 const old=loadFactory(original,'finalNode,throughput,trajectoryAssistantDefinition,deriveTrajectoryLayout');
 const next=loadFactory(patched.source,'finalNode,throughput,trajectoryAssistantDefinition,deriveTrajectoryLayout');
 const event=make({tail:10000}),state={turn:1,step:1,started:true,startTime:0,firstTokenTime:1000,final:{event}};
 const before=old.__test.finalNode(state,{}),after=next.__test.finalNode(state,{});
 assert.equal(after.timing.completedTime,before.timing.completedTime);assert.equal(after.tpsReceipt021.tps,100);
 const metrics={timingRecorded:true,stepStartTime:0,firstTokenTime:1000,completedTime:event.time,usageProvided:true,outputTokens:1100,tpsReceipt021:after.tpsReceipt021};
 assert.equal(old.__test.throughput(metrics,(_key,args)=>args.value),'55.0');assert.equal(next.__test.throughput(metrics,()=>{}),'100.0 tok/s');assert.equal(next.__test.throughput({},()=>{}),'暂无法计算');
 assert.equal((patched.source.match(/children: "输出速度（估算）"/g)??[]).length,1);
 // Exact hash gate refuses unknown versions, accidental mutation and repeated patching.
 assert.throws(()=>patchTrajectory021(original+'\n'),/MISMATCH/);assert.throws(()=>patchTrajectory021(patched.source),/MISMATCH/);
 const withoutSpeed={...after};delete withoutSpeed.tpsReceipt021;assert.deepEqual(JSON.parse(JSON.stringify(withoutSpeed)),JSON.parse(JSON.stringify(before)));
 const layoutInput={nodes:[after],partial:null,runningCalls:[]};
 const layout=next.__test.deriveTrajectoryLayout(layoutInput,(_key,values)=>JSON.stringify(values??{}));
 const cell=layout.flatMap(turn=>turn.groups.flatMap(group=>group.cells)).find(cell=>cell.kind==='message');
 assert.ok(cell);assert.equal(cell.assistantMetrics.tpsReceipt021.tps,100);assert.equal(cell.output,1100);
 const oldLayout=old.__test.deriveTrajectoryLayout({...layoutInput,nodes:[before]},(_key,values)=>JSON.stringify(values??{}));
 const cleanLayout=JSON.parse(JSON.stringify(layout));for(const turn of cleanLayout)for(const group of turn.groups)for(const cell of group.cells)if(cell.assistantMetrics)delete cell.assistantMetrics.tpsReceipt021;
 assert.deepEqual(cleanLayout,JSON.parse(JSON.stringify(oldLayout)));
 evidence.trajectory={originalSpeed:'55.0',patchedSpeed:'100.0 tok/s',fallback:'暂无法计算',beforeSha256:patched.beforeSha256,afterSha256:patched.afterSha256,modifiedAnchors:5,unchangedNodeFields:true};
});

await test('real official bundle composition and client-module service select one external factory; withdrawal and restart restore original',async()=>{
 const {Context}=await import(pathToFileURL(base+'@deepseek-ai/cordis/lib/index.js'));
 const {ClientModuleRegistry}=await import(pathToFileURL(base+'@deepseek-ai/dsh-client-modules/lib/index.js'));
 const {composeEntries}=await import(pathToFileURL(base+'@deepseek-ai/dsh-app-boot/lib/index.js'));
 const yaml=officialRequire('js-yaml');
 const packageRoot=builtPackage;
 const patches=yaml.load(fs.readFileSync(path.join(packageRoot,'cordis.patch.yml'),'utf8'));
 const composed=composeEntries([[{insert:[{id:'ui-trajectory',name:'@deepseek-ai/dsh-client-ui-trajectory'}]}],patches]);
 assert.equal(composed.find(x=>x.id==='ui-trajectory').disabled,true);
 assert.equal(composed.filter(x=>!x.disabled).length,2);
 const overlay=JSON.parse(fs.readFileSync(path.join(packageRoot,'overlay/package.json')));
 const originalManifest=officialRequire('@deepseek-ai/dsh-client-ui-trajectory/package.json');
 assert.deepEqual(overlay.dsh.client,originalManifest.dsh.client);
 assert.match(overlay.description,/custom TPS supplement/);
 assert.equal(sha256(fs.readFileSync(path.join(packageRoot,'overlay/index.js'))),sha256(readTpsPacked(ready.archive,'dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/index.js')));
 function entry(name,baseUrl,disabled=false){return {options:{name},disabled,fiber:{},parent:{tree:{ctx:{baseUrl}}}};}
 const officialBase=pathToFileURL(base+'@deepseek-ai/dsh/package.json').href;
 const externalBase=pathToFileURL(packageRoot+path.sep).href;
 let entries=[entry('@deepseek-ai/dsh-client-modules',officialBase),entry('@deepseek-ai/dsh-client-ui-chat',officialBase),...composed.map(row=>entry(row.name,row.name.startsWith('.')?externalBase:officialBase,row.disabled??false))];
 const ctx=new Context();ctx.provide('loader',{entries:()=>entries});
 try{
  const fiber=await ctx.plugin(ClientModuleRegistry);const service=ctx.get('clientModules');assert.ok(service);
  const graph=service.graph();const rows=graph.entries.filter(e=>e.id===overlay.name);assert.equal(rows.length,1);
  assert.equal(path.resolve(service.clientPath(overlay.name)),path.join(packageRoot,'overlay/client.js'));
  const batch=graph.batches.find(batch=>batch.entries.includes(overlay.name));assert.ok(batch);
  const response=await service.fetchBundle(new Request('http://127.0.0.1/'+batch.url));assert.equal(response.status,200);
  const served=await response.text();assert.equal((served.match(/id: "@deepseek-ai\/dsh-client-ui-trajectory"/g)??[]).length,1);assert.match(served,/TPS021/);
  // Simulate actual Loader mount/unmount notifications against the real service.
  // No private table or method is called. Lifecycle restart is separately checked below.
  entries=[entry('@deepseek-ai/dsh-client-modules',officialBase),entry('@deepseek-ai/dsh-client-ui-chat',officialBase),entry('@deepseek-ai/dsh-client-ui-trajectory',officialBase)];
  for(const name of ['./index.js','./overlay/index.js','@deepseek-ai/dsh-client-ui-trajectory'])ctx.emit('internal/plugin',{entry:{options:{name}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(service.clientPath(overlay.name).replaceAll('\\','/'),base+'@deepseek-ai/dsh-client-ui-trajectory/lib/client.js');
  const restoredBatch=service.graph().batches.find(batch=>batch.entries.includes(overlay.name));const restored=await service.fetchBundle(new Request('http://127.0.0.1/'+restoredBatch.url));const restoredText=await restored.text();assert.doesNotMatch(restoredText,/TPS021/);assert.match(restoredText,/metrics.outputTokens \/ generationSeconds/);
  await fiber.dispose();await ctx.plugin(ClientModuleRegistry);assert.equal(ctx.get('clientModules').clientPath(overlay.name).replaceAll('\\','/'),base+'@deepseek-ai/dsh-client-ui-trajectory/lib/client.js');
  evidence.delivery={asarModified:false,publicComposition:true,officialHostNoopIdentical:true,dependencyMetadataIdentical:true,activeCanonicalFactories:1,externalPath:path.join(packageRoot,'overlay/client.js'),withdrawalSourceRestored:true,notificationRecompose:true,serviceRestartRestored:true,fullDesktopHmrNotExercised:true};
 }finally{await ctx.fiber.dispose();}
 assert.equal(sha256(readTpsArchive(ready.archive)),ready.sha256.archive);
});

await test('actual official Loader activates external bundle, unloads it and boots the original source after withdrawal',async()=>{
 const appBoot=await import(pathToFileURL(base+'@deepseek-ai/dsh-app-boot/lib/index.js'));
 const rootFile=path.join(out,'loader-root.yml');
 const packageRoot=builtPackage;
 fs.writeFileSync(rootFile,'- id: client-modules\n  name: "@deepseek-ai/dsh-client-modules"\n- id: ui-chat\n  name: "@deepseek-ai/dsh-client-ui-chat"\n- id: ui-trajectory\n  name: "@deepseek-ai/dsh-client-ui-trajectory"\n');
 const patches=appBoot.loadOverlayPatches('tps-test',path.join(packageRoot,'cordis.patch.yml'));
 const prepare=ctx=>{ctx.provide('sessionProjections',{register:()=>()=>{}});};
 const bare=pathToFileURL(base+'@deepseek-ai/dsh/package.json').href;
 let ctx;
 try{
  ctx=await appBoot.boot('tps-test',rootFile,patches,prepare,bare);
  assert.equal(path.resolve(ctx.clientModules.clientPath('@deepseek-ai/dsh-client-ui-trajectory')),path.join(packageRoot,'overlay/client.js'));
  const include=ctx.loader.resolve('include');assert.ok(include);
  await include.update({config:{path:pathToFileURL(rootFile).href,patches:[]}});await ctx.loader.await();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ctx.clientModules.clientPath('@deepseek-ai/dsh-client-ui-trajectory').replaceAll('\\','/'),base+'@deepseek-ai/dsh-client-ui-trajectory/lib/client.js');
  assert.equal(ctx.clientModules.graph().entries.filter(x=>x.id==='dsh-tps-correction').length,0);
  await ctx.fiber.dispose();ctx=await appBoot.boot('tps-test',rootFile,[],prepare,bare);
  assert.equal(ctx.clientModules.clientPath('@deepseek-ai/dsh-client-ui-trajectory').replaceAll('\\','/'),base+'@deepseek-ai/dsh-client-ui-trajectory/lib/client.js');
  evidence.actualLoader={activation:true,withdrawal:true,restartOriginal:true,fullHost:false,configReads:'synthetic root and generated bundle only',providerCalls:0};
 }finally{await ctx?.fiber.dispose();}
 assert.equal(sha256(readTpsArchive(ready.archive)),ready.sha256.archive);
});

fs.writeFileSync(path.join(out,'candidate-replay-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
