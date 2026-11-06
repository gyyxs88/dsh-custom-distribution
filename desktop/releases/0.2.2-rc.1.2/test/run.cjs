const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [electron, archive, destination, ...flags] = process.argv.slice(2);
if (!electron || !archive || !destination || flags.some(arg => arg !== '--baseline')) throw Error('Usage: node test/run.cjs <official-electron.exe> <original-app.asar> <fresh-isolated-output> [--baseline]');
const output = path.resolve(destination);
if (fs.existsSync(output)) throw Error('Choose a fresh isolated output');
fs.mkdirSync(output, { recursive: true });
const child = spawnSync(path.resolve(electron), [path.join(__dirname, 'go429.test.mjs'), path.resolve(archive), output, ...flags], {
  cwd: __dirname, encoding: 'utf8', windowsHide: true, timeout: 45000,
  env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: 'C:/Windows', WINDIR: 'C:/Windows',
    TEMP: output, TMP: output, USERPROFILE: output, HOME: output, DSH_HOME: path.join(output, 'home'), PATH: 'C:/Windows/System32;C:/Windows' }
});
fs.writeFileSync(path.join(output, 'stdout.log'), child.stdout ?? '');
fs.writeFileSync(path.join(output, 'stderr.log'), child.stderr ?? '');
console.log(child.stdout ?? '');
if (child.status !== 0) { console.error(child.stderr, child.error); process.exitCode = 1; }
