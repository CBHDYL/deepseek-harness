/**
 * Advisory per-agent repeat-call detector. It enriches post-execute decisions
 * with logged model context without vetoing or rewriting calls. Configuration
 * and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'repeat-tool-reminder'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
  /**
   * Optional circuit breaker: after this many consecutive identical calls —
   * or consecutive calls failing with the same failure fingerprint, even when
   * arguments differ — the guard DENIES the call before dispatch (identical
   * arguments) or blocks its result with breaker feedback (same-failure run).
   * Default undefined = advisory reminders only (fully backward compatible).
   */
  vetoAt?: number
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(500),
  // schemastery has no optional/int combinators; 0 is the "disabled" sentinel
  // for the circuit breaker (validated in apply).
  vetoAt: z.number().default(0),
})

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

/**
 * Circuit-breaker feedback text. Delivered as the call's error result when
 * `vetoAt` is configured and the same call (or the same failure) repeats past
 * the threshold — the model sees this instead of a silent retry.
 */
function vetoFeedback(toolName: string, count: number, dimension: 'identical' | 'failure'): string {
  return `Circuit breaker: ${toolName} has been invoked ${count} times with the same ${dimension === 'identical' ? 'arguments in a row' : 'failure in a row'} `
    + `(vetoAt=${count}). This call was ${dimension === 'identical' ? 'denied before dispatch' : 'blocked after it failed again'}. `
    + 'Do not call this tool the same way again. Inspect the latest result, choose a different '
    + 'action or different arguments, or finish the task.'
}

/**
 * Normalize a failure message into a stable fingerprint: quoted values (paths,
 * arguments, modes) are collapsed and whitespace is flattened, so the same
 * semantic failure with different embedded values — e.g. a sandbox escalation
 * error whose quoted modes or justification wording drift — still fingerprints
 * identically, while genuinely different failures reset the chain.
 */
function normalizeFailureMessage(message: string): string {
  return message.replace(/"[^"]*"/g, '""').replace(/\s+/g, ' ').trim()
}

/**
 * The failure dimension of a call result: `code:…` when the failure carries a
 * structured HarnessError code, else `msg:…` over the normalized message.
 * Successful results have no fingerprint — they never advance the failure chain.
 */
function failureFingerprint(result: ToolExecutionResult): string | undefined {
  if (!result.isError) return undefined
  if (result.error.info?.code) return `code:${result.error.info.code}`
  return `msg:${normalizeFailureMessage(result.error.message)}`
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/** Validate the optional circuit-breaker threshold (fail-loud, like `thresholds`); 0/undefined = disabled. */
function validateVetoAt(value: number | undefined): number | undefined {
  if (value === undefined || value === 0) return undefined
  if (!Number.isInteger(value) || value < 2) {
    throw new Error(`repeat-tool-reminder: invalid vetoAt ${value} — must be an integer >= 2`)
  }
  return value
}

/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata. A missing reminder (the circuit breaker can trip on the
 * failure dimension at a count below the reminder thresholds) contributes
 * nothing — an `undefined` entry would not survive the tool-result snapshot.
 */
function prependContext(ours: UserMessage | undefined, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []].filter((message): message is UserMessage => message !== undefined)
}

/** One agent's consecutive-repeat chain: the last tracked call's identity key and its run length. */
interface Chain {
  key: string
  count: number
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const thresholds = validateThresholds(config.thresholds as number[])
  const vetoAt = validateVetoAt(config.vetoAt)
  const thresholdSet = new Set(thresholds)
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)
  const argumentsPreviewChars = config.argumentsPreviewChars as number
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }

  const chains = new WeakMap<Agent, Chain>()
  const failureChains = new WeakMap<Agent, Chain>()

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /** Advance one chain for one call; returns the run length after this call. */
  function advance(store: WeakMap<Agent, Chain>, agent: Agent, key: string): number {
    const chain = store.get(agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    store.set(agent, { key, count })
    return count
  }

  /**
   * Advance the calling agent's chains for one attempt and return the reminder
   * to deliver, if this attempt's run length hits a configured threshold, plus
   * the veto decision for the circuit breaker. Counting happens here — in
   * post-execute — because denied calls also flow through this waterfall
   * (`ToolRuntime.execute` routes a deny through the same pipeline), and a
   * model hammering a denied call is exactly the loop worth breaking.
   */
  function observe(exec: ToolExecution, result: ToolExecutionResult): {
    reminder: UserMessage | undefined
    shouldVeto: boolean
  } {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent || !tracked(exec.name)) return { reminder: undefined, shouldVeto: false }
    const canonical = canonicalize(exec.arguments)
    const argsKey = JSON.stringify([exec.name, canonical])
    const argsCount = advance(chains, exec.agent, argsKey)
    const fingerprint = failureFingerprint(result)
    const failureCount = fingerprint === undefined
      ? 0
      : advance(failureChains, exec.agent, JSON.stringify([exec.name, fingerprint]))
    let reminder: UserMessage | undefined
    if (thresholdSet.has(argsCount)) {
      const text = argsCount === thresholds[0]
        ? GENTLE_REMINDER
        : detailedReminder(exec.name, argsCount, previewArguments(canonical, argumentsPreviewChars))
      reminder = createUserMessage({
        content: [{ type: 'text', text }],
        source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} × ${argsCount}` },
      })
    }
    const peak = Math.max(argsCount, failureCount)
    const shouldVeto = vetoAt !== undefined && peak >= vetoAt
    return { reminder, shouldVeto }
  }

  // Circuit breaker, identical-arguments dimension: deny the Nth identical call
  // BEFORE dispatch so the repeated work (and its failure) never happens.
  if (vetoAt !== undefined) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!exec.agent || !tracked(exec.name)) return next()
      const canonical = canonicalize(exec.arguments)
      const key = JSON.stringify([exec.name, canonical])
      const chain = chains.get(exec.agent)
      const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
      if (count < vetoAt) return next()
      return {
        kind: 'deny',
        reason: vetoFeedback(exec.name, count, 'identical'),
      }
    })
  }

  // Observe-and-enrich, veto only when the breaker tripped: count first (state
  // advances regardless of the downstream outcome), DELEGATE so a later
  // listener can still block or replace, then fold the reminder onto whatever
  // came back — additionalContexts rides both decision variants, so a blocked
  // call still gets the nudge. The failure dimension cannot be denied in
  // pre-execute (the outcome is unknowable), so a tripped failure chain blocks
  // the completed call's result with breaker feedback instead.
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const { reminder, shouldVeto } = observe(exec, result)
    const downstream = await next()
    if (!reminder && !shouldVeto) return downstream
    if (shouldVeto) {
      const agent = exec.agent
      const feedback = vetoFeedback(exec.name, Math.max(
        agent !== undefined ? (chains.get(agent)?.count ?? 1) : 1,
        agent !== undefined ? (failureChains.get(agent)?.count ?? 1) : 1,
      ), 'failure')
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: feedback }],
        additionalContexts: prependContext(reminder, downstream.additionalContexts),
      }
    }
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })

  // A user interjection changes the context; repetition across it is not a
  // loop. Pure reset hook: always delegates (attaching nothing, vetoing
  // nothing).
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) chains.delete(agent)
    return next()
  })
}
