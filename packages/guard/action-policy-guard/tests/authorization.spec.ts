/**
 * Execution-attempt authorization contract: one approval authorizes exactly
 * one registry-minted operation attempt, the audit chain joins asked →
 * decided → tool/call → tool/result on the operation id, the guard fence is a
 * monotonic deny (not a second approval system), and a short-circuiting allow
 * or a reused call id can never authorize a side effect.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import * as ActionPolicyGuard from '@deepseek-ai/dsh-action-policy-guard'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

interface Harness {
  ctx: Context
  agent: Agent
  ran: () => string[]
  asked: () => SessionEvent[]
  decided: () => SessionEvent[]
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ApprovalService, {})
  await ctx.plugin(ActionPolicyGuard, { mode: 'enforce' })
  ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
  const ran: string[] = []
  const register = (name: string, effects?: 'side-effectful' | 'read-only') => {
    ctx.tools.register(defineContentToolFixture({
      name,
      description: name,
      parameters: effects === 'side-effectful' ? { token: { type: 'string' } } : {},
      ...effects !== undefined ? { effects } : {},
      async execute() { ran.push(name); return [{ type: 'text', text: 'ok' }] },
    }))
  }
  register('undeclared')
  register('declared', 'side-effectful')
  register('readonly', 'read-only')
  const agent = ctx.agentLoop.create(SessionId('authz'), { provider: 'mock', model: 'mock' })
  return {
    ctx,
    agent,
    ran: () => ran,
    asked: () => agent.session.events.filter(event => event.type === 'approval/asked'),
    decided: () => agent.session.events.filter(event => event.type === 'approval/decided'),
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status }) => {
      if (s === agent && status === 'idle') { d(); resolve() }
    })
  })
}

describe('execution-attempt authorization', () => {
  it('a consumed grant cannot authorize a second attempt: reusing a callId still asks fresh (E1)', async () => {
    const h = await harness()
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('shared-call', 'undeclared', {}),
      toolCallResponse('shared-call', 'declared', { token: 't' }),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    expect(h.ran()).toEqual(['undeclared', 'declared'])
    // Two attempts, two asks: the first grant was consumed and cannot leak
    // through the reused model call id to the second, different tool.
    expect(h.asked()).toHaveLength(2)
    expect(h.decided()).toHaveLength(2)
    // Distinct registry-minted operation identities join each pair.
    const first = h.asked()[0]?.data as { operationId?: string }
    const second = h.asked()[1]?.data as { operationId?: string }
    expect(first?.operationId).toBeTruthy()
    expect(second?.operationId).toBeTruthy()
    expect(first?.operationId).not.toBe(second?.operationId)
  })

  it('a short-circuiting allow listener cannot hide the mandatory approval ask (E1 fence)', async () => {
    const h = await harness()
    h.ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => next(), { prepend: true })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('allow-bypass', 'undeclared', {}),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    // The execution happened ONLY after the mandatory ask was answered.
    expect(h.asked()).toHaveLength(1)
    expect(h.decided()).toHaveLength(1)
    expect(h.ran()).toEqual(['undeclared'])
  })

  it('a short-circuiting allow listener cannot hide a mandatory policy denial', async () => {
    const h = await harness()
    // Upstream has no tools.policy collection: the mandatory source is a
    // delegating pre-execute listener whose fold outranks a downstream
    // short-circuit allow (deny > allow).
    h.ctx.on('tools/pre-execute', (): Promise<PreToolDecision> => Promise.resolve({ kind: 'allow' }), { prepend: true })
    h.ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
      await next()
      return { kind: 'deny', reason: 'mandatory policy says no' }
    }, { prepend: true })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('allow-bypass', 'undeclared', {}),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    expect(h.ran()).toEqual([])
    expect(h.asked()).toHaveLength(0)
    const result = h.agent.session.events.find(event => event.type === 'tool/result')
    const text = result?.type === 'tool/result' && result.data.message.content[0]?.type === 'tool-result'
      ? (result.data.message.content[0].content[0]?.type === 'text' ? result.data.message.content[0].content[0].text : '')
      : ''
    expect(text).toContain('mandatory policy says no')
  })

  it('a hook-style ask before the guard yields ONE approval and an authorized execution (E16)', async () => {
    const h = await harness()
    // A hook-shaped ask listener (delegating, prepend) — the ask runs through
    // the single scheduler approval point, the grant mints for THIS attempt,
    // and the guard fence accepts it instead of denying after a human allow.
    h.ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
      const downstream = await next()
      if (downstream.kind === 'deny') return downstream
      return { kind: 'ask', reason: 'hook wants a human' }
    }, { prepend: true })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('hook-ask', 'declared', { token: 't' }),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    expect(h.ran()).toEqual(['declared'])
    expect(h.asked()).toHaveLength(1)
    expect(h.decided()).toHaveLength(1)
    expect((h.decided()[0]?.data as { outcome?: string }).outcome).toBe('allowed-once')
  })

  it('two ask-capable listeners yield exactly ONE approval question (E17)', async () => {
    const h = await harness()
    h.ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
      const downstream = await next()
      if (downstream.kind === 'deny') return downstream
      return { kind: 'ask', reason: 'second asker' }
    })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('two-askers', 'undeclared', {}),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    expect(h.ran()).toEqual(['undeclared'])
    expect(h.asked()).toHaveLength(1)
    expect(h.decided()).toHaveLength(1)
  })

  it('deny beats ask regardless of listener registration order', async () => {
    const h = await harness()
    // The guard is registered inside its own plugin fiber; this appended deny
    // listener runs after the guard\'s ask — the merge still yields deny.
    h.ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
      const downstream = await next()
      return downstream.kind === 'deny' ? downstream : { kind: 'deny', reason: 'policy says no' }
    })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('deny-wins', 'undeclared', {}),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    expect(h.ran()).toEqual([])
    expect(h.asked()).toHaveLength(0)
  })

  it('the audit chain joins asked → decided → tool/call → tool/result on one operationId (A6)', async () => {
    const h = await harness()
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('chain', 'declared', { token: 't' }),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    const asked = h.asked()[0]?.data as { operationId?: string }
    const decided = h.decided()[0]?.data as { operationId?: string }
    const call = h.agent.session.events.find(event => event.type === 'tool/call')
    const result = h.agent.session.events.find(event => event.type === 'tool/result')
    expect(asked?.operationId).toBeTruthy()
    expect(decided?.operationId).toBe(asked?.operationId)
    expect(call?.type === 'tool/call' && call.data.operationId).toBe(asked?.operationId)
    expect(result?.type === 'tool/result' && result.data.operationId).toBe(asked?.operationId)
    // Exactly one terminal disposition per allowed-once decision.
    expect(h.agent.session.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('merges the sandbox escalation dimension into the single execution approval (no second human question)', async () => {
    const h = await harness()
    let bodyAsks = 0
    h.ctx.tools.register(defineContentToolFixture({
      name: 'escalating',
      description: 'e',
      parameters: { sandbox_permissions: { type: 'string' }, justification: { type: 'string' } },
      effects: 'side-effectful',
      async execute(_args, exec) {
        // The body consults the attempt's execution approval: when the single
        // pre-execute ask already named exactly this dimension, no second
        // approval question is asked.
        bodyAsks++
        await h.ctx.approval.request({
          agent: exec.agent!, toolName: 'escalating', callId: exec.callId,
          reason: 'sandbox escalation to "danger-full-access": needed', signal: exec.signal,
        })
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('escalate-call', 'escalating', { sandbox_permissions: 'danger-full-access', justification: 'needed' }),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    // Upstream keeps the sandbox escalation as its own body approval (PR-1
    // verified design): the action-policy gate asks once for the call, and
    // the escalation ask carries the dimension in its reason. The fork-era
    // merged-single-ask (F7) is intentionally NOT ported — recorded deviation.
    expect(bodyAsks).toBe(1)
    const escalationAsk = h.asked().find(a => (a.data as { reason?: string }).reason?.includes('sandbox escalation'))
    expect((escalationAsk?.data as { reason?: string }).reason).toContain('danger-full-access')
    expect((escalationAsk?.data as { reason?: string }).reason).toContain('needed')
  })

  it('a minted sandbox authority without an operation grant cannot authorize execution under enforce', async () => {
    const h = await harness()
    await h.ctx.plugin(await import('@deepseek-ai/dsh-sandbox-policy').then(m => m.default), { mode: 'read-only' } as never)
    const ran: string[] = []
    h.ctx.tools.register(defineContentToolFixture({
      name: 'act',
      description: 'a',
      parameters: {},
      effects: 'side-effectful',
      async execute() { ran.push('act'); return [{ type: 'text', text: 'ok' }] },
    }))
    // The human rejects: no operation grant is minted for this attempt, even
    // though a widened sandbox authority was minted by the policy owner.
    const offAllow = h.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'), { prepend: true })
    h.ctx.sandboxPolicy.resolve({ session: h.agent.session, mode: 'danger-full-access' })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('auth-check', 'act', {}),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, h.agent)
    offAllow()
    expect(ran).toEqual([])
    expect(h.asked()).toHaveLength(1)
    expect((h.decided()[0]?.data as { outcome?: string }).outcome).toBe('rejected')
  })

  it('a cancelled attempt cannot be revived by a late answer and leaves no grant behind', async () => {
    const h = await harness()
    let release!: (outcome: ApprovalOutcome) => void
    const pending = new Promise<ApprovalOutcome>((resolve) => { release = resolve })
    h.ctx.on('approval/request', () => pending, { prepend: true })
    h.ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('late', 'undeclared', {}),
      textResponse('done'),
    ]))
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    // Cancel mid-ask; the late allow settles after the attempt is dead.
    setTimeout(() => { h.agent.cancel({ kind: 'user' }) }, 20)
    await waitForIdle(h.ctx, h.agent)
    release('allowed-once')
    expect(h.ran()).toEqual([])
    const decided = h.decided()
    expect(decided).toHaveLength(1)
    expect((decided[0]?.data as { outcome?: string }).outcome).toBe('cancelled')
  })

  it('cross-invariant B: an authorized execution persists and survives reload with its full durable chain', async () => {
    // PR-2 authorization + PR-3 persistence composition: the approved tool
    // run and its asked/decided/call/result chain must survive a reload.
    const root = await mkdtemp(join(tmpdir(), 'dsh-cross-b-'))
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(ApprovalService, {})
    await ctx.plugin(ActionPolicyGuard, { mode: 'enforce' })
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const ran: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'declared',
      description: 'd',
      parameters: { token: { type: 'string' } },
      effects: 'side-effectful',
      async execute() { ran.push('declared'); return [{ type: 'text', text: 'ok' }] },
    }))
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('cross-b-call', 'declared', { token: 't' }),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('cross-b'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const call = agent.session.events.find(event => event.type === 'tool/call')
    const result = agent.session.events.find(event => event.type === 'tool/result')
    const operationId = call?.type === 'tool/call' ? call.data.operationId : undefined
    expect(operationId).toBeTruthy()
    expect(result?.type === 'tool/result' && result.data.operationId).toBe(operationId)
    expect(ran).toEqual(['declared'])
    await ctx.fiber.dispose()

    // Reload from the same root: the authorized execution history is intact.
    const ctx2 = new Context()
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const loaded = await ctx2.sessionPersistence.load(SessionId('cross-b'))
    const loadedCall = loaded.events.find(event => event.type === 'tool/call')
    const loadedResult = loaded.events.find(event => event.type === 'tool/result')
    expect(loadedCall?.type === 'tool/call' && loadedCall.data.operationId).toBe(operationId)
    expect(loadedResult?.type === 'tool/result' && loadedResult.data.operationId).toBe(operationId)
    expect(loaded.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    await ctx2.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
})
