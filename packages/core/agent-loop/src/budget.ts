/**
 * PR-6 prompt-budget constants and the exact dispatched-envelope UTF-8 byte
 * measurement shared by the agent-loop's request boundary. The measurement
 * prices the EXACT model-facing fields about to be dispatched (`messages`,
 * `system`, `tools`) — never a pre-transform or partial representation — so
 * the hard byte ceiling is normative at the provider boundary.
 * @module dsh-agent-loop/budget
 */

/**
 * Default hard request byte ceiling. Deliberately above realistic usage so the
 * ceiling bounds abuse, not ordinary long sessions; deployments may lower it
 * via the loop config. PR-6 product constant — the Design Review prescribes
 * the mechanism, not the number.
 */
export const DEFAULT_MAX_REQUEST_BYTES = 4 * 1024 * 1024

/** Default recovery retries per step when a budget rejection is answered by compaction. */
export const DEFAULT_BUDGET_COMPACTION_RETRIES = 1

/** The exact dispatched model-facing envelope priced by the byte ceiling. */
export interface RequestBudgetEnvelope {
  /** The exact messages about to be dispatched, in order. */
  messages: readonly unknown[]
  /** The rendered system prompt, when present. */
  system?: string
  /** The model-facing tool schemas, when present and non-empty. */
  tools?: readonly unknown[]
}

/**
 * Measure the exact dispatched envelope in UTF-8 bytes via `TextEncoder`
 * (never `string.length`): the normative oracle for the hard byte ceiling.
 * @param envelope - the assembled model-facing request fields.
 * @returns exact UTF-8 byte count of the JSON-serialized envelope.
 */
export function measureRequestBytes(envelope: RequestBudgetEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(envelope)).length
}
