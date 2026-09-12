import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const appRoot=path.resolve(process.argv[2] ?? '.');
const load=name=>import(pathToFileURL(path.join(appRoot,'node_modules','@deepseek-ai',name,'lib/index.js')));
const {WorkspaceFileSearch,formatFileMention,DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES}=await load('dsh-file-reference-local');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-official-first-'));
// Retain the small synthetic fixture for inspection; never erase user data.
fs.mkdirSync(path.join(fixture,'docs'));
fs.mkdirSync(path.join(fixture,'node_modules'));
fs.writeFileSync(path.join(fixture,'docs','with spaces.md'),'fixture');
fs.writeFileSync(path.join(fixture,'node_modules','excluded.md'),'excluded');
const search=new WorkspaceFileSearch(fixture,{maxResults:20,maxEntries:100,excludedDirectories:DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES});
try {
  const result=await search.list('docs/',new AbortController().signal);
  assert.match(JSON.stringify(result),/with spaces\.md/u);
  assert.equal(formatFileMention({path:'docs/with spaces.md',kind:'file'},false),'@"docs/with spaces.md"');
  const excluded=await search.list('excluded',new AbortController().signal);
  assert.equal(excluded.length,0);
} finally {search.dispose();}

const {installProxyFromEnvironment,proxyRouteFor,proxyEnvironmentForChild}=await load('dsh-http-proxy');
const direct=http.createServer((_req,res)=>res.end('direct'));
let tunnels=0;
const proxy=http.createServer((req,res)=>{
  assert.equal(req.url,'http://official-first.invalid/');
  tunnels++;
  res.end('proxied');
});
const sockets=new Set();
proxy.on('connect',(req,socket)=>{
  tunnels++;
  assert.equal(req.url,'official-first.invalid:80');
  sockets.add(socket);
  socket.on('error',()=>{});
  socket.on('close',()=>sockets.delete(socket));
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  socket.once('data',()=>socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied'));
});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await listen(direct);await listen(proxy);
const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','NODE_USE_ENV_PROXY'];
const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const values={HTTP_PROXY:`http://127.0.0.1:${proxy.address().port}`,NO_PROXY:'user-specified.invalid'};
let dispose;
try {
  dispose=await installProxyFromEnvironment({get:key=>values[key]===undefined?undefined:{value:values[key]}},message=>{throw Error(message);});
  assert.equal(proxyRouteFor(new URL('http://official-first.invalid/')).proxied,true);
  assert.equal(await (await fetch('http://official-first.invalid/',{signal:AbortSignal.timeout(5000)})).text(),'proxied');
  assert.equal(tunnels,1);
  const local=`http://127.0.0.1:${direct.address().port}/`;
  assert.equal(proxyRouteFor(new URL(local)).proxied,false);
  assert.equal(await (await fetch(local,{signal:AbortSignal.timeout(5000)})).text(),'direct');
  assert.equal(tunnels,1,'loopback must bypass proxy');
  const child=proxyEnvironmentForChild();
  assert.match(child.NO_PROXY ?? child.no_proxy,/user-specified\.invalid/u);
  assert.match(child.NO_PROXY ?? child.no_proxy,/127\.0\.0\.1/u);
} finally {
  if(dispose)await dispose();
  for(const socket of sockets)socket.destroy();
  direct.closeAllConnections();proxy.closeAllConnections();
  await Promise.all([new Promise(resolve=>direct.close(resolve)),new Promise(resolve=>proxy.close(resolve))]);
}
assert.deepEqual(Object.fromEntries(keys.map(key=>[key,process.env[key]])),before,'official disposer restores caller environment');
console.log('OFFICIAL_FIRST=PASSED file_reference=true space_paths=true excluded_dirs=true proxy_request=true loopback_direct=true environment_restored=true');
