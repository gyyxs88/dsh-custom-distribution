// Run with installed Electron in Node mode. Child remains the ordinary official GUI.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const osNames = ['SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA'];
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
