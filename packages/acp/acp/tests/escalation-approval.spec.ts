/**
 * F7: under enforce mode the single merged execution approval must present
 * BOTH the requested sandbox dimension and the model's justification to the
 * human permission payload — exactly one approval, no second ask from the
 * escalating body, and the confirmed dimension is what the body's
 * preauthorization consult reuses.
 */

import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { CallId } from '@deepseek-ai/dsh-llm'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as ActionPolicyGuard from '@deepseek-ai/dsh-action-policy-guard'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { makeBridgeHarness, textResponse } from './harness.ts'

function toolCallResponse(id: string, name: string, args: Record<string, string>) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: JSON.stringify(args) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: JSON.stringify(args) } },
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

describe('F7: escalation dimension and justification reach the human permission payload', () => {
  it('enforce + escalation: one approval whose allow option carries dimension AND justification', async () => {
    const h = await makeBridgeHarness({
      script: [toolCallResponse('f7-call', 'esc', {
        sandbox_permissions: 'danger-full-access',
        justification: 'write outside the session workspace',
      }), textResponse('done')],
    })
    await h.ctx.plugin(ApprovalService, {})
    await h.ctx.plugin(ActionPolicyGuard, { mode: 'enforce' })
    let bodyAsks = 0
    const approvedDimensions: (string | undefined)[] = []
    h.ctx.tools.register(defineContentToolFixture({
      name: 'esc', description: 'e', parameters: { sandbox_permissions: { type: 'string' }, justification: { type: 'string' } },
      effects: 'side-effectful',
      async execute(_args, exec) {
        // The body consults the attempt's confirmed approval record; the
        // confirmed dimension must equal the one the human was shown.
        const prior = h.ctx.approval.executionApproval(exec)
        approvedDimensions.push(prior?.sandboxMode)
        if (prior?.sandboxMode !== 'danger-full-access') {
          bodyAsks++
          await h.ctx.approval.request({ agent: exec.agent!, toolName: 'esc', operationId: exec.operationId, sandboxMode: 'danger-full-access', signal: exec.signal })
        }
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    h.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    await h.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await h.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const prompt = h.client.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'go' }] } as never)
    await waitFor(() => h.permissionRequests.length === 1, 'permission request')
    const request = h.permissionRequests[0]!
    const label = request.options[0]!.name
    expect(label).toContain('sandbox escalation to "danger-full-access"')
    expect(label).toContain('write outside the session workspace')
    await prompt
    // Exactly one human approval for the whole attempt.
    expect(h.permissionRequests).toHaveLength(1)
    expect(bodyAsks).toBe(0)
    // The confirmed dimension is exactly what the body's preauthorization
    // consult reused — the same value the human was shown.
    expect(approvedDimensions).toEqual(['danger-full-access'])
    await h.dispose()
  }, 30000)
})
