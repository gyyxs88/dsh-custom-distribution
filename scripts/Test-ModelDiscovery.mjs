import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const appRoot = process.argv[2];
if (!appRoot) throw new Error("app root is required");
const resolveFromApp = createRequire(join(appRoot, "package.json")).resolve;
const load = async name => import(pathToFileURL(resolveFromApp(name)).href);

const { Context } = await load("@deepseek-ai/cordis");
const { default: LlmRuntime } = await load("@deepseek-ai/dsh-llm");
const LlmPiAi = await load("@deepseek-ai/dsh-llm-pi-ai");
const { Config } = LlmPiAi;

const ctx = new Context();
await ctx.plugin(LlmRuntime);
await ctx.plugin(LlmPiAi, {});

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

  const live = await ctx.llm.discoverModels("llm-pi-ai", { provider: "openrouter" });
  assert.deepEqual(live, [{
    id: "acceptance/vision-model",
    input: ["text", "image"],
    reasoningEfforts: { off: null, low: "low", high: "high" },
    defaultReasoningEffort: "high",
  }]);

  globalThis.fetch = async () => new Response("temporary", { status: 503 });
  const fallback = await ctx.llm.discoverModels("llm-pi-ai", { provider: "openrouter" });
  assert.ok(fallback.some(model => model.input?.includes("image")));

  const routeConfig = {
    providers: {
      acceptance: {
        api: "openai-completions",
        baseURL: "http://127.0.0.1:9/v1",
        models: [{
          id: "acceptance/vision-model",
          input: ["text", "image"],
          reasoningEfforts: { off: null, low: "low", high: "high" },
          defaultReasoningEffort: "high",
        }],
        compat: { openRouterRouting: { only: ["DeepSeek"], allow_fallbacks: false } },
      },
    },
  };
  const validated = Config(routeConfig);
  assert.deepEqual(validated.providers.acceptance.compat.openRouterRouting, {
    allow_fallbacks: false,
    order: [],
    only: ["DeepSeek"],
    ignore: [],
    quantizations: [],
    max_price: {},
  });

  const routeCtx = new Context();
  await routeCtx.plugin(LlmRuntime);
  await routeCtx.plugin(LlmPiAi, routeConfig);
  const resolved = await routeCtx.llm.resolveModelInfo("acceptance", "acceptance/vision-model");
  assert.deepEqual(resolved.inputModalities, ["text", "image"]);
  assert.deepEqual(resolved.reasoning, {
    efforts: [
      { id: "off", name: "Off" },
      { id: "low", name: "Low" },
      { id: "high", name: "High" },
    ],
    defaultEffort: "high",
  });

  const remotes = await readFile(resolveFromApp("@deepseek-ai/dsh-api-remotes/client"), "utf8");
  assert.match(remotes, /defaultReasoningEffort/u);
  assert.match(remotes, /input.*literal\("image"\)/su);

  const settingsModels = await readFile(resolveFromApp("@deepseek-ai/dsh-client-ui-settings-models/client"), "utf8");
  assert.match(settingsModels, /candidate\.input === void 0 \? \{\} : \{ input: \[\.\.\.candidate\.input\] \}/u);
  assert.match(settingsModels, /function OpenRouterRoutingEditor/u);
  assert.match(settingsModels, /function DefaultModelEditor/u);
  assert.match(settingsModels, /reasoningSelectionUnavailable/u);

  const officialChat = await readFile(resolveFromApp("@deepseek-ai/dsh-client-ui-chat/client"), "utf8");
  assert.match(officialChat, /data-context-source/u);
  assert.match(officialChat, /message\.context\.relay\.from/u);
  assert.match(officialChat, /senderSessionId/u);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("MODEL_DISCOVERY_CAPABILITIES=PASSED");
