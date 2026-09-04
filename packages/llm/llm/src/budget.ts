/**
 * P-BUDGET: the exact dispatched-envelope UTF-8 byte measurement shared by the
 * runtime's provider-dispatch boundary. The measurement prices the EXACT
 * model-facing fields about to be dispatched (`messages`, `system`, `tools`) —
 * never a pre-transform or partial representation — so the hard byte ceiling
 * is normative at the provider boundary.
 * @module @deepseek-ai/dsh-llm/budget
 */

/**
 * Default hard request byte ceiling. Deliberately above realistic usage so the
 * ceiling bounds abuse, not ordinary long sessions. Product constant — the
 * ported PR6 prescribes the mechanism, not the number; a stricter bound is the
 * consumer's own seam (e.g. the summarizer's independent allowance).
 */
export const DEFAULT_MAX_REQUEST_BYTES = 4 * 1024 * 1024

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
