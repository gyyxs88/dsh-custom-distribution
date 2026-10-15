import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateAssistantEvent, estimateStreamMetadata, receiptMetadata, foldStreamEvent, initialStreamState,
  streamStateView, formatStreamEstimate } from '../lib/stream-estimate.js';

function event(rate=100,seq=1,model='A',offset=0) {
  const texts=Array(11).fill('a'.repeat(100));
  return {type:'assistant/message',seq,time:offset+10000,data:{turn:1,step:seq,usage:{outputTokens:11*rate},
    stream:[{type:'text-chunks',index:0,time0:offset,dt:Array(10).fill(1000),texts}],
    message:{source:{provider:'fixture-provider',model},content:[{type:'text',text:texts.join('')}]}}};
}
test('usage calibration subtracts first batch and preserves fractional counts',()=>{
  const e=event(); const r=estimateAssistantEvent(e);
  assert.equal(r.tokens,1000);assert.equal(r.milliseconds,10000);assert.equal(r.tps,100);
  e.data.usage.outputTokens=17;assert(Math.abs(estimateAssistantEvent(e).tokens-170/11)<1e-12);
  assert.deepEqual(formatStreamEstimate(r),{label:'输出速度（估算）',value:'100.0 tok/s'});
});
test('only final attempt stream, not retry/first-token/completion tail, controls TPS',()=>{
  const e=event(100,1,'A',20000);e.time=9999999;
  e.data.stream.push({type:'chunk',time:e.time,chunk:{type:'usage',usage:e.data.usage}});
  let s=foldStreamEvent(initialStreamState(),{type:'assistant/attempt',seq:0,data:{stream:[{type:'text-chunks',time0:0,index:0,dt:[],texts:['old retry']}]}});
  s=foldStreamEvent(s,e);assert.equal(streamStateView(s).estimate.tps,100);
  assert.equal(estimateAssistantEvent(e).firstTime,20000);
});
test('tool name-only is not a receipt; original raw arguments and all content channels count',()=>{
  const e=event(),args=JSON.stringify('a'.repeat(108));
  const parts=Array.from({length:11},(_,i)=>args.slice(i*10,(i+1)*10));
  e.data.stream=[{type:'chunk',time:0,chunk:{type:'tool-call-delta',index:0,id:'fixture-call',name:'get',argumentsDelta:''}},
    {type:'tool-call-chunks',index:0,id:'fixture-call',time0:5000,dt:Array(10).fill(1000),args:parts}];
  e.data.message.content=[{type:'tool-call',name:'get',arguments:args}];
  const r=estimateAssistantEvent(e);assert.equal(r.firstTime,5000);assert.equal(r.units,110);assert.equal(r.tps,100);
});
test('surrogate pairs split across deltas count once, at completion; empty dt still advances',()=>{
  const stream=[{type:'text-chunks',index:0,time0:0,dt:[1000,1000,1000,1000,1000],texts:['\ud83d','\ude00','A','','B','C']}];
  const m=receiptMetadata(stream,[{type:'text',text:'😀ABC'}]);
  assert.equal(m.units,4);assert.equal(m.receipts[0].time,1000);assert.equal(m.receipts.at(-1).time,5000);
});
test('same timestamp batches are coalesced before first allocation',()=>{
  const stream=[{type:'text-chunks',index:0,time0:0,dt:[0,1000,1000,1000,1000],texts:['abc','de','x','x','x','x']}];
  const m=receiptMetadata(stream);const r=estimateStreamMetadata({provider:'p',model:'m',attemptId:'x',status:'completed',usage:{outputTokens:9},...m});
  assert.equal(r.firstUnits,5);assert.equal(r.tokens,4);
});
test('single frame, fewer than 4 batches, short windows and both burst ratios reject',()=>{
  for(const receipts of [[{time:0,units:386}], [0,1000,2000].map(time=>({time,units:100})),
    [0,1,2,3].map(time=>({time,units:100})), [[0,790],[50,50],[500,100],[1000,50],[1500,10]].map(([time,units])=>({time,units})),
    [[0,1],[1000,1],[1001,900],[1002,1]].map(([time,units])=>({time,units}))]) {
    const r=estimateStreamMetadata({provider:'p',model:'m',attemptId:'x',status:'completed',usage:{outputTokens:1000},receipts});
    assert.equal(r.tps,null);assert.equal(formatStreamEstimate(r).value,'暂无法计算');
  }
});
test('missing usage, cancelled, missing route, malformed/negative packed times never fall back',()=>{
  for(const mutate of [e=>delete e.data.usage,e=>{e.data.interrupted=true},e=>delete e.data.message.source.model,
    e=>{e.data.stream[0].dt[0]=-1},e=>{e.data.stream[0].dt=[]}]) {
    const e=event();mutate(e);assert.equal(estimateAssistantEvent(e).tps,null);
  }
});
test('mixed streams cover reasoning, text and argument deltas; final snapshots cannot add tokens',()=>{
  const e=event();e.data.stream=[{type:'reasoning-chunks',index:0,time0:0,dt:[1000,1000,1000],texts:['r','r','r','r']},
    {type:'text-chunks',index:1,time0:4000,dt:[1000,1000,1000],texts:['t','t','t','t']}];
  e.data.message.content=[{type:'reasoning',text:'rrrr'},{type:'text',text:'tttt'}];
  assert.equal(estimateAssistantEvent(e).units,8);
  e.data.message.content[1].text+='unobserved';assert.equal(estimateAssistantEvent(e).tps,null);
});
test('A→B→A restores full A weighted average; invalid A and running step preserve measured mean',()=>{
  let s=initialStreamState();for(const e of [event(100,1,'A'),event(200,2,'B',20000),event(300,3,'A',40000)])s=foldStreamEvent(s,e);
  assert.equal(streamStateView(s).estimate.tps,200);assert.equal(streamStateView(s).eligible,2);
  const bad=event(999,4,'A',60000);delete bad.data.usage;s=foldStreamEvent(s,bad);
  assert.equal(streamStateView(s).estimate.tps,200);assert.equal(streamStateView(s).rejected,1);
  s=foldStreamEvent(s,{type:'step/start',data:{turn:2,step:1}});assert.equal(streamStateView(s).estimate.tps,200);
  const unknown=event();delete unknown.data.message.source.model;s=foldStreamEvent(s,unknown);assert.equal(streamStateView(s).estimate.tps,null);
});
test('JSON error reasons never contain original tool argument fragments',()=>{
  const e=event(),raw='{"secret-fixture":UNTRUSTED_INVALID_VALUE}';
  const parts=Array.from({length:5},(_,i)=>raw.slice(i*10,(i+1)*10));
  e.data.stream=[{type:'tool-call-chunks',time0:0,index:0,id:'fixture',name:'get',dt:[1000,1000,1000,1000],args:parts}];
  e.data.message.content=[{type:'tool-call',name:'get',arguments:{}}];
  const r=estimateAssistantEvent(e);assert.equal(r.reason,'invalid-stream-content');assert.doesNotMatch(JSON.stringify(r),/secret-fixture|UNTRUSTED/);
});
test('history reload preserves group state and no raw content is retained by projection',()=>{
  const s=foldStreamEvent(initialStreamState(),event());const reloaded=JSON.parse(JSON.stringify(s));
  assert.deepEqual(streamStateView(reloaded),streamStateView(s));
  assert.doesNotMatch(JSON.stringify(s),/aaa|stream|content/);
});
