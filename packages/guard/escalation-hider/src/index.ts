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
  tools: z.array(z.string()).default(['bash', 'pwsh', 'edit', 'write']),
})

/** Compile one `*`-wildcard pattern to an anchored RegExp (other regex metacharacters are literal). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Whether escalation can never succeed for this session, per the resolved policies.
 * @param mode - the session's effective sandbox mode, when known.
 * @param approval - the session's effective approval policy, when known.
 * @param config - the plugin's hiding thresholds.
 * @returns true when the session must not be offered the escalation fields.
 */
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

/** Whether a parameter key is one of the escalation fields. */
function isEscalationParameter(key: string): boolean {
  return (ESCALATION_PARAMETERS as readonly string[]).includes(key)
}

/**
 * Strip escalation fields from one `parameters` object, handling both shapes a
 * registered tool's parameters take. `defineTool` compiles the parameter spec
 * into a JSON Schema whose fields live under `properties` (with stripped names
 * also dropped from `required`); hand-built schemas keep a flat field map.
 * Returns the same reference when nothing matched.
 * @param parameters - the tool's parameters object, in either shape.
 * @returns the stripped object, or the input reference when untouched.
 */
function stripEscalationFields(parameters: Record<string, unknown>): Record<string, unknown> {
  const properties = parameters['properties']
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    const keptProperties: Record<string, unknown> = {}
    let removed = 0
    for (const [key, value] of Object.entries(properties)) {
      if (isEscalationParameter(key)) {
        removed += 1
        continue
      }
      keptProperties[key] = value
    }
    if (removed === 0) return parameters
    const next: Record<string, unknown> = { ...parameters, properties: keptProperties }
    const required = parameters['required']
    if (Array.isArray(required)) {
      const keptRequired = required.filter((key): key is string => typeof key === 'string' && !isEscalationParameter(key))
      if (keptRequired.length !== required.length) next['required'] = keptRequired
    }
    return next
  }
  const kept: Record<string, unknown> = {}
  let removed = 0
  for (const [key, value] of Object.entries(parameters)) {
    if (isEscalationParameter(key)) {
      removed += 1
      continue
    }
    kept[key] = value
  }
  return removed === 0 ? parameters : kept
}

/**
 * Strip escalation parameters from every tool whose name matches the patterns.
 * Tools without the parameters (or outside the patterns) pass through untouched.
 * @param tools - the assembled tool schemas to transform.
 * @param patterns - `*`-wildcard tool-name patterns whose escalation fields are removed.
 * @returns the transformed schemas; untouched tools keep their object identity.
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
    const stripped = stripEscalationFields(tool.parameters)
    if (stripped === tool.parameters) return tool
    return { ...tool, parameters: stripped }
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
  const toolPatterns = config.tools ?? ['bash', 'pwsh', 'edit', 'write']

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
