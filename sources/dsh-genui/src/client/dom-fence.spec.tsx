import { readFileSync } from 'node:fs'
import { act, Fragment, isValidElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDomFenceRenderer } from './dom-fence.tsx'
import { renderResolvedFenceNode, resolveGenuiSpec } from './fence-render.tsx'
import { parsePartialGenuiSpec } from './parse-partial.ts'
import { sourceFences } from './fence-source.ts'
import { GENUI_LIMITS, repairGenuiSpec } from './guard.ts'

// Only the registry fallback needs this atom; the DOM channel under test
// mounts its real GenuiBlock and never imports the host's optional UI deps.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  CodeBlock: () => null, DiffBlock: () => null, JsonTree: () => null,
  GenuiActionContext: undefined, getGenuiComponent: undefined,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// The private reported fixture stays outside the source tree and release.
const fixturePath = process.env.GENUI_REPORTED_FIXTURE
const reported = fixturePath === undefined ? undefined : readFileSync(fixturePath, 'utf8').trim()
const simple = '{"items":[{"type":"text","content":"explicit UI"}]}'
const fence = (raw: string, lang = 'dsh-ui') => `\x60\x60\x60${lang}\n${raw}\n\x60\x60\x60`
let dispose: (() => void) | undefined

function host(raw: string, markdown: string, streaming = false) {
  const key = '14:assistant-step3:2'
  const row = document.createElement('div')
  row.setAttribute('data-chat-node-key', key)
  row.setAttribute('data-chat-anchor-key', key)
  const body = document.createElement('div')
  if (streaming) body.setAttribute('data-streaming', '')
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  const label = document.createElement('div')
  label.textContent = streaming ? '' : '代码块'
  banner.append(label)
  const pre = document.createElement('pre')
  pre.textContent = raw + '\n'
  block.append(banner, pre)
  body.append(block)
  row.append(body)
  document.body.append(row)
  let source = markdown
  let sessionId = 'session-test'
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const chat = {
    getSnapshot: () => ({ nodes: { get: (nodeKey: string) => nodeKey !== key ? undefined : {
      key, kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: source }] },
    } } }), subscribe,
  }
  const ctx = {
    uiSession: { adapter: { current: {
      getSnapshot: () => ({ key: sessionId, hooks: { chat } }), subscribe,
    } } },
  } as unknown as Context
  return {
    row, body, block, label, pre, ctx,
    source: (text: string) => { source = text; for (const listener of [...listeners]) listener() },
    session: (id: string) => { sessionId = id; for (const listener of [...listeners]) listener() },
  }
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 45)) })
}

async function install(ctx: Context) {
  await act(async () => { dispose = installDomFenceRenderer(ctx, vi.fn()) })
  await flush()
}

afterEach(async () => {
  await act(async () => { dispose?.(); dispose = undefined })
  document.body.replaceChildren()
  localStorage.clear()
})

describe('rc.2 explicit fence source', () => {
  it('keeps a trusted dsh-ui fence through the generic settled toolbar and history replay', async () => {
    const h = host(simple, fence(simple), true)
    await install(h.ctx)
    expect(h.block.style.display).toBe('none')
    h.label.textContent = '代码块'
    h.body.removeAttribute('data-streaming')
    await flush()
    expect(h.block.style.display).toBe('none')
    expect(h.row.querySelector('.genui-dom-fence')?.textContent).toContain('explicit UI')
    await act(async () => { dispose?.(); dispose = undefined })
    await install(h.ctx)
    expect(h.block.style.display).toBe('none')
  })

  it.each(['json', 'python', ''])('does not take over %s code even while streaming', async (lang) => {
    const h = host(simple, fence(simple, lang), true)
    await install(h.ctx)
    expect(h.block.style.display).toBe('')
    expect(h.row.querySelector('.genui-dom-fence')).toBeNull()
    h.body.removeAttribute('data-streaming')
    await flush()
    expect(h.block.style.display).toBe('')
    await act(async () => { dispose?.(); dispose = undefined })
    await install(h.ctx)
    expect(h.block.style.display).toBe('')
  })

  it('restores code when the source language changes without a DOM mutation', async () => {
    const h = host(simple, fence(simple))
    await install(h.ctx)
    expect(h.block.style.display).toBe('none')
    h.source(fence(simple, 'json'))
    await flush()
    expect(h.block.style.display).toBe('')
    expect(h.row.querySelector('.genui-dom-fence')).toBeNull()
  })

  it('drops the old UI for an invalid body and never reuses a stale source match', async () => {
    const h = host(simple, fence(simple))
    await install(h.ctx)
    h.pre.textContent = 'invalid new content'
    h.source(fence('invalid new content'))
    await flush()
    expect(h.block.style.display).toBe('')
    expect(h.row.querySelector('.genui-dom-fence')).toBeNull()
    h.pre.textContent = simple
    await flush()
    expect(h.block.style.display).toBe('')
  })

  it('maps duplicate bodies to their own fence language and preserves surrounding prose', async () => {
    const h = host(simple, fence(simple, 'json') + '\n\n' + fence(simple))
    const second = h.block.cloneNode(true) as HTMLElement
    h.body.append(second)
    const prose = document.createElement('p')
    prose.textContent = 'surrounding answer'
    h.body.prepend(prose)
    await install(h.ctx)
    expect(h.block.style.display).toBe('')
    expect(second.style.display).toBe('none')
    expect(h.row.style.display).toBe('')
    expect(prose.isConnected).toBe(true)
    expect(h.row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
  })

  it('keeps ambiguous duplicate DOM bodies visible', async () => {
    const h = host(simple, fence(simple))
    h.body.append(h.block.cloneNode(true))
    await install(h.ctx)
    expect(h.row.querySelector('.genui-dom-fence')).toBeNull()
  })

  it.each(['missing', 'throws', 'undefined'] as const)('starts safely when the current Chat binding %s', async (mode) => {
    const h = host(simple, fence(simple))
    h.ctx.uiSession.adapter.current.getSnapshot = (() => {
      if (mode === 'throws') throw new Error('no current binding')
      return mode === 'undefined' ? undefined : { key: undefined, hooks: {} }
    }) as typeof h.ctx.uiSession.adapter.current.getSnapshot
    await install(h.ctx)
    expect(h.block.style.display).toBe('')
    expect(h.row.querySelector('.genui-dom-fence')).toBeNull()
  })

  it('supports an explicit legacy DOM label without a Chat source', async () => {
    const h = host(simple, fence(simple))
    h.ctx.uiSession.adapter.current.getSnapshot = (() => ({ key: 'session-test', hooks: {} })) as typeof h.ctx.uiSession.adapter.current.getSnapshot
    h.label.textContent = 'dsh-ui'
    h.block.className = 'unlisted-code-surface'
    await install(h.ctx)
    expect(h.block.style.display).toBe('none')
  })

  it('removes an orphan UI when the host replaces a settled code block', async () => {
    const h = host(simple, fence(simple))
    await install(h.ctx)
    const second = h.block.cloneNode(true) as HTMLElement
    second.style.display = ''
    second.removeAttribute('data-genui-rendered')
    h.block.replaceWith(second)
    await flush()
    expect(second.style.display).toBe('none')
    expect(h.row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
  })

  it('unmounts on source disappearance after a session switch', async () => {
    const h = host(simple, fence(simple))
    await install(h.ctx)
    h.source('the new session has no fence')
    h.session('session-new')
    await flush()
    expect(h.block.style.display).toBe('')
    expect(h.row.querySelector('.genui-dom-fence')).toBeNull()
  })
})

describe('source fence boundaries and completed repair', () => {
  it('does not find a dsh-ui example inside a longer ordinary code fence', () => {
    const text = '\x60\x60\x60\x60json\n' + fence(simple) + '\n\x60\x60\x60\x60'
    expect(sourceFences(text).map((entry) => entry.language)).toEqual(['json'])
  })

  it('accepts tilde, CRLF, indented, info-suffix and unclosed streaming fences', () => {
    expect(sourceFences('  ~~~dsh-ui extra\r\n  ' + simple + '\r\n  ~~~')).toEqual([{ language: 'dsh-ui', raw: simple }])
    expect(sourceFences('\x60\x60\x60dsh-ui\n' + simple)).toEqual([{ language: 'dsh-ui', raw: simple }])
  })

  it('leaves unsupported quoted/list/indented examples to the host', () => {
    for (const prefix of ['> ', '- ', '    ']) expect(sourceFences(prefix + fence(simple))).toEqual([])
  })

  it.each([
    ['{"type":"callout","content":"bare"', 'callout'],
    ['{"type":"callout","text":"alias"', 'callout'],
    ['{"type":"col","items":[{"type":"text","content":"child"}', 'text'],
  ])('preserves malformed bare component semantics for %s', (raw, type) => {
    const spec = resolveGenuiSpec(raw!, { source: { id: 'bare', order: [1, 0, 1] } })
    expect(spec?.items[0]?.type).toBe(type)
  })

  it('keeps structural completion off while streaming and panel append gated on the original whole body', () => {
    const raw = '{"panel":true,"append":true,"items":[{"type":"text","content":"pending'
    expect(resolveGenuiSpec(raw)).toBeNull()
    const node = renderResolvedFenceNode(raw, 'panel', {
      sessionId: 'session-test', source: { id: 'append', order: [1, 0, 1] },
    })
    expect(isValidElement(node) && node.type === Fragment).toBe(true)
  })

  it('preserves callout canonical content, string limits and node budgets', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'callout', text: 'x'.repeat(GENUI_LIMITS.maxString + 30), content: 'canonical' },
      { type: 'callout', text: 'x'.repeat(GENUI_LIMITS.maxString + 30) },
    ] })
    expect(spec?.items[0]).toMatchObject({ content: 'canonical' })
    expect((spec?.items[1] as { content: string }).content).toHaveLength(GENUI_LIMITS.maxString)
    const raw = JSON.stringify({ items: Array.from({ length: 250 }, () => ({ type: 'text', content: 'budget' })) }) + ']}'
    expect(resolveGenuiSpec(raw, { source: { id: 'budget', order: [1, 0, 1] } })?.items).toHaveLength(GENUI_LIMITS.maxNodes)
  })
})

describe.skipIf(reported === undefined)('exact reported fixture (private opt-in)', () => {
  it('reproduces partial recovery and recovers the whole settled callout and five table rows', () => {
    expect(() => JSON.parse(reported!)).toThrow()
    expect(parsePartialGenuiSpec(reported!)?.items.map((item) => item.type)).toEqual(['callout'])
    expect(resolveGenuiSpec(reported!)?.items.map((item) => item.type)).toEqual(['callout'])
    const spec = resolveGenuiSpec(reported!, { source: { id: 'reported', order: [59, 0, 1] } })
    expect(spec?.items.map((item) => item.type)).toEqual(['callout', 'table'])
    expect(spec?.items[1]).toMatchObject({ rows: expect.arrayContaining([expect.any(Array)]) })
    expect((spec?.items[1] as { rows: unknown[] }).rows).toHaveLength(5)
  })

  it('renders the exact malformed body through streaming, settlement and a fresh history mount', async () => {
    const h = host(reported!, fence(reported!), true)
    await install(h.ctx)
    expect(h.block.style.display).toBe('none')
    expect(h.row.querySelector('table')).toBeNull()
    h.label.textContent = '代码块'
    h.body.removeAttribute('data-streaming')
    await flush()
    expect(h.block.style.display).toBe('none')
    expect(h.row.querySelectorAll('tbody tr')).toHaveLength(5)
    await act(async () => { dispose?.(); dispose = undefined })
    await install(h.ctx)
    expect(h.row.querySelectorAll('tbody tr')).toHaveLength(5)
  })
})
