const assert = require('node:assert/strict');
const { productionEnvironment } = require('../desktop/launch-desktop.cjs');
const source = { SystemRoot:'C:/Windows', USERPROFILE:'C:/Users/test', https_proxy:'http://proxy:80', NO_PROXY:'verbatim', ALL_PROXY:'', ELECTRON_RUN_AS_NODE:'1', NODE_OPTIONS:'--inspect', NODE_USE_ENV_PROXY:'1', DSH_HOME:'fixture', DEEPSEEK_API_KEY:'synthetic-never-real', OTHER_KEY:'synthetic' };
const child = productionEnvironment(source);
assert.deepEqual(child,{SystemRoot:'C:/Windows',USERPROFILE:'C:/Users/test',https_proxy:'http://proxy:80',NO_PROXY:'verbatim',ALL_PROXY:''});
assert.equal(source.ELECTRON_RUN_AS_NODE,'1');
console.log('DESKTOP_PRODUCTION_ENV_TEST_PASSED provider_overrides_excluded=true proxy_values_preserved=true');
