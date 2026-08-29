/**
 * Escalation-hider guard: at system-prompt assembly time, strip
 * `sandbox_permissions`/`justification` from the model-visible tool schema of
 * escalation-capable tools when escalation cannot succeed for this session —
 * the effective sandbox mode is already at (or above) the configured ceiling,
 * or the approval policy is `never`. The tool registry validates only
 * advertised keys, so removing the fields from the schema is purely cosmetic
 * to the model; execution semantics are untouched, and a model that emits the
 * fields anyway still fails exactly as before (fail-closed).
 *
 * This exists because the fields are advertised whenever a confining executor
 * is mounted, without knowing the session's per-session mode or approval
 * policy — so an agent running at `danger-full-access` under `never` is shown
 * an escalation knob that can never succeed and repeatedly hammers it.
 *
 * @module @deepseek-ai/dsh-escalation-hider
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { effectiveSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { effectiveApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

export const name = 'escalation-hider'

/** The escalation parameter names every escalation-capable tool family shares. */
export const ESCALATION_PARAMETERS = ['sandbox_permissions', 'justification'] as const

/** Mode ordering: hide when the effective mode is at least this wide. Unknown strings rank undefined (never triggers hiding). */
function modeRank(mode: string): number | undefined {
  switch (mode) {
    case 'read-only': return 0
    case 'workspace-write': return 1
    case 'danger-full-access': return 2
    default: return undefined
  }
}

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud).
 */
export interface Config {
  /**
   * Hide escalation parameters when the effective sandbox mode is at least
   * this wide (default `danger-full-access` — the widest mode, where escalation
   * is never a strict widening). Validated against {@link SANDBOX_MODES} at
   * plugin load.
   */
  hideAtOrAboveMode?: string
  /**
   * Hide when the session's approval policy is `never` (escalation can never be
   * approved). Default true.
   */
  hideWhenApprovalNever?: boolean
  /** Tool-name wildcard patterns whose escalation parameters are hidden. */
  tools?: string[]
}

export const Config: z<Config> = z.object({
  hideAtOrAboveMode: z.string().default('danger-full-access'),
  hideWhenApprovalNever: z.boolean().default(true),
  tools: z.array(z.string()).default(['bash', 'pwsh']),
})

/** Compile one `*`-wildcard pattern to an anchored RegExp (other regex metacharacters are literal). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/** Whether escalation can never succeed for this session, per the resolved policies. */
export function shouldHideEscalation(
  mode: SandboxMode | undefined,
  approval: ApprovalPolicy | undefined,
  config: { hideAtOrAboveMode: SandboxMode; hideWhenApprovalNever: boolean },
): boolean {
  if (config.hideWhenApprovalNever && approval === 'never') return true
  if (mode === undefined) return false
  const left = modeRank(mode)
  const right = modeRank(config.hideAtOrAboveMode)
  return left !== undefined && right !== undefined && left >= right
}

/**
 * Strip escalation parameters from every tool whose name matches the patterns.
 * Tools without the parameters (or outside the patterns) pass through untouched.
 */
export function stripEscalationParameters(
  tools: ToolSchema[],
  patterns: string[],
): ToolSchema[] {
  if (patterns.length === 0) return tools
  const matchers = patterns.map(wildcardToRegExp)
  return tools.map((tool) => {
    const matches = matchers.some(pattern => pattern.test(tool.name))
    if (!matches) return tool
    const entries = Object.entries(tool.parameters)
    const kept = entries.filter(([key]) => !ESCALATION_PARAMETERS.includes(key as (typeof ESCALATION_PARAMETERS)[number]))
    if (kept.length === entries.length) return tool
    return { ...tool, parameters: Object.fromEntries(kept) }
  })
}

/**
 * Install the guard's assembly listener.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const hideAtOrAboveMode = (config.hideAtOrAboveMode ?? 'danger-full-access') as SandboxMode
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(hideAtOrAboveMode)) {
    throw new Error(`escalation-hider: invalid hideAtOrAboveMode ${hideAtOrAboveMode}`)
  }
  const hideWhenApprovalNever = config.hideWhenApprovalNever ?? true
  const toolPatterns = config.tools ?? ['bash', 'pwsh']

  ctx.on('system-prompt/assemble', async (_assembly: PromptAssembly, context: AssembleContext, next) => {
    const agent = context.agent
    if (!agent) return next()
    const mode = effectiveSandboxMode(agent.session.events)
    const approval = effectiveApprovalPolicy(agent.session.events)
    if (!shouldHideEscalation(mode, approval, { hideAtOrAboveMode, hideWhenApprovalNever })) return next()
    const transformed = await next()
    return {
      ...transformed,
      tools: stripEscalationParameters(transformed.tools, toolPatterns),
    }
  })
}
