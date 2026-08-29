/**
 * Action-policy guard: a central mandatory action-policy interceptor. Today
 * approval/sandbox governance only covers calls that OPT IN by requesting
 * approval inside the tool body — a tool or hook that performs a sensitive
 * action without requesting approval bypasses the policy entirely. This guard
 * moves the decision to `tools/pre-execute`: tools whose declared effect is
 * not `read-only` (undeclared tools count as side-effectful by default) are
 * gated through the approval seam for every call.
 *
 * `observe` mode (default) only logs, so enabling it first surfaces which
 * tools are ungoverned without changing behavior; `enforce` mode denies any
 * side-effectful call whose approval is not granted once.
 *
 * @module @deepseek-ai/dsh-action-policy-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'

export const name = 'action-policy-guard'

/** Plugin config, validated fail-loud in `apply`. */
export interface Config {
  /**
   * `observe` (default) logs ungoverned side-effectful calls and delegates;
   * `enforce` requires an `allowed-once` approval for every side-effectful
   * call before it runs (fail-closed when no approval service is composed).
   * Validated against `observe`/`enforce` at plugin load.
   */
  mode?: string
  /**
   * Treat tools without a declared `effects` as side-effectful (default
   * true). `false` restricts the gate to tools that explicitly declare
   * `effects: 'side-effectful'`.
   */
  treatUndeclaredAsSideEffectful?: boolean
}

export const Config: z<Config> = z.object({
  mode: z.string().default('observe'),
  treatUndeclaredAsSideEffectful: z.boolean().default(true),
})

/**
 * Install the guard's pre-execute interceptor.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const mode = config.mode ?? 'observe'
  if (mode !== 'observe' && mode !== 'enforce') {
    throw new Error(`action-policy-guard: invalid mode ${mode} — must be "observe" or "enforce"`)
  }
  const treatUndeclared = config.treatUndeclaredAsSideEffectful ?? true

  // The interceptor reads the tool registry, so it runs inside a tools-scoped
  // child context (the same injection the tool-facing plugins use).
  ctx.inject(['tools'], (toolCtx: Context) => {
    toolCtx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      const tool = exec.agent === undefined ? undefined : toolCtx.tools.get(exec.name, scopeOf(exec.agent.ctx))
      const effects = tool?.effects
      const effectful = effects === 'side-effectful'
        || (effects === undefined && treatUndeclared)
      if (!effectful) return next()

      if (mode === 'observe') {
        toolCtx.logger.warn(
          `action-policy: side-effectful tool "${exec.name}" invoked without an approval gate (observe mode; declare effects: read-only to exempt)`,
        )
        return next()
      }

      const approval = toolCtx.get('approval')
      if (approval === undefined) {
        return {
          kind: 'deny',
          reason: `action-policy: tool "${exec.name}" is side-effectful but no approval service is composed`,
        }
      }
      if (exec.agent === undefined) {
        return { kind: 'deny', reason: `action-policy: tool "${exec.name}" requires approval but the call has no agent` }
      }
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: exec.name,
        callId: exec.callId,
        reason: `action-policy: side-effectful tool "${exec.name}" requires approval`,
      })
      if (outcome === 'allowed-once') return next()
      return { kind: 'deny', reason: `action-policy: tool "${exec.name}" approval ${outcome}` }
    })
  })
}
