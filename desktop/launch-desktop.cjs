// Run with installed Electron in Node mode. Child remains the ordinary official GUI.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
// Stable Windows machine facts a child may need to run ordinary tooling. ProgramData is not
// optional: Windows OpenSSH resolves its default config directory from %ProgramData% and
// exits 255 without printing anything when the variable is absent, which is indistinguishable
// from a broken binary. Secrets, provider overrides and Node/Electron execution switches stay out.
const osNames = [
  'SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','SystemDrive','OS',
  'PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER','PROCESSOR_LEVEL','PROCESSOR_REVISION','NUMBER_OF_PROCESSORS',
  'USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','USERNAME','USERDOMAIN','COMPUTERNAME',
  'ProgramData','ALLUSERSPROFILE','PUBLIC',
  'ProgramFiles','ProgramFiles(x86)','ProgramW6432','CommonProgramFiles','CommonProgramFiles(x86)','CommonProgramW6432',
];
function productionEnvironment(caller) {
  const result = {};
  for (const name of Object.keys(caller)) {
    if (osNames.some(key => key.toLowerCase() === name.toLowerCase()) || /^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(name)) result[name] = caller[name];
  }
  return result;
}
module.exports = { productionEnvironment };
if (require.main === module) {
  const executable = process.execPath;
  const env = productionEnvironment(process.env);
  const logRoot = path.join(env.LOCALAPPDATA, 'DSH-Desktop-Launcher');
  fs.mkdirSync(logRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stdout = fs.openSync(path.join(logRoot, stamp + '.stdout.log'), 'a');
  const stderr = fs.openSync(path.join(logRoot, stamp + '.stderr.log'), 'a');
  const child = spawn(executable, [], { cwd: path.dirname(executable), env, windowsHide: false, detached: true, stdio: ['ignore', stdout, stderr] });
  child.once('spawn', () => {
    child.unref(); fs.closeSync(stdout); fs.closeSync(stderr);
    console.log(JSON.stringify({ status: 'STARTED', mainPid: child.pid, executable, logs: logRoot }));
  });
  child.once('error', () => { console.error('Official Desktop spawn failed'); process.exitCode = 1; });
}
