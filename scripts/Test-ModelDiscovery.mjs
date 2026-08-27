import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const appRoot = process.argv[2];
if (!appRoot) throw new Error("app root is required");

const moduleUrl = pathToFileURL(
  join(appRoot, "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "lib", "index.js"),
).href;
const { discoverModels } = await import(moduleUrl);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      id: "acceptance/vision-model",
      architecture: { input_modalities: ["text", "image", "file", "image"] },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  const live = await discoverModels({ provider: "openrouter" });
  assert.deepEqual(live, [{
    id: "acceptance/vision-model",
    input: ["text", "image"],
  }]);

  globalThis.fetch = async () => new Response("temporary", { status: 503 });
  const fallback = await discoverModels({ provider: "openrouter" });
  assert.ok(fallback.some((model) => model.input?.includes("image")));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("MODEL_DISCOVERY_MODALITIES=PASSED");
