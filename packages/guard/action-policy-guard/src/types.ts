/** Durable action-policy observation event types. */

import type { CallId } from '@deepseek-ai/dsh-llm/brand'

/** Why an observe-mode call is a side-effectful candidate. */
export type ActionPolicyEffectSource = 'declared' | 'undeclared'

/** Minimal durable record for one observe-mode side-effectful candidate. */
export interface ActionPolicyCandidateEventData {
  /** Tool name used to aggregate candidates without retaining arguments. */
  toolName: string
  /** Existing call identity used to correlate with the owning tool event. */
  callId: CallId
  /** Whether side effects were explicit or inferred from missing metadata. */
  effectSource: ActionPolicyEffectSource
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One side-effectful tool candidate seen in action-policy observe mode.
     * The payload intentionally excludes arguments, commands, paths,
     * justifications, and credentials. Log-only and safe to skip when unknown.
     */
    'action-policy/candidate': ActionPolicyCandidateEventData
  }
}
