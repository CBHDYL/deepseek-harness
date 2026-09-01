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
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'
import type { ActionPolicyCandidateEventData, ActionPolicyEffectSource } from './types.ts'

export type { ActionPolicyCandidateEventData, ActionPolicyEffectSource } from './types.ts'

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
    // Monotonic deny fence: a `tools.guard()` denial cannot be overridden by
    // a later allow, so the enforce fence holds even if a user profile mounts
    // an allow-bridging hooks listener after this guard. The fence reads the
    // registry's frozen identity record and verifies the exact execution
    // object's grant (WeakMap provenance): a captured operation id, a mutated
    // live execution, or a different attempt can never satisfy it. The guard
    // is NOT a second approval system: the ask runs through the single
    // scheduler approval point, and this fence only verifies.
    toolCtx.tools.guard((exec) => {
      if (mode !== 'enforce') return undefined
      const identity = toolCtx.tools.identityOf(exec)
      if (identity === undefined) return 'action-policy: unrecognized tool execution identity'
      const tool = identity.agent === undefined ? undefined : toolCtx.tools.get(identity.name, scopeOf(identity.agent.ctx))
      const effects = tool?.effects
      const sideEffectful = effects === 'side-effectful' || (effects === undefined && treatUndeclared)
      if (!sideEffectful) return undefined
      const approval = toolCtx.get('approval')
      if (approval?.isAuthorized(exec) === true) return undefined
      return `action-policy: side-effectful tool "${identity.name}" requires approval`
    })

    // Mandatory security recommendation: registered on the registry-owned
    // policy collection, where no listener can short-circuit another and all
    // recommendations aggregate under deny > ask > allow. In enforce mode a
    // side-effectful call without a composed approval service or without an
    // agent denies; otherwise it asks exactly once through the scheduler's
    // single approval point.
    toolCtx.tools.policy((exec) => {
      const identity = toolCtx.tools.identityOf(exec)
      if (identity === undefined) {
        return { kind: 'deny', reason: 'action-policy: unrecognized tool execution identity' }
      }
      const tool = identity.agent === undefined ? undefined : toolCtx.tools.get(identity.name, scopeOf(identity.agent.ctx))
      const effects = tool?.effects
      const effectSource: ActionPolicyEffectSource | undefined = effects === 'side-effectful'
        ? 'declared'
        : effects === undefined && treatUndeclared ? 'undeclared' : undefined
      if (effectSource === undefined) return { kind: 'allow' }

      if (mode === 'observe') {
        if (identity.agent !== undefined) {
          const candidate: ActionPolicyCandidateEventData = {
            toolName: identity.name,
            callId: identity.callId,
            effectSource,
          }
          identity.agent.session.append('action-policy/candidate', candidate, { ignorable: true })
        }
        toolCtx.logger.warn(
          `action-policy: side-effectful tool "${identity.name}" invoked without an approval gate (observe mode; declare effects: read-only to exempt)`,
        )
        return { kind: 'allow' }
      }

      const approval = toolCtx.get('approval')
      if (approval === undefined) {
        return {
          kind: 'deny',
          reason: `action-policy: tool "${identity.name}" is side-effectful but no approval service is composed`,
        }
      }
      if (identity.agent === undefined) {
        return {
          kind: 'deny',
          reason: `action-policy: tool "${identity.name}" requires approval but the call has no agent`,
        }
      }
      return {
        kind: 'ask',
        reason: `action-policy: side-effectful tool "${identity.name}" requires approval`,
      }
    })
  })
}
