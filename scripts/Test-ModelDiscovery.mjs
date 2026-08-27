import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const appRoot = process.argv[2];
if (!appRoot) throw new Error("app root is required");

const moduleUrl = pathToFileURL(
  join(appRoot, "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "lib", "index.js"),
).href;
const { discoverModels } = await import(moduleUrl);
const schemaUrl = pathToFileURL(
  join(appRoot, "node_modules", "@deepseek-ai", "dsh-host-apiproxy", "lib", "types", "api", "llm.schema.js"),
).href;
const { discoveredModelViewSchema } = await import(schemaUrl);

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

  const candidate = { id: "acceptance/vision-model", input: ["text", "image"] };
  assert.deepEqual(discoveredModelViewSchema.parse(candidate), candidate);

  const connection = await readFile(
    join(appRoot, "node_modules", "@deepseek-ai", "dsh-client-connection", "lib", "client.js"),
    "utf8",
  );
  assert.match(connection, /input: array\(union\(\[literal\("text"\), literal\("image"\)\]\)\)\.min\(1\)\.optional\(\)/u);

  const settingsModels = await readFile(
    join(appRoot, "node_modules", "@deepseek-ai", "dsh-client-ui-settings-models", "lib", "client.js"),
    "utf8",
  );
  assert.match(settingsModels, /candidate\.input === void 0 \? \{\} : \{ input: \[\.\.\.candidate\.input\] \}/u);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("MODEL_DISCOVERY_MODALITIES=PASSED");
