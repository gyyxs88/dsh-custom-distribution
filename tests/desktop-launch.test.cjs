const assert = require('node:assert/strict');
const { productionEnvironment } = require('../desktop/launch-desktop.cjs');
const source = { SystemRoot:'C:/Windows', SystemDrive:'C:', USERPROFILE:'C:/Users/test', USERNAME:'test', COMPUTERNAME:'TEST-PC', ProgramData:'C:/ProgramData', ProgramFiles:'C:/Program Files', 'ProgramFiles(x86)':'C:/Program Files (x86)', CommonProgramW6432:'C:/Program Files/Common Files', https_proxy:'http://proxy:80', NO_PROXY:'verbatim', ALL_PROXY:'', ELECTRON_RUN_AS_NODE:'1', NODE_OPTIONS:'--inspect', NODE_USE_ENV_PROXY:'1', DSH_HOME:'fixture', DEEPSEEK_API_KEY:'synthetic-never-real', OTHER_KEY:'synthetic' };
const child = productionEnvironment(source);
assert.deepEqual(child,{SystemRoot:'C:/Windows',SystemDrive:'C:',USERPROFILE:'C:/Users/test',USERNAME:'test',COMPUTERNAME:'TEST-PC',ProgramData:'C:/ProgramData',ProgramFiles:'C:/Program Files','ProgramFiles(x86)':'C:/Program Files (x86)',CommonProgramW6432:'C:/Program Files/Common Files',https_proxy:'http://proxy:80',NO_PROXY:'verbatim',ALL_PROXY:''});
// Windows OpenSSH needs %ProgramData%; dropping it made every native ssh binary exits 255 silently.
assert.equal(child.ProgramData,'C:/ProgramData');
assert.deepEqual(productionEnvironment({ programdata:'C:/ProgramData' }),{programdata:'C:/ProgramData'});
assert.equal(source.ELECTRON_RUN_AS_NODE,'1');
console.log('DESKTOP_PRODUCTION_ENV_TEST_PASSED provider_overrides_excluded=true proxy_values_preserved=true os_baseline_includes_programdata=true');
