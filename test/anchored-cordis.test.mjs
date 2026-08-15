import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { apply as applyBootstrap } from '../anchored-cordis/tool-bootstrap.mjs'
import { DEFAULT_BASE, apply, foldPlanMode, name } from '../anchored-cordis/anchored-persona.mjs'

const COMPOSITION = readFileSync(new URL('../anchored-cordis/agent.cordis.yml', import.meta.url), 'utf8')

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

test('anchored-cordis exports the dynamic persona plugin', () => {
  assert.equal(name, 'anchored-persona')
})

test('anchored-cordis bootstrap registers every waterfall listener with prepend', () => {
  const options = {}
  const ctx = {
    on(event, callback, listenerOptions) {
      options[event] = listenerOptions
    },
  }
  applyBootstrap(ctx, { commonTools: ['read'], shellTools: ['bash', 'pwsh'] })
  assert.deepEqual(options, {
    'system-prompt/assemble': { prepend: true },
    'agent/request': { prepend: true },
    'agent/pre-step': { prepend: true },
  })
})

test('anchored-cordis: no plan-mode events keeps the base text', async () => {
  const { section } = register({ text: DEFAULT_BASE })
  assert.equal(await section.text(agent([])), DEFAULT_BASE)
})

test('anchored-cordis: plan mode active appends the policy', async () => {
  const policy = 'PLAN POLICY'
  const { section } = register({ text: DEFAULT_BASE, planSection: policy })
  const context = agent([{ type: 'plan/mode', data: { active: true } }])
  assert.equal(await section.text(context), `${DEFAULT_BASE}\n\n${policy}`)
})

test('anchored-cordis: plan mode state folds from the durable log', () => {
  assert.equal(foldPlanMode([{ type: 'plan/mode', data: { active: true } }]), true)
  assert.equal(foldPlanMode([
    { type: 'plan/mode', data: { active: true } },
    { type: 'plan/mode', data: { active: false } },
  ]), false)
})

test('anchored-cordis: runtime context suppression is configurable', () => {
  assert.equal(register({ text: DEFAULT_BASE, includeRuntimeContext: false }).suppressed, true)
  assert.equal(register({ text: DEFAULT_BASE }).suppressed, false)
})

test('composition: tool-bootstrap row sits FIRST, before the persona', () => {
  const bootstrap = COMPOSITION.indexOf('- id: tool-bootstrap')
  const persona = COMPOSITION.indexOf('- id: persona')
  assert.ok(bootstrap >= 0, 'tool-bootstrap row present')
  assert.ok(persona >= 0, 'persona row present')
  assert.ok(bootstrap < persona, 'bootstrap registered before persona (waterfall strip order)')
})

test('composition: persona uses the dynamic complete plugin', () => {
  assert.match(COMPOSITION, /- id: persona\n  name: \.\/anchored-persona\.mjs/)
  assert.match(COMPOSITION, /includeRuntimeContext: false/)
  // complete is implied by the plugin; the row must not carry a static text-only persona.
  assert.ok(!COMPOSITION.includes("name: '@deepseek-ai/dsh-persona'"), 'no static dsh-persona row')
})

test('composition: persona base is the Minimal text (trajectory condition)', () => {
  assert.match(COMPOSITION, /text: You are a helpful software engineer assistant\./)
  // The Cordis authoring identity is NOT in the persona: it would change the
  // first-request trajectory the bootstrap exists to anchor. The authoring
  // skills travel with the preset and load through tool-skill after promotion.
  assert.ok(!COMPOSITION.includes('Two planes decide where an edit belongs'), 'no Cordis identity prose in the persona')
})

test('composition: bootstrap carries the full anchored config', () => {
  assert.match(COMPOSITION, /shellTools: \[bash, pwsh\]/)
  assert.match(COMPOSITION, /commonTools: \[read\]/)
  assert.match(COMPOSITION, /promoteOn: either/)
  assert.match(COMPOSITION, /bootstrapMaxTokens: 1024/)
})

test('composition: Cordis self-modification and skills are preserved', () => {
  assert.match(COMPOSITION, /- id: tool-cordis\n  name: '@deepseek-ai\/dsh-tool-cordis'/)
  assert.match(COMPOSITION, /customSkillDirs:/)
  assert.match(COMPOSITION, /new URL\('skills\/', baseUrl\)/)
  assert.match(COMPOSITION, /- id: tool-skill\n  name: '@deepseek-ai\/dsh-tool-skill'/)
})

test('composition: planSection mirrors the plan-mode section', () => {
  const planSection = COMPOSITION.indexOf('planSection: |-')
  const planModeSection = COMPOSITION.indexOf('section: |')
  assert.ok(planSection >= 0, 'planSection present')
  assert.ok(planModeSection > planSection, 'plan-mode section present after planSection')
  // Both carry the same policy opening sentence.
  const needle = 'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds'
  assert.equal(COMPOSITION.split(needle).length - 1, 2, 'policy text present in both planSection and plan-mode section')
})

test('composition: plan mode, compaction, delegation rows survive', () => {
  for (const needle of [
    "- id: plan-mode\n      name: '@deepseek-ai/dsh-plan-mode'",
    "- id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'",
    "- id: tool-subagent\n      name: '@deepseek-ai/dsh-tool-subagent'",
    "- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'",
    "- id: tool-goal\n  name: '@deepseek-ai/dsh-tool-goal'",
  ]) {
    assert.ok(COMPOSITION.includes(needle), `row present: ${needle.split('\n')[0]}`)
  }
})

test('skills travel with the preset', () => {
  assert.ok(existsSync(new URL('../anchored-cordis/skills/cordis-plugin-development/SKILL.md', import.meta.url)))
  assert.ok(existsSync(new URL('../anchored-cordis/skills/editing-cordis-compositions/SKILL.md', import.meta.url)))
})
