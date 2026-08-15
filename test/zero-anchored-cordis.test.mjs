import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { apply as applyAnchor, name as anchorName } from '../zero-anchored-cordis/anchor-turn.mjs'
import { apply as applyZero, name as zeroName } from '../zero-anchored-cordis/zero-tool-bootstrap.mjs'

const COMPOSITION = readFileSync(new URL('../zero-anchored-cordis/agent.cordis.yml', import.meta.url), 'utf8')

test('zero-anchored-cordis ships the zero-tool plugins', () => {
  assert.equal(zeroName, 'zero-tool-bootstrap')
  assert.equal(anchorName, 'anchor-turn')
  assert.equal(typeof applyZero, 'function')
  assert.equal(typeof applyAnchor, 'function')
})

test('zero-anchored-cordis bootstrap registers every waterfall listener with prepend', () => {
  const options = {}
  applyZero({
    on(event, callback, listenerOptions) {
      options[event] = listenerOptions
    },
    logger: { warn() {} },
  })
  assert.deepEqual(options, {
    'system-prompt/assemble': { prepend: true },
    'agent/pre-step': { prepend: true },
  })
})

test('composition: zero-tool-bootstrap and anchor-turn rows are present', () => {
  assert.match(COMPOSITION, /- id: zero-tool-bootstrap\n  name: \.\/zero-tool-bootstrap\.mjs/)
  assert.match(COMPOSITION, /- id: anchor-turn\n  name: \.\/anchor-turn\.mjs/)
})

test('composition: no tool-bootstrap row (two-tool variant is replaced)', () => {
  assert.ok(!COMPOSITION.includes('- id: tool-bootstrap'), 'no tool-bootstrap row')
  assert.ok(!COMPOSITION.includes('bootstrapMaxTokens'), 'no maxTokens bootstrap config')
})

test('composition: persona is the Minimal complete persona with planSection', () => {
  assert.match(COMPOSITION, /- id: persona\n  name: \.\/anchored-persona\.mjs/)
  assert.match(COMPOSITION, /text: You are a helpful software engineer assistant\./)
  assert.match(COMPOSITION, /includeRuntimeContext: false/)
  assert.match(COMPOSITION, /planSection: \|-\n      You are in plan mode\./)
})

test('composition: planSection mirrors the plan-mode section', () => {
  const planSection = COMPOSITION.indexOf('planSection: |-')
  const planModeSection = COMPOSITION.indexOf('section: |')
  assert.ok(planSection >= 0, 'planSection present')
  assert.ok(planModeSection > planSection, 'plan-mode section present after planSection')
  const needle = 'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds'
  assert.equal(COMPOSITION.split(needle).length - 1, 2, 'policy text present in both planSection and plan-mode section')
})

test('composition: Cordis self-modification and skills are preserved', () => {
  assert.match(COMPOSITION, /- id: tool-cordis\n  name: '@deepseek-ai\/dsh-tool-cordis'/)
  assert.match(COMPOSITION, /customSkillDirs:/)
  assert.match(COMPOSITION, /new URL\('skills\/', baseUrl\)/)
  assert.match(COMPOSITION, /- id: tool-skill\n  name: '@deepseek-ai\/dsh-tool-skill'/)
})

test('composition: Standard machinery survives', () => {
  for (const needle of [
    "- id: plan-mode\n      name: '@deepseek-ai/dsh-plan-mode'",
    "- id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'",
    "- id: tool-subagent\n      name: '@deepseek-ai/dsh-tool-subagent'",
    "- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'",
    "- id: tool-goal\n  name: '@deepseek-ai/dsh-tool-goal'",
    "- id: tool-jobs\n  name: '@deepseek-ai/dsh-tool-jobs'",
  ]) {
    assert.ok(COMPOSITION.includes(needle), `row present: ${needle.split('\n')[0]}`)
  }
})

test('skills travel with the preset', () => {
  assert.ok(existsSync(new URL('../zero-anchored-cordis/skills/cordis-plugin-development/SKILL.md', import.meta.url)))
  assert.ok(existsSync(new URL('../zero-anchored-cordis/skills/editing-cordis-compositions/SKILL.md', import.meta.url)))
})
