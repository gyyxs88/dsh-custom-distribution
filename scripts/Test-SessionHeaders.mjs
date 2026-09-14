import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Only a loopback mock is used; no saved settings, credentials or session data.
const root=resolve(process.argv[2] || '.');
const requireFromApp=createRequire(join(root,'package.json'));
const load=async name=>import(pathToFileURL(requireFromApp.resolve(name)));
const {Context}=await load('@deepseek-ai/cordis');
const {default:Llm}=await load('@deepseek-ai/dsh-llm');
const Pi=await import(pathToFileURL(process.argv[3] ? resolve(process.argv[3]) : requireFromApp.resolve('@deepseek-ai/dsh-llm-pi-ai')));
const received=[];
const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  received.push({headers:req.headers,path:req.url,body:JSON.parse(body)});
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({...data,type})}\n\n`);
  if(req.url.endsWith('/chat/completions')){
    for(const delta of [{role:'assistant',content:'OK'},{}])res.write(`data: ${JSON.stringify({id:'mock',object:'chat.completion.chunk',created:1,model:'mock-model',choices:[{index:0,delta,finish_reason:delta.content?null:'stop'}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  }else if(req.url.split('?')[0].endsWith('/messages')){
    event('message_start',{message:{id:'mock',type:'message',role:'assistant',model:'mock-model',content:[],usage:{input_tokens:1,output_tokens:0}}});
    event('content_block_start',{index:0,content_block:{type:'text',text:''}});
    event('content_block_delta',{index:0,delta:{type:'text_delta',text:'OK'}});
    event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});event('message_stop',{});res.end();
  }else{
    const item={id:'msg_mock',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]};
    event('response.created',{response:{id:'resp_mock',status:'in_progress',output:[]}});
    event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
    event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
    event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:'OK'});
    event('response.output_item.done',{output_index:0,item});
    event('response.completed',{response:{id:'resp_mock',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
  }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const baseURL=`http://127.0.0.1:${server.address().port}/v1`;
const old=process.env.DSH_OFFLINE_SESSION_HEADER_TEST_KEY;
process.env.DSH_OFFLINE_SESSION_HEADER_TEST_KEY='mock-not-a-real-key';
let checks=0;
try{
 for(const api of ['openai-completions','openai-responses','anthropic-messages']){
  const ctx=new Context();const runtime=ctx.plugin(Llm);await runtime;
  const headers={'X-OpenCode-Session':'stale-static-id','X-DeepSeek-Harness-Session-Id':'stale-native-id','X-Test-Preserved':'yes'};
  const config={providers:{'opencode-go':{api,baseURL,apiKeyEnv:'DSH_OFFLINE_SESSION_HEADER_TEST_KEY',headers,models:[{id:'mock-model',input:['text'],contextWindow:8192,maxTokens:32}]}}};
  const plugin=ctx.plugin(Pi,config);await plugin;
  try{
   const cases=[['session-fixture-a','agent'],['session-fixture-a','session-title'],['session-fixture-b','agent'],[undefined,'agent']];
   for(const [sessionId,purpose] of cases){
    const start=received.length;const chunks=[];
    for await(const c of ctx.llm.stream({provider:'opencode-go',model:'mock-model',sessionId,purpose,messages:[{role:'user',content:[{type:'text',text:'Return OK'}]}],maxTokens:16,signal:AbortSignal.timeout(10000)}))chunks.push(c);
    assert.equal(received.length,start+1,JSON.stringify(chunks));
    const req=received.at(-1);assert.equal(req.headers['x-opencode-session'],sessionId);assert.equal(req.headers['x-deepseek-harness-session-id'],sessionId);assert.equal(req.headers['x-test-preserved'],'yes');assert.match(req.headers['user-agent'],/deepseek|harness|dsh/i);
    assert.ok(chunks.some(c=>c.type==='finish'&&c.reason.kind!=='error'),JSON.stringify(chunks));checks++;
   }
   assert.equal(headers['X-OpenCode-Session'],'stale-static-id','shared config is immutable');
  }finally{await plugin.dispose();await runtime.dispose();}
 }
 // Other providers keep their own configured headers and receive native DSH identity.
 const ctx=new Context();const runtime=ctx.plugin(Llm);await runtime;
 const plugin=ctx.plugin(Pi,{providers:{fixture:{api:'openai-completions',baseURL,apiKeyEnv:'DSH_OFFLINE_SESSION_HEADER_TEST_KEY',headers:{'X-Test-Preserved':'yes'},models:[{id:'mock-model',input:['text']}]}}});await plugin;
 try{for await(const c of ctx.llm.stream({provider:'fixture',model:'mock-model',sessionId:'session-fixture-other',messages:[{role:'user',content:[{type:'text',text:'OK'}]}],signal:AbortSignal.timeout(10000)})){assert.notEqual(c.reason?.kind,'error',JSON.stringify(c));}
 assert.equal(received.at(-1).headers['x-opencode-session'],undefined);assert.equal(received.at(-1).headers['x-deepseek-harness-session-id'],'session-fixture-other');checks++;
 }finally{await plugin.dispose();await runtime.dispose();}
 console.log(`SESSION_HEADERS_ACCEPTANCE=PASSED requests=${checks} protocols=3 main_title_stability=true isolation=true static_collision=true`);
}finally{
 if(old===undefined)delete process.env.DSH_OFFLINE_SESSION_HEADER_TEST_KEY;else process.env.DSH_OFFLINE_SESSION_HEADER_TEST_KEY=old;
 server.closeAllConnections();await new Promise(r=>server.close(r));
}
