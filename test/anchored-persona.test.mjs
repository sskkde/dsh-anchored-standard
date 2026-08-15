import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_BASE, PERSONA_ORDER, PERSONA_SECTION, apply, foldPlanMode, inject, name } from '../preset/anchored-persona.mjs'

const POLICY = 'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds.'

function register(config = {}) {
  let section
  let suppressed = false
  const ctx = {
    effect(fn) {
      fn()
    },
    systemPrompt: {
      section(cfg) {
        section = cfg
      },
      suppressRuntimeContext() {
        suppressed = true
      },
    },
  }
  apply(ctx, config)
  assert.equal(typeof section?.text, 'function')
  return { section, suppressed }
}

function agent(events = []) {
  return { agent: { session: { events } } }
}

test('exports a diagnostic plugin name and inject list', () => {
  assert.equal(name, 'anchored-persona')
  assert.deepEqual(inject, ['systemPrompt'])
})

test('registers the persona section as complete with a dynamic text function', () => {
  const { section } = register({ text: 'You are a helpful software engineer assistant.' })
  assert.equal(section.name, PERSONA_SECTION)
  assert.equal(section.order, PERSONA_ORDER)
  assert.equal(section.complete, true)
  assert.equal(typeof section.text, 'function')
})

test('no plan-mode events: text is the plain base persona', async () => {
  const { section } = register({ text: 'You are a helpful software engineer assistant.' })
  assert.equal(await section.text(agent([])), DEFAULT_BASE)
})

test('plan mode active: text appends the plan policy to the base persona', async () => {
  const { section } = register({ text: DEFAULT_BASE, planSection: POLICY })
  const context = agent([{ type: 'plan/mode', data: { active: true } }])
  assert.equal(await section.text(context), `${DEFAULT_BASE}\n\n${POLICY}`)
})

test('plan mode switched off: text returns to the plain base persona', async () => {
  const { section } = register({ text: DEFAULT_BASE, planSection: POLICY })
  const context = agent([
    { type: 'plan/mode', data: { active: true } },
    { type: 'plan/mode', data: { active: false } },
  ])
  assert.equal(await section.text(context), DEFAULT_BASE)
})

test('assembly outside an agent: text is the plain base persona', async () => {
  const { section } = register({ text: DEFAULT_BASE, planSection: POLICY })
  assert.equal(await section.text({ agent: undefined }), DEFAULT_BASE)
})

test('no planSection configured: plan mode never changes the text', async () => {
  const { section } = register({ text: DEFAULT_BASE })
  const context = agent([{ type: 'plan/mode', data: { active: true } }])
  assert.equal(await section.text(context), DEFAULT_BASE)
})

test('custom text config overrides the default base', async () => {
  const custom = 'Custom persona.'
  const { section } = register({ text: custom })
  assert.equal(await section.text(agent([])), custom)
})

test('includeRuntimeContext false suppresses runtime context snapshots', () => {
  const { suppressed } = register({ text: DEFAULT_BASE, includeRuntimeContext: false })
  assert.equal(suppressed, true)
})

test('includeRuntimeContext default keeps runtime context snapshots', () => {
  const { suppressed } = register({ text: DEFAULT_BASE })
  assert.equal(suppressed, false)
})

test('foldPlanMode: the last plan/mode event wins', () => {
  assert.equal(foldPlanMode([]), false)
  assert.equal(foldPlanMode([{ type: 'plan/mode', data: { active: true } }]), true)
  assert.equal(foldPlanMode([
    { type: 'plan/mode', data: { active: true } },
    { type: 'plan/mode', data: { active: false } },
  ]), false)
  assert.equal(foldPlanMode([
    { type: 'plan/mode', data: { active: false } },
    { type: 'plan/mode', data: { active: true } },
  ]), true)
})
