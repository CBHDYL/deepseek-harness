import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/**
 * Transactional step admission: claimed inbox input must survive a preparation
 * failure. preStep() claims durably and only later assembles the prompt and
 * runs the pre-step waterfall; if either throws, the claimed messages were
 * previously lost — the user's work vanished without being entered or queued.
 */

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

describe('transactional step admission', () => {
  it('restores claimed user input when the pre-step waterfall throws (no work lost)', async () => {
    const adapter = new MockAdapter([textResponse('never runs')])
    const ctx = await harness(adapter)
    ctx.on('agent/pre-step', async () => {
      throw new Error('prep exploded')
    })
    const agent = ctx.agentLoop.create(SessionId('txn-1'), { provider: 'mock', model: 'mock' })
    const message = createUserMessage({ content: [{ type: 'text', text: 'precious input' }], source: { kind: 'user' } })
    agent.followup(message)
    await agent.whenIdle()

    // The message is pending again on the next-turn queue (followup target), not lost.
    expect(agent.inbox.nextTurn.some(candidate => candidate.id === message.id)).toBe(true)
    // Nothing was committed as a user message and no model request ran.
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'user/message')).toBe(false)
    // The turn failed loudly.
    const turns = [...agent.session.events].filter(event => event.type === 'turn/end')
    expect(turns.at(-1)?.data.reason.kind).toBe('error')
  })

  it('restores claimed user input when prompt assembly throws', async () => {
    const adapter = new MockAdapter([textResponse('never runs')])
    const ctx = await harness(adapter)
    ctx.systemPrompt.section({
      name: 'exploding',
      order: 500,
      text: () => { throw new Error('assembly exploded') },
    })
    const agent = ctx.agentLoop.create(SessionId('txn-2'), { provider: 'mock', model: 'mock' })
    const message = createUserMessage({ content: [{ type: 'text', text: 'precious input' }], source: { kind: 'user' } })
    agent.followup(message)
    await agent.whenIdle()

    expect(agent.inbox.nextTurn.some(candidate => candidate.id === message.id)).toBe(true)
    expect(adapter.requests).toHaveLength(0)
    const turns = [...agent.session.events].filter(event => event.type === 'turn/end')
    expect(turns.at(-1)?.data.reason.kind).toBe('error')
  })

  it('preserves next-turn ordering on restore', async () => {
    const adapter = new MockAdapter([textResponse('never runs')])
    const ctx = await harness(adapter)
    ctx.on('agent/pre-step', async () => {
      throw new Error('prep exploded')
    })
    const agent = ctx.agentLoop.create(SessionId('txn-3'), { provider: 'mock', model: 'mock' })
    const first = createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } })
    const second = createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } })
    agent.steer(first) // next-step
    agent.followup(second) // next-turn
    await agent.whenIdle()

    // Both survive; the next-turn message is back on the next-turn queue.
    expect(agent.inbox.nextStep.some(candidate => candidate.id === first.id)).toBe(true)
    expect(agent.inbox.nextTurn.some(candidate => candidate.id === second.id)).toBe(true)
  })
})
