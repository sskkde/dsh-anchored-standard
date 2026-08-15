/**
 * Zero-tool bootstrap — keep the FIRST top-level model request on an EMPTY
 * tool surface, then expose the full preset catalog once the anchor turn has
 * produced its first durable assistant message.
 *
 * This is the extra test mode behind `zero-anchored-standard`: the anchor
 * plugin seeds a fixed user message and this filter strips the whole catalog,
 * so the first real request follows the zero-injection "we" trajectory. After
 * that assistant response is durable, every later request sees the full
 * Standard catalog.
 *
 * While bootstrapping, first-step workspace reminders are stripped too:
 * dsh-agent-instructions (AGENTS.md) and dsh-tool-skill (skill catalog)
 * inject durable user messages through `agent/pre-step`, and without a final
 * filter the anchor turn would carry them while Minimal mode does not. The
 * listeners below register with `{ prepend: true }`, which makes this plugin
 * the OUTERMOST waterfall listener: Cordis runs after-next transforms in
 * reverse hook order, so only an outermost filter is guaranteed to run after
 * every other preset row has injected. Row order alone is not a guarantee
 * because preset rows are started through `Promise.allSettled`.
 *
 * Robustness:
 *  - Promotion decisions are memoized per session id for this process; the
 *    durable event scan runs once per session per process, then O(1).
 *  - Subagents and non-top-level agents always see the full catalog: their
 *    first request must be able to call tools.
 *  - A filter failure degrades to the full catalog with a one-time warning,
 *    so a bug can never brick every request of a session.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'zero-tool-bootstrap'

/** Prompt assembly must exist before this request filter can register. */
export const inject = ['systemPrompt']

/** First-step injected reminders that must not reach the zero-tool anchor request. */
const BOOTSTRAP_INJECTED_SOURCE_KINDS = new Set(['skill-catalog', 'agent-instructions'])

/** Register the per-session bootstrap filter. */
export function apply(ctx) {
  /** Sessions already promoted in this process. Promotion is append-only, so a Set is sound. */
  const promoted = new Set()
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid spamming.
    }
  }

  /**
   * Whether the session has reached the promoted (full-catalog) phase.
   * @param agent - the assembly context's agent, or undefined outside an agent.
   */
  const isPromoted = (agent) => {
    if (agent === undefined) return true
    const session = agent.session
    if (session === undefined) return true
    // Subagents keep their full catalog from their very first request.
    if ((session.header.delegationDepth ?? 0) > 0) return true
    if (promoted.has(session.id)) return true
    const hit = session.events.some((event) => event.type === 'assistant/message')
    if (hit) promoted.add(session.id)
    return hit
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    try {
      if (isPromoted(context.agent)) return assembled
      return { ...assembled, tools: [] }
    } catch (error) {
      // A filter bug must never brick a session: degrade to the full catalog.
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error && error.message) || error)}`)
      return assembled
    }
  }, { prepend: true })

  // Strip first-step injected reminders (skill catalog, AGENTS.md) during
  // bootstrap. `{ prepend: true }` keeps this filter outermost so its
  // after-next transform is the final word after every other listener has
  // injected; without it dsh-agent-instructions can re-add AGENTS.md to the
  // anchor request.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (isPromoted(payload.agent)) return decision
    return {
      ...decision,
      messages: decision.messages.filter((message) => !BOOTSTRAP_INJECTED_SOURCE_KINDS.has(message.source?.kind)),
    }
  }, { prepend: true })
}
