/**
 * E24 regression: under the action-policy enforce fence, session/cancel must
 * terminate the approval lifecycle — the prompt settles as cancelled, no side
 * effect runs, and teardown reaches quiescence (the pre-fix behavior hung the
 * prompt forever because the guard asked approval without the execution signal).
 */

import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as ActionPolicyGuard from '@deepseek-ai/dsh-action-policy-guard'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { makeBridgeHarness, textResponse } from './harness.ts'

function toolCallResponse(id: string, name: string) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: '{}' } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] as never
}

function waitFor(predicate: () => boolean, label: string, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) { resolve(); return }
      if (Date.now() - started > ms) { reject(new Error(`timeout waiting for ${label}`)); return }
      setTimeout(tick, 5)
    }
    tick()
  })
}

describe('E24: cancellation terminates the enforce-mode approval lifecycle', () => {
  it('the prompt settles cancelled, no side effect runs, and dispose reaches quiescence', async () => {
    const h = await makeBridgeHarness({
      script: [toolCallResponse('e24-call', 'act'), textResponse('done')],
    })
    await h.ctx.plugin(ApprovalService, {})
    await h.ctx.plugin(ActionPolicyGuard, { mode: 'enforce' })
    const ran: string[] = []
    h.ctx.tools.register(defineContentToolFixture({
      name: 'act',
      description: 'side-effectful',
      parameters: {},
      effects: 'side-effectful',
      async execute() { ran.push('act'); return [{ type: 'text', text: 'ok' }] },
    }))
    // The client never answers the permission prompt: cancellation must end it.
    ;(h as unknown as { onPermission: unknown }).onPermission = () => new Promise(() => {})

    await h.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await h.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const prompt = h.client.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'go' }],
    } as never)

    await waitFor(() => h.permissionRequests.length === 1, 'permission request')
    await h.client.cancel({ sessionId: session.sessionId } as never)

    const outcome = await Promise.race([
      prompt.then(r => ({ kind: 'settled' as const, stop: (r as { stopReason?: string }).stopReason })),
      new Promise<{ kind: 'pending' }>(resolve => setTimeout(() => resolve({ kind: 'pending' }), 3000)),
    ])
    expect(outcome.kind).toBe('settled')
    if (outcome.kind === 'settled') expect(outcome.stop).toBe('cancelled')
    expect(ran).toEqual([])
    // Teardown must reach quiescence with no hung approval.
    const disposal = await Promise.race([
      h.dispose().then(() => 'disposed' as const),
      new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 3000)),
    ])
    expect(disposal).toBe('disposed')
  }, 30000)
})
