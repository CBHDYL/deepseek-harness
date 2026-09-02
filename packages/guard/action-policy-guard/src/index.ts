/**
 * Action-policy guard: a central mandatory action-policy interceptor. Today
 * approval/sandbox governance only covers calls that OPT IN by requesting
 * approval inside the tool body — a tool or hook that performs a sensitive
 * action without requesting approval bypasses the policy entirely. This guard
 * moves the decision to `tools/pre-execute`: every tool call is gated through
 * the approval seam. Tools that declare `effects: 'read-only'` on their
 * shipped definition skip the gate; tools declaring `'side-effectful'` and
 * tools with no declaration (the `treatUndeclaredAsSideEffectful` default)
 * fold through it. MCP/self-declared effects are never trusted: the
 * classification is read from the tool registry's shipped `ToolDefinition`.
 *
 * `observe` mode (default) only logs, so enabling it first surfaces which
 * tools are ungoverned without changing behavior; `enforce` mode denies any
 * side-effectful call whose approval is not granted once. The gate folds with
 * the downstream waterfall under deny > ask > allow, so a hook-side denial
 * always wins and the scheduler's single approval point asks at most once;
 * the one-shot exact-binding grant is consumed by the tool registry at the
 * dispatch boundary (this plugin never mints or consumes grants itself).
 *
 * @module @deepseek-ai/dsh-action-policy-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
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
    toolCtx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      // The declared classification lives on the SHIPPED tool definition, read
      // from the registry — MCP/self-declared sources never populate `effects`.
      const declared = toolCtx.tools.get(exec.name, exec.agent)?.effects
      const effectSource: ActionPolicyEffectSource | undefined = declared === 'side-effectful'
        ? 'declared'
        : declared === 'read-only'
          ? undefined
          : treatUndeclared
            ? 'undeclared'
            : undefined
      const mine: PreToolDecision = effectSource === undefined
        ? { kind: 'allow' }
        : mode === 'observe'
          ? (observeCandidate(toolCtx, exec, effectSource), { kind: 'allow' as const })
          : enforceDecision(toolCtx, exec)

      const downstream = await next()
      // Cooperative fold: deny > ask > allow, independent of registration
      // order across every source that also delegates (the hooks bridges).
      if (mine.kind === 'deny' || downstream.kind === 'deny') {
        return { kind: 'deny', reason: mine.kind === 'deny' ? mine.reason : downstream.kind === 'deny' ? downstream.reason : 'blocked by action policy' }
      }
      if (mine.kind === 'ask' || downstream.kind === 'ask') {
        const reason = mine.kind === 'ask' ? mine.reason : downstream.kind === 'ask' ? downstream.reason : undefined
        return reason === undefined ? { kind: 'ask' } : { kind: 'ask', reason }
      }
      return { kind: 'allow' }
    })
  })
}

/** Observe mode: log the ungoverned candidate without changing the decision. */
function observeCandidate(
  toolCtx: Context,
  exec: ToolExecution,
  effectSource: ActionPolicyEffectSource,
): void {
  if (exec.agent !== undefined) {
    const candidate: ActionPolicyCandidateEventData = {
      toolName: exec.name,
      callId: exec.callId,
      effectSource,
    }
    exec.agent.session.append('action-policy/candidate', candidate)
  }
  toolCtx.logger.warn(
    `action-policy: side-effectful tool "${exec.name}" invoked without an approval gate (observe mode; declare effects: read-only to exempt)`,
  )
}

/** Enforce mode: fail-closed structurally; the exact grant binds at dispatch. */
function enforceDecision(toolCtx: Context, exec: ToolExecution): PreToolDecision {
  const approval = toolCtx.get('approval')
  if (approval === undefined) {
    return {
      kind: 'deny',
      reason: `action-policy: tool "${exec.name}" is side-effectful but no approval service is composed`,
    }
  }
  if (exec.agent === undefined) {
    return {
      kind: 'deny',
      reason: `action-policy: tool "${exec.name}" requires approval but the call has no agent`,
    }
  }
  return {
    kind: 'ask',
    reason: `action-policy: side-effectful tool "${exec.name}" requires approval`,
  }
}
