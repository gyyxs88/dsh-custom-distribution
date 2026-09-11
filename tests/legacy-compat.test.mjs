import test from 'node:test';import assert from 'node:assert/strict';
import {assertReleasedEventPayload} from '../sources/dsh-session-format-v0-to-v1/lib/index.js';
const message=source=>({seq:0,type:'user/message',data:{id:'test-message',role:'user',content:[{type:'text',text:'unchanged text'}],source}});
test('known local provenance is admitted without changing content or source',()=>{
 const e=message({kind:'plugin',plugin:'dsh-session-control',form:'relay',provenanceVersion:1,senderSessionId:'source',targetSessionId:'target',operationId:'operation'});
 const before=JSON.stringify(e);assertReleasedEventPayload(e,0);assert.equal(JSON.stringify(e),before);
});
test('unknown local source properties and forged versions still fail closed',()=>{
 const s={kind:'plugin',plugin:'dsh-session-control',form:'relay'};
 assert.throws(()=>assertReleasedEventPayload(message({...s,unknownAuthority:true}),0),/unexpected member/);
 assert.throws(()=>assertReleasedEventPayload(message({...s,provenanceVersion:2}),0));
 assert.throws(()=>assertReleasedEventPayload(message({...s,plugin:'unrecognized-plugin',senderSessionId:'x'}),0),/unexpected member/);
});
test('descriptor v2 is admitted only with its exact old schema',()=>{
 const e={seq:0,type:'subagent/descriptor',data:{version:2,mode:'continuable',provider:'spawn',label:'old child',agentProvider:'mock',agentModel:'mock'}};
 assertReleasedEventPayload(e,0);
 assert.throws(()=>assertReleasedEventPayload({...e,data:{...e.data,agentReasoningEffort:'high'}},0),/unexpected member/);
});
