/**
 * Crash-recovery repair for an interrupted session log. It preserves a fully
 * written final turn and supplies the missing tool, step, and turn boundaries
 * needed to resume with a provider-valid transcript.
 * @module @deepseek-ai/dsh-session/repair
 */

import { MessageId, freezeMessage, type CallId } from '@deepseek-ai/dsh-llm'
import type { ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { OperationId, SessionEvent } from './types.ts'

/** Recovery code for an assistant tool request that never reached a recorded call start. */
export const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED'

/** Recovery code for a recorded tool call whose completed outcome was not durably recorded. */
export const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'

/**
 * Return deterministic synthetic events that close an open tail turn. Unmatched
 * calls receive error results first, followed by an open `step/end` and an
 * interrupted `turn/end`; sequences continue the log and timestamps reuse the
 * last real event. A balanced or empty log returns no events.
 *
 * @param events - the loaded durable log to scan (a valid committed prefix, possibly with a crash tail).
 * @returns the synthetic closer events to append after `events`, in order; empty when the log is already balanced.
 */
export function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[] {
  let openTurn: number | null = null
  let openStep: number | null = null
  // Reset at each turn boundary so earlier calls cannot leak into tail repair.
  // Entries pair on the attempt correlation (operationId) when one exists and
  // fall back to the model call id only for legacy rows without one: a reused
  // call id over two distinct attempts must not make one attempt's result
  // delete the other. Keys are namespaced (`call:`/`op:`) because a provider
  // call id like "1" and a numeric operation id occupy different namespaces
  // and must never collide in one map.
  const pendingCalls = new Map<string, { step: number; callId: CallId; callSeq?: number; operationId?: OperationId }>()
  const callKey = (callId: CallId): string => `call:${callId}`
  const operationKey = (operationId: OperationId): string => `op:${operationId}`
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openStep = null
        pendingCalls.clear()
        break
      case 'turn/end':
        openTurn = null
        openStep = null
        pendingCalls.clear()
        break
      case 'step/start':
        openStep = event.data.step
        break
      case 'step/end':
        pendingCalls.clear()
        openStep = null
        break
      case 'assistant/message':
        // The assistant message carries the tool-call blocks; each is pending
        // until a tool/result event with the same callId is logged.
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') pendingCalls.set(callKey(block.id), { step: event.data.step, callId: block.id })
        }
        break
      case 'tool/call':
        // Cite the `tool/call` seq from the synthetic result and carry the
        // attempt correlation so the repaired disposition closes the audit
        // chain the interrupted execution opened. Once an attempt correlation
        // exists the entry moves under it: the model call id stops being the
        // pairing key for that attempt. A `tool/call` with no matching
        // assistant block is a registry-owned direct execution — register it
        // as its own pending attempt so repair closes that chain too.
        {
          const entry = pendingCalls.get(callKey(event.data.callId))
          if (entry !== undefined) {
            entry.callSeq = event.seq
            if (event.data.operationId !== undefined) {
              entry.operationId = event.data.operationId
              pendingCalls.delete(callKey(event.data.callId))
              pendingCalls.set(operationKey(event.data.operationId), entry)
            }
          } else {
            pendingCalls.set(
              event.data.operationId !== undefined
                ? operationKey(event.data.operationId)
                : callKey(event.data.callId),
              {
                step: event.data.step,
                callId: event.data.callId,
                callSeq: event.seq,
                ...event.data.operationId !== undefined ? { operationId: event.data.operationId } : {},
              },
            )
          }
        }
        break
      case 'tool/result':
        // New-format pairing by attempt correlation; legacy rows (no
        // operationId) fall back to the model call id.
        {
          const op = event.data.operationId
          pendingCalls.delete(op !== undefined ? operationKey(op) : callKey(event.data.message.source.callId))
        }
        break
      // Other event types do not move the turn/step boundary cursor.
      default:
        break
    }
  }

  // Balanced log (no crash mid-turn): nothing to close. An open turn implies
  // `events` is non-empty (its turn/start was logged), so `last` exists.
  const last = events.at(-1)
  if (openTurn === null || last === undefined) return []

  // The last real event supplies the seq base and the timestamp for the
  // synthetic closers (reusing the last timestamp keeps them deterministic and
  // never invents a "future" time).
  let seq = last.seq + 1
  const time = last.time
  const closers: SessionEvent[] = []

  // Close calls before their step: providers reject dangling assistant calls,
  // and Map insertion order preserves their transcript order.
  for (const { step, callId, callSeq, operationId } of pendingCalls.values()) {
    const started = callSeq !== undefined
    const message: ToolResultMessage = freezeMessage({
      id: MessageId(`interrupted-tool-result-${callId}-${seq}`),
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        isError: true,
        content: [{
          type: 'text',
          text: started
            ? 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'
            : 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
        }],
      }],
    })
    closers.push({
      type: 'tool/result',
      seq: seq++,
      time,
      data: {
        turn: openTurn,
        step,
        message,
        error: started
          ? { name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN }
          : { name: 'ToolNotStartedError', code: TOOL_NOT_STARTED },
        ...operationId !== undefined ? { operationId } : {},
      },
      surfaceOp: 'append',
      ...started ? { sourceEventSeqs: [callSeq] } : {},
    })
  }

  // Close an open step next — a turn/end while a step is open is an invariant
  // violation, so the step's boundary must be synthesized before the turn's.
  if (openStep !== null) {
    closers.push({ type: 'step/end', seq: seq++, time, data: { turn: openTurn, step: openStep } })
  }
  closers.push({ type: 'turn/end', seq: seq++, time, data: { turn: openTurn, reason: { kind: 'interrupted' } } })
  return closers
}
