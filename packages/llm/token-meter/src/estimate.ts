/**
 * Fixed-density heuristic token pricing shared by the meter service and the
 * pure context-breakdown projection, so both surfaces price identical content
 * to identical numbers.
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** Fixed text-density estimate used until exact tokenization is needed. */
const CHARS_PER_TOKEN = 4

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

/**
 * Structural JSON price of one block outside the typed pricing arms: the
 * fixed heuristic for merge-extended blocks and for image references, whose
 * request price is route-owned rather than fixed.
 * @param block - block to price without mutation.
 * @returns heuristic tokens for the block's JSON structure.
 */
export function estimateStructuralBlock(block: ContentBlock): number {
  return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
}

/**
 * Price content blocks recursively under the fixed density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
          + Math.ceil(block.arguments.length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateContent(block.content) + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks (and image
        // references, whose request price is route-owned) retain a
        // conservative structural JSON price under the fixed heuristic.
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed heuristic.
 */
export function estimateMessage(message: Message): number {
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the system-prompt part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system-prompt tokens; 0 when absent.
 */
export function estimateSystemTokens(header: EpochHeader | undefined): number {
  if (header?.system === undefined) return 0
  return Math.ceil(header.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

/**
 * Price the complete non-surface request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system plus tool tokens.
 */
export function estimateHeader(header: EpochHeader | undefined): number {
  return estimateSystemTokens(header) + estimateToolsTokens(header)
}

/** The final assembled request fields priced by {@link estimateRequest}. */
export interface RequestEnvelope {
  /** The exact messages about to be dispatched, in order. */
  messages: readonly Message[]
  /** The rendered system prompt, when present. */
  system?: string
  /** The model-facing tool schemas, when present. */
  tools?: readonly unknown[]
}

/**
 * Price the complete final request at the provider boundary: every message
 * under the fixed-density heuristic plus the system-prompt and tool-schema
 * parts of the envelope. This is an ADVISORY, provider-agnostic heuristic
 * (accepted design deviation, PR-6 F2): no provider/model identity
 * participates in pricing, so the number is never a provider token guarantee.
 * Callers that enforce a hard safety boundary measure UTF-8 bytes separately
 * (the agent-loop byte ceiling is the normative enforcement; the optional
 * estimate ceiling is an early heuristic trigger only).
 * @param envelope - the assembled request fields.
 * @returns heuristic tokens for the complete request.
 */
export function estimateRequest(envelope: RequestEnvelope): number {
  let tokens = 0
  for (const message of envelope.messages) tokens += estimateMessage(message)
  tokens += estimateSystemTokens(envelope.system === undefined ? undefined : { system: envelope.system } as EpochHeader)
  tokens += estimateToolsTokens(envelope.tools === undefined || envelope.tools.length === 0
    ? undefined
    : { tools: envelope.tools } as unknown as EpochHeader)
  return tokens
}
