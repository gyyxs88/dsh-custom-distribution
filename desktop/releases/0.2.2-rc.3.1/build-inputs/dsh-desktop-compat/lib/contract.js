import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LlmError } from '@deepseek-ai/dsh-llm';
const require = createRequire(import.meta.url);
export const officialContract = {
  "@deepseek-ai/cordis": {
    "version": "4.1.0",
    "sha256": "627409afa06a265f7253200d3bc4648e88805c39fd3768568eb9b9518a31fe8f"
  },
  "@deepseek-ai/dsh-llm": {
    "version": "0.2.2-rc.3",
    "sha256": "6384b5f1e21404e997a41a31a22a079c9533f2ddc1ffd9148e684884ff62eb74"
  },
  "@deepseek-ai/dsh-llm-pi-ai": {
    "version": "0.2.2-rc.3",
    "sha256": "e956da3d7300e1426e13e14f47e6f981dd1ca345633a406568ee5058ad93e9d8"
  },
  "@deepseek-ai/dsh-llm-deepseek": {
    "version": "0.2.2-rc.3",
    "sha256": "e00c1816c29803ddd02b61e165e0376a62805b0af9873e3bac6daebf958cc137"
  }
};
export function assertOfficial() {
  for (const [pkg, expected] of Object.entries(officialContract)) {
    const version = require(`${pkg}/package.json`).version;
    const sha256 = createHash('sha256').update(readFileSync(require.resolve(pkg))).digest('hex');
    if (version !== expected.version || sha256 !== expected.sha256) {
      throw new LlmError(`Desktop supplement requires the reviewed official 0.2.2-rc.3 source: ${pkg}`, 'UNSUPPORTED_ADAPTER');
    }
  }
}
