import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LlmError } from '@deepseek-ai/dsh-llm';
const require = createRequire(import.meta.url);
export const officialContract = {
  "@deepseek-ai/cordis": {
    "version": "4.0.5",
    "sha256": "6a9394c0877ff45218818c6e815edd038f8057e1a1deb390a8d43ec81c57691e"
  },
  "@deepseek-ai/dsh-llm": {
    "version": "0.2.1-rc.2",
    "sha256": "d18d8ae4c8d961e628708c1e4698e09716a0ebb80e55a672e0bde1029bec1155"
  },
  "@deepseek-ai/dsh-llm-pi-ai": {
    "version": "0.2.1-rc.2",
    "sha256": "99b5c20830a52f69641df8a18a39206079b0c725201958cce2c4a934f1d4f7cd"
  },
  "@deepseek-ai/dsh-llm-deepseek": {
    "version": "0.2.1-rc.2",
    "sha256": "eba35025ed1eedda89c51f2da46a3a968f7be1d59719f2ceeadfc4518dff37d6"
  }
};
export function assertOfficial() {
  for (const [pkg, expected] of Object.entries(officialContract)) {
    const version = require(`${pkg}/package.json`).version;
    const sha256 = createHash('sha256').update(readFileSync(require.resolve(pkg))).digest('hex');
    if (version !== expected.version || sha256 !== expected.sha256) {
      throw new LlmError(`Desktop supplement requires the reviewed official 0.2.1-rc.2 source: ${pkg}`, 'UNSUPPORTED_ADAPTER');
    }
  }
}
