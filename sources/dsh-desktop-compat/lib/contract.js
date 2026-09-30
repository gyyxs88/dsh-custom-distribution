import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LlmError } from '@deepseek-ai/dsh-llm';
const require = createRequire(import.meta.url);
export const officialContract = {
  '@deepseek-ai/cordis': { version: '4.0.4', sha256: '6a9394c0877ff45218818c6e815edd038f8057e1a1deb390a8d43ec81c57691e' },
  '@deepseek-ai/dsh-llm': { version: '0.2.0-rc.2', sha256: '9132c8a8053ee82b9fb1ded4f98c85cf557f288a15a85c552c6b1fb319ead120' },
  '@deepseek-ai/dsh-llm-pi-ai': { version: '0.2.0-rc.2', sha256: 'd46dbc30aeb3414190000e6f8aeaaf994246b5e5c651de07639f4a7e92de37ef' }
};
export function assertOfficial() {
  for (const [pkg, expected] of Object.entries(officialContract)) {
    const version = require(`${pkg}/package.json`).version;
    const sha256 = createHash('sha256').update(readFileSync(require.resolve(pkg))).digest('hex');
    if (version !== expected.version || sha256 !== expected.sha256) {
      throw new LlmError(`Desktop supplement requires the reviewed official rc.2 source: ${pkg}`, 'UNSUPPORTED_ADAPTER');
    }
  }
}
