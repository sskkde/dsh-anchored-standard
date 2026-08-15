/**
 * Dynamic complete persona for anchored-standard.
 *
 * Keeps the Minimal-aligned complete system prompt, but re-injects the
 * plan:policy guidance while plan mode is active.
 *
 * Why this plugin exists: the official `@deepseek-ai/dsh-persona` row cannot
 * express this. Its text is static, and the complete-prompt assembly discards
 * every other section AFTER the waterfall has run
 * (`dsh-system-prompt`'s `assemble()` restores the effective complete section
 * as the sole prompt section), so a plan-mode section registered alongside a
 * complete persona — like the `plan:policy` section of `dsh-plan-mode` —
 * never reaches the model. A function `text` is evaluated during assembly
 * and captured as the sole section, which makes the complete persona itself
 * stateful: the plan guidance is part of the persona text while plan mode is
 * active, and absent otherwise.
 *
 * Plan state is folded from the durable session log (`plan/mode`, last one
 * wins), exactly like `@deepseek-ai/dsh-plan-mode`'s foldPlanMode, so resume
 * and reload preserve it. Assembly always runs after a pending selection was
 * appended by the pre-step, so folding the log is sufficient — no in-memory
 * pending mirror is needed.
 *
 * Robustness:
 *  - `complete: true` keeps the Minimal condition: global identity, Web
 *    orientation, tool guidance, and later assembly listeners still cannot
 *    add prompt text, exactly as with the official persona row.
 *  - The plan guidance only appears while plan mode is active, so the
 *    non-plan-mode prompt (and its KV-cache prefix) is byte-identical to the
 *    Minimal preset.
 *  - An assembly outside an agent (cold transcript read) always gets the
 *    base text.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-persona'

/** Prompt assembly must exist before this section can register. */
export const inject = ['systemPrompt']

/** The base text when no `text` config is supplied. */
export const DEFAULT_BASE = 'You are a helpful software engineer assistant.'

/** The section name shadowing the deployment persona (matches dsh-persona). */
export const PERSONA_SECTION = 'deployment:persona'

/** The section order matching dsh-persona. */
export const PERSONA_ORDER = 0

/** Fold the last `plan/mode` event from the durable session log. */
export function foldPlanMode(events) {
  let active = false
  for (const event of events) {
    if (event.type === 'plan/mode') active = event.data.active
  }
  return active
}

/** Register the stateful complete persona for the mounting scope. */
export function apply(ctx, config) {
  const base = typeof config.text === 'string' && config.text.length > 0
    ? config.text
    : DEFAULT_BASE
  const policy = typeof config.planSection === 'string' ? config.planSection : ''
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()

  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: PERSONA_ORDER,
    text: (context) => {
      const agent = context.agent
      if (agent === undefined || policy === '') return base
      return foldPlanMode(agent.session.events) ? `${base}\n\n${policy}` : base
    },
    complete: true,
  }), 'anchored-persona.section()')
}
