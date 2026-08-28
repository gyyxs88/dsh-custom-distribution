import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const appRoot = process.argv[2];
if (!appRoot) throw new Error("app root is required");

const moduleUrl = pathToFileURL(
  join(appRoot, "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "lib", "index.js"),
).href;
const { Config, discoverModels, resolveRouteModels } = await import(moduleUrl);
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
      reasoning_efforts: ["none", "low", "high"],
      default_reasoning_effort: "high",
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  const live = await discoverModels({ provider: "openrouter" });
  assert.deepEqual(live, [{
    id: "acceptance/vision-model",
    input: ["text", "image"],
    reasoningEfforts: { off: null, low: "low", high: "high" },
    defaultReasoningEffort: "high",
  }]);

  globalThis.fetch = async () => new Response("temporary", { status: 503 });
  const fallback = await discoverModels({ provider: "openrouter" });
  assert.ok(fallback.some((model) => model.input?.includes("image")));

  const candidate = {
    id: "acceptance/vision-model",
    input: ["text", "image"],
    reasoningEfforts: { off: null, low: "low", high: "high" },
    defaultReasoningEffort: "high",
  };
  assert.deepEqual(discoveredModelViewSchema.parse(candidate), candidate);

  const profile = Config({
    providers: {
      openrouter: {
        models: [{ ...candidate, source: "manual" }],
        compat: { openRouterRouting: { only: ["DeepSeek"], allow_fallbacks: false } },
      },
    },
  }).providers.openrouter;
  const resolved = resolveRouteModels({
    provider: "openrouter",
    models: profile.models,
    compat: profile.compat,
    defaultContextWindow: profile.defaultContextWindow,
    defaultMaxTokens: profile.defaultMaxTokens,
    defaultInput: profile.defaultInput,
  }).models[0];
  assert.equal(resolved.defaultReasoningEffort, "high");
  assert.deepEqual(resolved.compat.openRouterRouting, {
    allow_fallbacks: false,
    only: ["DeepSeek"],
  });

  const connection = await readFile(
    join(appRoot, "node_modules", "@deepseek-ai", "dsh-client-connection", "lib", "client.js"),
    "utf8",
  );
  assert.match(connection, /input: array\(union\(\[literal\("text"\), literal\("image"\)\]\)\)\.min\(1\)\.optional\(\)/u);
  assert.match(connection, /reasoningEfforts: discoveredReasoningEffortsSchema\.optional\(\)/u);

  const settingsModels = await readFile(
    join(appRoot, "node_modules", "@deepseek-ai", "dsh-client-ui-settings-models", "lib", "client.js"),
    "utf8",
  );
  assert.match(settingsModels, /candidate\.input === void 0 \? \{\} : \{ input: \[\.\.\.candidate\.input\] \}/u);
  assert.match(settingsModels, /function OpenRouterRoutingEditor/u);
  assert.match(settingsModels, /function DefaultModelEditor/u);
  assert.match(settingsModels, /reasoningSelectionUnavailable/u);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("MODEL_DISCOVERY_CAPABILITIES=PASSED");
