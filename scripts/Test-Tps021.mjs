import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertTpsOutput } from './Tps-Official.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.argv[2]||!process.argv[3])throw Error('Explicit ready pointer and TPS output required');
const ready=JSON.parse(fs.readFileSync(process.argv[2]));
const out=assertTpsOutput(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const result=spawnSync(ready.electron,['--expose-internals',path.join(root,'tests/tps-021.test.mjs'),path.resolve(process.argv[2]),out],{cwd:root,encoding:'utf8',timeout:90000,env:{ELECTRON_RUN_AS_NODE:'1',SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:'C:\\Windows\\System32;C:\\Windows',TEMP:out,TMP:out,DSH_HOME:path.join(out,'isolated-home')}});
fs.writeFileSync(path.join(out,'tests.stdout.log'),result.stdout??'');fs.writeFileSync(path.join(out,'tests.stderr.log'),result.stderr??'');
console.log(result.stdout??'');if(result.status!==0){console.error(result.stderr,result.error);process.exitCode=1;}
