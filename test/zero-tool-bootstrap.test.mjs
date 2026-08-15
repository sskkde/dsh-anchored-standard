import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../zero-anchored-standard/zero-tool-bootstrap.mjs'

function register() {
  const listeners = {}
  const options = {}
  const warns = []
  const ctx = {
    on(event, callback, listenerOptions) {
      listeners[event] = callback
      options[event] = listenerOptions
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
    },
  }
  apply(ctx)
  assert.equal(typeof listeners['system-prompt/assemble'], 'function')
  assert.equal(typeof listeners['agent/pre-step'], 'function')
  return { listeners, options, warns }
}

function prestep(register, events, messages, header = {}, id = 's') {
  return register.listeners['agent/pre-step'](
    { agent: { session: { id, events, header } }, turn: 1, step: 1 },
    async () => ({ kind: 'enter', messages }),
  )
}

function assemble(listener, events, tools, header = {}, id = 's') {
  return listener(
    undefined,
    { agent: { session: { id, events, header } } },
    async () => ({ system: 'minimal persona', tools }),
  )
}

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'zero-tool-bootstrap')
})

test('every waterfall listener registers with prepend so its after-next runs last', () => {
  const { options } = register()
  assert.deepEqual(options, {
    'system-prompt/assemble': { prepend: true },
    'agent/pre-step': { prepend: true },
  })
})

test('the first top-level request exposes zero tools', async () => {
  const { listeners } = register()
  const listener = listeners['system-prompt/assemble']
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
  const result = await assemble(listener, [], tools)
  assert.deepEqual(result.tools, [])
})

test('a durable assistant message promotes the complete catalog', async () => {
  const { listeners } = register()
  const listener = listeners['system-prompt/assemble']
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }, { name: 'grep' }]
  const result = await assemble(listener, [{ type: 'assistant/message', data: {} }], tools)
  assert.deepEqual(result.tools, tools)
})

test('subagents see the full catalog from their first request', async () => {
  const { listeners } = register()
  const listener = listeners['system-prompt/assemble']
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]
  const result = await assemble(listener, [], tools, { delegationDepth: 1 })
  assert.deepEqual(result.tools, tools)
})

test('an assembly outside an agent keeps the full catalog', async () => {
  const { listeners } = register()
  const listener = listeners['system-prompt/assemble']
  const tools = [{ name: 'bash' }, { name: 'read' }]
  const result = await listener(undefined, { agent: undefined }, async () => ({ tools }))
  assert.deepEqual(result.tools, tools)
})

test('promotion is memoized per session id within one process', async () => {
  const { listeners } = register()
  const listener = listeners['system-prompt/assemble']
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]
  const promoted = await assemble(listener, [{ type: 'assistant/message' }], tools, {}, 'memo')
  assert.deepEqual(promoted.tools, tools)
  // Same session id, events now empty: the cached decision still promotes.
  const again = await assemble(listener, [], tools, {}, 'memo')
  assert.deepEqual(again.tools, tools)
})

test('sessions derive promotion independently from their own events', async () => {
  const { listeners } = register()
  const listener = listeners['system-prompt/assemble']
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]
  const promoted = await assemble(listener, [{ type: 'assistant/message' }], tools, {}, 'a')
  const fresh = await assemble(listener, [], tools, {}, 'b')
  assert.deepEqual(promoted.tools, tools)
  assert.deepEqual(fresh.tools, [])
})

test('bootstrap pre-step strips skill-catalog and agent-instructions messages', async () => {
  const reg = register()
  const messages = [
    { id: 'anchor', content: [{ type: 'text', text: 'This round is a test.' }], source: { kind: 'plugin', plugin: 'anchor-turn' } },
    { id: 'm1', content: [{ type: 'text', text: 'user message' }] },
    { id: 'm2', content: [{ type: 'text', text: '<available_skills>' }], source: { kind: 'skill-catalog' } },
    { id: 'm3', content: [{ type: 'text', text: '# AGENTS.md' }], source: { kind: 'agent-instructions' } },
  ]
  const decision = await prestep(reg, [], messages)
  assert.equal(decision.kind, 'enter')
  assert.deepEqual(decision.messages.map((message) => message.id), ['anchor', 'm1'])
})

test('promoted pre-step keeps skill-catalog and agent-instructions messages', async () => {
  const reg = register()
  const messages = [
    { id: 'm1', content: [{ type: 'text', text: 'user message' }] },
    { id: 'm2', content: [{ type: 'text', text: '# AGENTS.md' }], source: { kind: 'agent-instructions' } },
  ]
  const decision = await prestep(reg, [{ type: 'assistant/message' }], messages)
  assert.deepEqual(decision.messages.map((message) => message.id), ['m1', 'm2'])
})

test('subagent pre-step keeps injected workspace messages', async () => {
  const reg = register()
  const messages = [
    { id: 'm1', content: [{ type: 'text', text: 'child work' }], source: { kind: 'user' } },
    { id: 'm2', content: [{ type: 'text', text: '# AGENTS.md' }], source: { kind: 'agent-instructions' } },
  ]
  const decision = await prestep(reg, [], messages, { delegationDepth: 1 })
  assert.deepEqual(decision.messages.map((message) => message.id), ['m1', 'm2'])
})

test('reject decisions pass through untouched', async () => {
  const reg = register()
  const decision = await reg.listeners['agent/pre-step'](
    { agent: { session: { id: 's', events: [], header: {} } }, turn: 1, step: 1 },
    async () => ({ kind: 'reject' }),
  )
  assert.equal(decision.kind, 'reject')
})
