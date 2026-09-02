/** Stable failures exposed by the session-persistence service. */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** The requested Session identity has no materialized durable log. */
export class SessionPersistenceNotFoundError extends Error {
  /** @param sessionId - absent durable Session identity. */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" not found`)
    this.name = 'SessionPersistenceNotFoundError'
  }
}

/**
 * Backend-internal marker for stored-content validation failures (PR-3 F1):
 * the artifact's bytes WERE read (or enumerated) and its content or structure
 * failed this build's validation. The coordinator maps this marker to the
 * public {@link SessionPersistenceCorruptionError}; infrastructure failures
 * (filesystem `ErrnoException`s, transport errors) must NOT carry it — they
 * pass through unwrapped so the failure class reflects the failure origin.
 */
export class StoredContentCorruptionError extends Error {}
