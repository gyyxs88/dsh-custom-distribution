import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root,'../../..');
const canonical = path.join(repo,'sources/dsh-desktop-0.2.2-rc.1.1/build-inputs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file));
function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e =>
    e.isDirectory() ? files(path.join(directory,e.name),prefix+e.name+'/') : [{name:prefix+e.name,data:fs.readFileSync(path.join(directory,e.name))}]);
}

// The candidate's accepted USTAR ordering, zero metadata and level-9 gzip.
export function packSource(directory) {
  const parts = [], oct = (n,l) => n.toString(8).padStart(l-1,'0')+'\0';
  for (const {name,data} of files(directory).filter(f=>!f.name.startsWith('test/'))) {
    const full = 'package/'+name;
    if (Buffer.byteLength(full)>100) throw Error('Tar path too long');
    const h = Buffer.alloc(512);
    h.write(full); h.write(oct(0o644,8),100); h.write(oct(0,8),108); h.write(oct(0,8),116);
    h.write(oct(data.length,12),124); h.write(oct(0,12),136); h.fill(32,148,156);
    h.write('0',156); h.write('ustar\0',257); h.write('00',263);
    h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
    parts.push(h,data,Buffer.alloc((512-data.length%512)%512));
  }
  return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]),{level:9});
}

export function verifyReusedSource(bytes, directory) {
  const tar = gunzipSync(bytes), expected = new Map(files(directory).map(f=>[f.name,f.data]));
  let seen = 0;
  for (let offset=0;offset+512<=tar.length;) {
    const h=tar.subarray(offset,offset+512);
    if(h.every(b=>b===0)) break;
    const field=(a,b)=>h.subarray(a,b).toString().split('\0')[0];
    const size=parseInt(field(124,136).trim(),8), prefix=field(345,500);
    const name=(prefix?prefix+'/':'')+field(0,100), type=field(156,157);
    if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length) throw Error('Invalid original tar member');
    if(type==='0'||type==='') {
      if(!name.startsWith('package/')) throw Error('Unexpected original member path');
      const key=name.slice(8), data=tar.subarray(offset+512,offset+512+size);
      if(!expected.get(key)?.equals(data)) throw Error('Original source mismatch: '+key);
      expected.delete(key); seen++;
    } else if(type!=='5') throw Error('Unsupported original tar member type: '+type);
    offset+=512+Math.ceil(size/512)*512;
  }
  if(expected.size) throw Error('Original source contains extra files');
  return seen;
}

export async function reproduce(officialAsar, output, {allowUnfrozen=false}={}) {
  const manifest=json(path.join(root,'manifest.json'));
  if(manifest.frozen!==true&&!allowUnfrozen) throw Error('Candidate is not frozen; use --preliminary only for preparation');
  const archive=path.resolve(officialAsar), out=path.resolve(output);
  if(sha(fs.readFileSync(archive))!==manifest.official.windowsX64.appAsarSha256) throw Error('Exact original 0.2.2-rc.1 ASAR required');
  if(fs.existsSync(out)) throw Error('Choose a fresh output directory');
  for(const row of json(path.join(root,'source/input-files.json'))) if(sha(fs.readFileSync(path.join(repo,row.file)))!==row.sha256) throw Error('Public source input changed: '+row.file);
  for(const row of manifest.packages) if(sha(fs.readFileSync(path.join(root,row.file)))!==row.sha256) throw Error('Fixed package changed: '+row.name);
  fs.mkdirSync(out,{recursive:true});
  const results=[];
  const reused=new Set(['@omdsh-dev/dsh-genui','dsh-subagent-code-agents']);
  for(const row of manifest.packages.filter(p=>p.name!=='dsh-tps-correction')) {
    const original=fs.readFileSync(path.join(root,row.file));
    const bytes=reused.has(row.name)?original:packSource(path.join(canonical,'packages',row.name));
    const verifiedSourceFiles=reused.has(row.name)?verifyReusedSource(bytes,path.join(root,'build-inputs/reused',row.name)):undefined;
    if(sha(bytes)!==row.sha256) throw Error('Rebuild mismatch: '+row.name);
    fs.writeFileSync(path.join(out,path.basename(row.file)),bytes);
    results.push({name:row.name,sha256:row.sha256,mode:reused.has(row.name)?'original-verified-copied':'rebuilt',verifiedSourceFiles,match:true});
  }
  const ready=path.join(out,'official-input.json');
  fs.writeFileSync(ready,JSON.stringify({status:'READY',version:manifest.runtimeVersion,archive,sha256:{archive:manifest.official.windowsX64.appAsarSha256}},null,2)+'\n');
  const tpsSource=path.join(out,'tps-source');
  fs.mkdirSync(path.join(tpsSource,'scripts'),{recursive:true});
  for(const name of ['Build-Tps021.mjs','Tps-Patch021.mjs']) fs.copyFileSync(path.join(canonical,'work/scripts',name),path.join(tpsSource,'scripts',name));
  fs.copyFileSync(path.join(root,'build-inputs/tps/scripts/Tps-Official.mjs'),path.join(tpsSource,'scripts/Tps-Official.mjs'));
  fs.cpSync(path.join(canonical,'work/sources'),path.join(tpsSource,'sources'),{recursive:true});
  const {buildTps021}=await import(pathToFileURL(path.join(tpsSource,'scripts/Build-Tps021.mjs')));
  const built=buildTps021(ready,path.join(out,'tps'));
  const row=manifest.packages.find(p=>p.name==='dsh-tps-correction');
  const bytes=fs.readFileSync(built.archive);
  if(sha(bytes)!==row.sha256) throw Error('TPS generation mismatch');
  fs.writeFileSync(path.join(out,path.basename(row.file)),bytes);
  results.push({name:row.name,sha256:row.sha256,mode:'rebuilt-from-original-asar',match:true});
  const result={status:manifest.frozen===true?'FROZEN_INPUTS_REPRODUCED':'PRELIMINARY_INPUTS_REPRODUCED',frozen:manifest.frozen===true,results,rebuiltPackages:4,originalPackagesVerified:2,node:process.version,realProviderCalls:0,sshCalls:0,externalCodingCalls:0};
  fs.writeFileSync(path.join(out,'reproducibility.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]||!process.argv[3]||process.argv.slice(4).some(a=>a!=='--preliminary')) throw Error('Usage: node Reproduce.mjs <original-app.asar> <fresh-output> [--preliminary]');
  console.log(JSON.stringify(await reproduce(process.argv[2],process.argv[3],{allowUnfrozen:process.argv.includes('--preliminary')}),null,2));
}
