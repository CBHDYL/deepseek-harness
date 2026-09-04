/**
 * Fork-era session event vocabulary retained for READ compatibility
 * (P-EVENTS). The fork's deployed harness wrote these types into real
 * sessions; this port no longer produces them. They stay in the known-event
 * vocabulary so stored fork-written sessions reopen, validate, replay, and
 * accept later appends without a whole-log refusal. None of them has an
 * active consumer: replay treats them as audit-only history, and the
 * compatibility guarantee is preservation (order, seq, payload) — never
 * re-derived behavior.
 *
 * Classifications:
 * - COMPATIBILITY-ONLY (must read/persist, no active behavior):
 *   `reasoning-chunks`, `job/start`, `job/end`.
 * - AUDIT / IGNORABLE (order and payload preserved, no business action):
 *   `request/attempt-start`, `request/attempt-end`.
 *
 * The declared payload types are the exact fork-era shapes; a stored event
 * that does not carry one of these shapes is malformed, not a different
 * vocabulary (the corruption classification still applies).
 *
 * @module @deepseek-ai/dsh-session/compat-event-types
 */

export interface ReasoningChunksEventData {
  /** The turn the packed reasoning run belongs to. */
  turn: number
  /** The step the packed reasoning run belongs to. */
  step: number
  /** The block index inside the step's chunk stream. */
  index: number
  /** Per-member timestamp gaps, matching the fork-era packed-row codec. */
  dt: number[]
  /** One token boundary per member, never joined. */
  texts: string[]
}

export interface JobStartEventData {
  /** Fork-era process-local job identity. */
  jobId: string
  /** Job kind recorded by the fork's orchestration journal. */
  kind: string
  /** Human-readable job label recorded at start. */
  label: string
}

export interface JobEndEventData {
  /** Fork-era process-local job identity, matching the paired `job/start`. */
  jobId: string
  /** Terminal settlement the fork's journal recorded. */
  status: 'completed' | 'failed' | 'killed'
  /** Optional settlement detail (e.g. the signal that killed the job). */
  detail?: string
  /** Epoch milliseconds of the settlement. */
  finishedAt: number
}

export interface RequestAttemptStartEventData {
  /** Turn of the fork-era attempt ledger. */
  turn: number
  /** Step of the fork-era attempt ledger. */
  step: number
  /** 1-based attempt number (including retries). */
  attempt: number
  /** Provider the attempt streamed from. */
  provider: string
  /** Model the attempt streamed from. */
  model: string
}

export interface RequestAttemptEndEventData {
  /** Turn of the fork-era attempt ledger. */
  turn: number
  /** Step of the fork-era attempt ledger. */
  step: number
  /** 1-based attempt number, matching the paired `request/attempt-start`. */
  attempt: number
  /** Terminal outcome the fork recorded. */
  outcome: 'ok' | 'throw' | 'retry' | 'retry-exhausted'
  /** Failure payload for non-`ok` outcomes; preserved verbatim, never interpreted. */
  failure?: Record<string, unknown>
}

/** The complete fork-era compatibility vocabulary restored by P-EVENTS. */
export const COMPATIBILITY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'reasoning-chunks',
  'job/start',
  'job/end',
  'request/attempt-start',
  'request/attempt-end',
])

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Fork-era packed reasoning run retained as a log record. Compatibility-only:
     * no consumer rebuilds chunks from it, and it never re-enters the model
     * history.
     */
    'reasoning-chunks': ReasoningChunksEventData
    /**
     * Fork-era background-job open marker. Compatibility-only: the job
     * registry itself is process-local and is never reconstructed.
     */
    'job/start': JobStartEventData
    /**
     * Fork-era background-job terminal settlement, paired with `job/start`.
     * Compatibility-only: recorded order and payload are preserved.
     */
    'job/end': JobEndEventData
    /**
     * Fork-era model-request attempt open marker from the retry ledger.
     * Audit/ignorable: replay keeps the record and takes no business action.
     */
    'request/attempt-start': RequestAttemptStartEventData
    /**
     * Fork-era model-request attempt terminal outcome. Audit/ignorable: replay
     * keeps the record and takes no business action.
     */
    'request/attempt-end': RequestAttemptEndEventData
  }
}
