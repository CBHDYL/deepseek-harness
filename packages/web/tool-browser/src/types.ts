/**
 * Pure types of the browser-verification evidence domain: the ONE home of the
 * `browserVerify` projection-key declaration plus the `browser/verify` event
 * payload, free of this package's host-side value imports (dsh-tools, zod).
 *
 * @module @deepseek-ai/dsh-tool-browser/types
 */

/**
 * One durable browser-verification evidence record. Compact by design: page
 * text stays in the tool result; this event keeps the attributable facts
 * consumers need (action, outcome, target, bounded text metadata, screenshot
 * reference, failure reason). POLICY_FAILURE is recorded like any other
 * outcome — it is evidence of a denied attempt, never a product failure.
 */
export interface BrowserVerificationEvidence {
  /** The action that produced this record. */
  action: 'goto' | 'read_text' | 'screenshot' | 'click' | 'fill' | 'close' | 'list'
  /** The four-class outcome of the action. */
  outcome: 'PASS' | 'PRODUCT_FAILURE' | 'INFRA_FAILURE' | 'POLICY_FAILURE'
  /** Failure or denial reason; present exactly when the outcome is not PASS. */
  reason?: string
  /** Final page URL after `goto`, or the session page URL for `read_text`. */
  url?: string
  /** Page title when available. */
  title?: string
  /** Whether the returned visible text was truncated by the configured cap. */
  truncated?: boolean
  /** Full length of the visible text before the configured cap. */
  text_length?: number
  /** Absolute path of the saved screenshot under the bounded screenshot directory. */
  screenshot_path?: string
  /** Durable attachment-store reference of the screenshot, when the attachment service is mounted. */
  attachment?: BrowserScreenshotAttachment
}

/** Structural attachment reference stored on evidence and results (attachment service may be absent). */
export interface BrowserScreenshotAttachment {
  attachmentId: string
  mediaType: string
  width: number
  height: number
  bytes: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One browser-verification attempt and its classified outcome; the projection folds the latest per turn. */
    'browser/verify': BrowserVerificationEvidence
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    browserVerify: BrowserVerificationEvidence | null
  }
  interface SessionProjectionMap {
    /**
     * The session's latest browser-verification evidence within the current
     * turn, or `null` before the first attempt or after the next `turn/start`.
     * Durable history lives in the session log (`browser/verify` events).
     */
    browserVerify: BrowserVerificationEvidence | null
  }
}
