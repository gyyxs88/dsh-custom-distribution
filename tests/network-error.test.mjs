import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveRetryPolicy } from "../sources/dsh-llm-model-discovery-capabilities/lib/index.js";

function loadInstalledClassifier() {
  const packageJson = fileURLToPath(
    new URL("../sources/dsh-llm-pi-ai-live-discovery/package.json", import.meta.url),
  );
  const source = readFileSync(join(dirname(packageJson), "lib", "index.js"), "utf8");
  const start = source.indexOf("function classifyPiAiError(message) {");
  assert.notEqual(start, -1, "installed adapter must contain classifyPiAiError");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, "installed classifier must have a closing brace");
  const body = source.slice(start, end + 2);
  return Function(
    "isQuotaExceededError",
    "QUOTA_EXCEEDED_CODE",
    `return (${body});`,
  )(() => false, "QUOTA_EXCEEDED");
}

test("provider finish_reason network_error is retryable transport", () => {
  const classifyPiAiError = loadInstalledClassifier();
  const code = classifyPiAiError("Provider finish_reason: network_error");
  const policy = resolveRetryPolicy(undefined, "test.retryPolicy");

  assert.equal(code, "TRANSPORT");
  assert.ok(policy.retryableCodes.includes(code));
});

test("generic pi-ai errors remain non-retryable", () => {
  const classifyPiAiError = loadInstalledClassifier();
  const code = classifyPiAiError("opaque provider failure");
  const policy = resolveRetryPolicy(undefined, "test.retryPolicy");

  assert.equal(code, "PI_AI_ERROR");
  assert.ok(!policy.retryableCodes.includes(code));
});
