import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createServiceControlHandlers,isAuthorizedActionRequest} from '../sources/dsh-local-service-control/lib/index.js';
function request(origin='http://127.0.0.1:3080'){return {method:'POST',headers:{host:'127.0.0.1:3080',origin,'x-dsh-service-control':'1'},socket:{remoteAddress:'127.0.0.1'}};}
function response(){return {status:0,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body)}};}
test('service commands reject another origin and dispatch the exact PID only once',async()=>{
 assert.equal(isAuthorizedActionRequest(request()),true);assert.equal(isAuthorizedActionRequest(request('https://example.com')),false);
 const actions=[];const handlers=createServiceControlHandlers({pid:4242,dispatch:(action,pid)=>actions.push({action,pid})});
 const rejected=response();handlers.restart(request('https://example.com'),rejected);assert.equal(rejected.status,403);
 const accepted=response();handlers.restart(request(),accepted);assert.equal(accepted.status,202);
 const duplicate=response();handlers.restart(request(),duplicate);assert.equal(duplicate.status,409);
 await new Promise(r=>setImmediate(r));assert.deepEqual(actions,[{action:'restart',pid:4242}]);
});
test('session ID menu sends the stable ID to clipboard and reports failure without other actions',async()=>{
 const code=fs.readFileSync(new URL('../sources/dsh-client-ui-workspace-copy-session-id/lib/client.js',import.meta.url),'utf8');
 const start=code.indexOf('if (id === "copy-session-id") {'),end=code.indexOf('if (id === "rename")',start);
 assert.ok(start>0&&end>start);const branch=code.slice(start,end);let copied,status;
 const fn=Function('id','copyEpoch','setCopyStatus','_deepseek_ai_dsh_client_ui_primitives','node',branch);
 fn('copy-session-id',{current:0},v=>status=v,{writeClipboard:async value=>{copied=value;return true;}},{id:'session-stable',title:'variable title'});
 await new Promise(r=>setImmediate(r));assert.equal(copied,'session-stable');assert.equal(status,'copied');
 fn('copy-session-id',{current:0},v=>status=v,{writeClipboard:async()=>false},{id:'session-stable'});
 await new Promise(r=>setImmediate(r));assert.equal(status,'failed');
});
test('restart waits for the authenticated HTML page after a new PID appears',async()=>{
 const code=fs.readFileSync(new URL('../sources/dsh-local-service-control/lib/client.js',import.meta.url),'utf8');
 const start=code.indexOf('async function waitForRestart('),end=code.indexOf('async function waitForShutdown(',start);
 let reloads=0,requests=0;
 const restart=Function('wait','readStatus','fetch','window',code.slice(start,end)+';return waitForRestart;')(
  async()=>{},async()=>({pid:2}),async()=>({ok:++requests>1,headers:{get:()=> 'text/html'}}),{location:{reload(){reloads++}}});
 await restart(1);assert.equal(requests,2);assert.equal(reloads,1);
});
