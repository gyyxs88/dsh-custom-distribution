import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { diagnoseGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'
import { GENUI_AUTHORING_RULE, GENUI_RETRY_RULE } from '../src/plugin/contract.ts'
import { GENUI_SECTION_TEXT, inject } from '../src/plugin/index.ts'
import { loadGenuiSkill } from '../src/plugin/skill.ts'

const validate = (spec: unknown) => createValidateDshUiTool().execute({ spec } as never, {} as never)

describe('GenUI content integrity', () => {
  it.each([
    [{ type: 'callout', content: 42 }, '$.items[0].content', 'callout'],
    [{ type: 'keyvalue', items: [] }, '$.items[0].pairs', 'keyvalue'],
    [{ type: 'keyvalue', pairs: [null] }, '$.items[0].pairs[0]', 'keyvalue'],
    [{ type: 'keyvalue', pairs: [{ key: 'CPU', value: { bad: true } }] }, '$.items[0].pairs[0].value', 'keyvalue'],
    [{ type: 'table', columns: ['A'], rows: [null] }, '$.items[0].rows[0]', 'table'],
    [{ type: 'table', columns: [{}], rows: [['A']] }, '$.items[0].columns[0]', 'table'],
    [{ type: 'table', columns: ['A'], rows: [[{}]] }, '$.items[0].rows[0][0]', 'table'],
    [{ type: 'steps', steps: [null] }, '$.items[0].steps[0]', 'steps'],
  ])('reports the actual path for %j', async (node, path, type) => {
    const result = await validate({ items: [node] })
    expect(result).toContain('❌')
    expect(result).toContain(path)
    expect(result).toContain(`(${type})`)
    expect(result).toContain('example:')
    expect(result).toContain(GENUI_RETRY_RULE)
  })

  it('keeps raw nested paths through layout, tabs.content, accordion and list', async () => {
    const spec = { items: [{ type: 'card', items: [{ type: 'tabs', tabs: [{ label: 'A', content: [
      { type: 'accordion', items: [{ title: 'B', items: [{ type: 'list', items: [{ type: 'keyvalue' }] }] }] },
    ] }] }] }] }
    const result = await validate(spec)
    expect(result).toContain('$.items[0].items[0].tabs[0].content[0].items[0].items[0].items[0].pairs')
  })

  it('reports both missing and incorrectly typed fields without echoing values', async () => {
    const result = await validate({ items: [{ type: 'keyvalue', pairs: [{ value: 'SECRET-sentinel' }] }] })
    expect(result).toContain('.pairs[0].key')
    expect(result).toContain('missing field')
    expect(result).not.toContain('SECRET-sentinel')
    const invalid = await validate('{"items": SECRET-sentinel}')
    expect(invalid).not.toContain('SECRET-sentinel')
  })

  it.each([
    { items: [{ type: 'callout', text: 'Alias' }, { type: 'badge', value: 'OK' }] },
    { type: 'callout', text: 'bare alias' },
    { items: [{ type: 'tabs', tabs: [{ label: 'A', content: { type: 'keyvalue', pairs: [{ key: 'A', value: 'B' }] } }] }] },
    { items: [{ type: 'table', columns: [{ title: 'Name', key: 'name' }], rows: [{ name: 'Alice' }] }] },
    { items: [{ type: 'table', columns: [{ label: 'Name', dataIndex: 'name' }], data: [{ name: 'Alice' }] }] },
    { items: [{ type: 'table', columns: ['Name'], rows: [{ cells: ['Alice'] }] }] },
    { items: [{ type: 'slider', min: 100, max: 0 }, { type: 'progress', value: 120 }] },
  ])('keeps repairable legacy input legal: %j', async (spec) => {
    expect(diagnoseGenuiSpec(spec)).toEqual({ ok: true, errors: [] })
    expect(await validate(spec)).toContain('✅')
    expect(repairGenuiSpec(spec)?.items.length).toBeGreaterThan(0)
  })

  it('checks field integrity after syntax repair, including internal row loss', async () => {
    for (const node of [{ type: 'callout', content: 42 }, { type: 'keyvalue' }, { type: 'keyvalue', pairs: [null] }]) {
      const result = await validate(JSON.stringify({ items: [node] }).replace(/]}$/, '],}'))
      expect(result).toContain('❌')
      expect(result).not.toContain('直接照抄')
    }
    const result = await validate('{"items":[{"type":"callout","text":"ok"}],}')
    expect(result).toContain('✅ 已自动修复')
    expect(result).toContain('"content":"ok"')
  })
})

describe('field acquisition and bounded retry contract', () => {
  it('publishes identical policy in skill, prompt and both tools', () => {
    const skill = loadGenuiSkill()
    expect(skill.path.replaceAll('\\', '/')).toMatch(/dsh-genui\/SKILL.md$/)
    for (const text of [skill.content, GENUI_SECTION_TEXT, createValidateDshUiTool().description, createRenderUiTool().description]) {
      expect(text).toContain(GENUI_AUTHORING_RULE)
      expect(text).toContain(GENUI_RETRY_RULE)
    }
    expect(inject).toEqual(['systemPrompt'])
    expect(skill.content).toContain('秘密禁令')
    expect(skill.content).toContain('零模型往返')
    expect(readFileSync(skill.path, 'utf8')).toContain(skill.content)
  })

  it('has no global budget: independent displays can validate', async () => {
    for (let i = 0; i < 3; i++) expect(await validate({ items: [{ type: 'text', content: String(i) }] })).toContain('✅')
  })
})
