import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

async function exercise(writeClipboard) {
  let plugin
  let registration
  let feedback
  let closed = false
  let selected = false
  let copiedDuringSelect = false
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ id, factory }) => {
      assert.equal(id, 'dsh-copy-session-id')
      plugin = factory((name) => {
        if (name === 'react') return {
          createElement: (type, props, ...children) => ({ type, props, children }),
          useState: () => ['', (value) => { feedback = value }],
        }
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
          IconCopyOutlineRegular: () => null,
          MenuItemButton: () => null,
          writeClipboard: (value) => {
            copiedDuringSelect = selected
            return writeClipboard(value)
          },
        }
        throw new Error(`unexpected import ${name}`)
      })
    } } },
    setTimeout: (callback, delay) => { assert.equal(delay, 1400); callback() },
    Promise,
    String,
  }
  runInNewContext(source, sandbox)
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  plugin.apply({ slots: {
    inject: (name, callback) => {
      assert.equal(name, 'sidebar.workspaces.session.menu.item')
      for (const registration of callback()) void registration
    },
    register: (meta, component) => { registration = { meta, component }; return () => {} },
  } })
  assert.equal(registration.meta.id, 'dsh-copy-session-id')
  assert.equal(registration.meta.order, 500)
  const row = registration.component({ sessionId: 'session-123', useMenuOpenState: () => [true, (value) => { closed = value === false }] })
  selected = true
  row.props.onSelect()
  selected = false
  await new Promise((resolve) => setImmediate(resolve))
  return { feedback, closed, copiedDuringSelect }
}

test('copies the exact rc.2 session id during user activation', async () => {
  let copied
  const result = await exercise(async (value) => { copied = value; return true })
  assert.equal(copied, 'session-123')
  assert.equal(result.copiedDuringSelect, true)
  assert.equal(result.feedback, '已复制会话 ID')
  assert.equal(result.closed, true)
})

test('reports clipboard denial and closes the menu', async () => {
  const result = await exercise(async () => false)
  assert.equal(result.feedback, '复制失败，请检查剪贴板权限')
  assert.equal(result.closed, true)
})

test('reports unexpected clipboard rejection and closes the menu', async () => {
  const result = await exercise(async () => { throw new Error('denied') })
  assert.equal(result.feedback, '复制失败，请检查剪贴板权限')
  assert.equal(result.closed, true)
})
