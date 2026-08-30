import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as ActionPolicyGuard from '@deepseek-ai/dsh-action-policy-guard'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function harness(mode: 'observe' | 'enforce'): Promise<{ ctx: Context; agent: Agent; ran: () => string[] }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ActionPolicyGuard, { mode })
  const ran: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'undeclared',
    description: 'u',
    parameters: {},
    async execute() { ran.push('undeclared'); return [{ type: 'text', text: 'ok' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'declared',
    description: 'd',
    parameters: { token: { type: 'string' } },
    effects: 'side-effectful',
    async execute() { ran.push('declared'); return [{ type: 'text', text: 'ok' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'readonly',
    description: 'r',
    parameters: {},
    effects: 'read-only',
    async execute() { ran.push('readonly'); return [{ type: 'text', text: 'ok' }] },
  }))
  const agent = ctx.agentLoop.create(SessionId('ap'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, ran: () => ran }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status }) => {
      if (s === agent && status === 'idle') { d(); resolve() }
    })
  })
}

describe('action-policy guard', () => {
  it.each([
    ['undeclared', 'undeclared', {}],
    ['declared', 'declared', { token: 'do-not-copy-this-secret' }],
  ] as const)('observe mode records the minimal %s candidate and lets it run', async (toolName, effectSource, args) => {
    const { ctx, agent, ran } = await harness('observe')
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', toolName, args),
      textResponse('done'),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(ran()).toEqual([toolName])
    const candidates = agent.session.events.filter(event => event.type === 'action-policy/candidate')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      data: { toolName, callId: 'c1', effectSource },
      ignorable: true,
    })
    expect(Object.keys(candidates[0]!.data)).toEqual(['toolName', 'callId', 'effectSource'])
    expect(JSON.stringify(candidates[0])).not.toContain('do-not-copy-this-secret')
  })

  it('enforce mode denies an undeclared side-effectful call (no approval granted)', async () => {
    const { ctx, agent, ran } = await harness('enforce')
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'undeclared', {}),
      textResponse('done'),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(ran()).toEqual([]) // body never ran
    expect(agent.session.events.some(event => event.type === 'action-policy/candidate')).toBe(false)
    const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    const text = (results[0]!.data.message.content[0] as { content: { text?: string }[] }).content.map(b => b.text ?? '').join('')
    expect(text).toContain('action-policy')
  })

  it('enforce mode lets a read-only tool run', async () => {
    const { ctx, agent, ran } = await harness('enforce')
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'readonly', {}),
      textResponse('done'),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(ran()).toEqual(['readonly'])
    expect(agent.session.events.some(event => event.type === 'action-policy/candidate')).toBe(false)
  })

  it('an agent-less execution neither crashes nor appends a candidate', async () => {
    const { ctx } = await harness('observe')
    const result = await ctx.tools.execute({
      callId: CallId('agentless-1'),
      name: 'undeclared',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(ctx.sessions.get(SessionId('agentless-1'))).toBeUndefined()
  })

  it('rejects an invalid mode fail-loud', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await expect(ctx.plugin(ActionPolicyGuard, { mode: 'banana' as never }))
      .rejects.toThrow(/mode/)
  })
})
