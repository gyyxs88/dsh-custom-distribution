// Compare the frozen actual installation with the unpacked candidate, no provider.
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const official = createRequire('D:/DSH/resources/app.asar/dsh/package.json')
const { Context } = official('@deepseek-ai/cordis')
const { SystemPrompt } = official('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = official('@deepseek-ai/dsh-tools')
const fixtures = [
  ['callout text alias', { items: [{ type: 'callout', text: 'alias' }] }, null],
  ['keyvalue missing pairs', { items: [{ type: 'keyvalue', items: [] }] }, '$.items[0].pairs'],
  ['callout numeric content', { items: [{ type: 'callout', content: 42 }] }, '$.items[0].content'],
  ['keyvalue internal loss', { items: [{ type: 'keyvalue', pairs: [null] }] }, '$.items[0].pairs[0]'],
  ['table internal loss', { items: [{ type: 'table', columns: ['A'], rows: [null] }] }, '$.items[0].rows[0]'],
  ['nested path', { items: [{ type: 'tabs', tabs: [{ label: 'A', content: { type: 'keyvalue' } }] }] }, '$.items[0].tabs[0].content.pairs'],
  ['syntax repair integrity', '{"items":[{"type":"callout","content":42}],}', '$.items[0].content'],
]
async function load(filename) {
  const ctx = new Context()
  const prompt = await ctx.plugin(SystemPrompt)
  const runtime = await ctx.plugin(ToolRuntime)
  const plugin = await ctx.plugin(require(path.resolve(filename)))
  return { ctx, tool: ctx.tools.get('validate_dsh_ui'), dispose: async () => {
    await plugin.dispose(); await runtime.dispose(); await prompt.dispose()
  } }
}
async function main() {
  const before = await load(process.argv[2])
  const after = await load(process.argv[3])
  const results = []
  for (const [name, spec, expectedPath] of fixtures) {
    const oldResult = await before.tool.execute({ spec })
    const newResult = await after.tool.execute({ spec })
    if (expectedPath === null) assert.match(newResult, /✅/)
    else { assert.match(newResult, /❌/); assert.ok(newResult.includes(expectedPath), name) }
    results.push({ name, before: oldResult, after: newResult })
  }
  const rendered = after.ctx.tools.get('render_ui').output.presentationMeta({ spec: {
    items: [{ type: 'callout', text: 'alias' }, { type: 'table', columns: [{ title: 'Name', key: 'name' }], rows: [{ name: 'Alice' }] }],
  } })
  assert.equal(rendered.items[0].content, 'alias')
  assert.deepEqual(rendered.items[1], { type: 'table', columns: ['Name'], rows: [['Alice']] })
  await before.dispose(); await after.dispose()
  console.log(JSON.stringify({ results, renderCompatibility: 'PASS' }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
