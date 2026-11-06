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
    "version": "0.2.2-rc.1",
    "sha256": "8e541fc98a11897706a122fde1db42f8b2a41b3b354ba3fcb932e9a16929ac6a"
  },
  "@deepseek-ai/dsh-llm-pi-ai": {
    "version": "0.2.2-rc.1",
    "sha256": "1a3ae58f9b4493e15459cc5000ec80f21b5d3f4a9dea6ffb6bc28e5b8817ae8a"
  },
  "@deepseek-ai/dsh-llm-deepseek": {
    "version": "0.2.2-rc.1",
    "sha256": "955dc7bc7ca6c857ff4a7e373b87c143b96a4c43fc80325b67dc0982600dcc75"
  }
};
export function assertOfficial() {
  for (const [pkg, expected] of Object.entries(officialContract)) {
    const version = require(`${pkg}/package.json`).version;
    const sha256 = createHash('sha256').update(readFileSync(require.resolve(pkg))).digest('hex');
    if (version !== expected.version || sha256 !== expected.sha256) {
      throw new LlmError(`Desktop supplement requires the reviewed official 0.2.2-rc.1 source: ${pkg}`, 'UNSUPPORTED_ADAPTER');
    }
  }
}
