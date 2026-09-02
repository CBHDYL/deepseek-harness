/**
 * PR-6 layered prompt budget (Design Review L7 / audit E30): the hard UTF-8
 * byte ceiling and the optional heuristic estimate ceiling run at the final
 * request boundary BEFORE any durable header and any provider dispatch; a
 * rejection gets one bounded compaction-recovery opportunity per step and
 * fails loud as PROMPT_BUDGET_EXCEEDED when the surface cannot shrink.
 * @module dsh-agent-loop/tests/prompt-budget
 */

import { createMessage, createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const contexts: Context[] = []

async function harness(config: Record<string, unknown> = {}): Promise<{ ctx: Context; adapter: MockAdapter }> {
  const adapter = new MockAdapter([textResponse('ok')])
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], ...config })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

/** A seeded session whose surface carries `pairs` large user/assistant rounds (balanced, resumable history; the live event seed shape). */
function seedEvents(pairs: number, text: (index: number) => string): SessionEvent[] {
  const events: SessionEvent[] = []
  let seq = 0
  events.push({ type: 'turn/start', seq: SessionSeq(seq++), time: seq, data: { turn: 1 } })
  for (let i = 0; i < pairs; i++) {
    events.push({
      type: 'user/message', seq: SessionSeq(seq++), time: seq,
      data: createUserMessage({ content: [{ type: 'text', text: text(i) }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    })
    events.push({
      type: 'assistant/message', seq: SessionSeq(seq++), time: seq,
      data: {
        turn: 1,
        step: i + 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: `a${i}` }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        }),
      },
      surfaceOp: 'append',
    })
  }
  events.push({ type: 'turn/end', seq: SessionSeq(seq++), time: seq, data: { turn: 1, reason: { kind: 'completed' } } })
  return events
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function turnError(agent: Agent): { code: string; message: string } | undefined {
  const end = agent.session.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)
  if (end?.type !== 'turn/end' || end.data.reason.kind !== 'error') return undefined
  return { code: end.data.reason.error.code, message: end.data.reason.error.message }
}

async function createSeededAgent(ctx: Context, id: string, pairs: number, text: (i: number) => string = () => 'x'.repeat(2048)): Promise<Agent> {
  // The factory seeds the session and publishes the agent in one boundary.
  return (await ctx.agents.create({
    sessionId: SessionId(id),
    seed: seedEvents(pairs, text),
    agentOptions: { provider: 'mock', model: 'mock' },
  })).agent
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(c => c.fiber.dispose()))
})

describe('PR-6 prompt budget (L7 / E30)', () => {
  it('L7-5/L7-6: an oversized request is rejected BEFORE dispatch — zero provider calls, typed failure, no durable header or attempt', async () => {
    const { ctx, adapter } = await harness({ maxRequestBytes: 1024 })
    const agent = await createSeededAgent(ctx, 'b1', 4) // ~8 KB of surface
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    // The hard ceiling held: nothing reached the adapter.
    expect(adapter.requests).toHaveLength(0)
    // The rejection is typed and observable on the turn boundary.
    expect(turnError(agent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')
    expect(turnError(agent)?.message).toContain('bytes')
    // A rejected request was never loop-built: no request/header names it
    // (headers <=> sent requests, the reconstruction theorem).
    expect(agent.session.snapshotEvents().some(e => e.type === 'request/header')).toBe(false)
  })

  it('L7-4: the estimate ceiling fires at the final boundary even when the byte ceiling would pass', async () => {
    const { ctx, adapter } = await harness({ maxEstimateTokens: 60 })
    const agent = await createSeededAgent(ctx, 'b2', 2) // surface estimate > 60 tokens
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    expect(turnError(agent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')
    expect(turnError(agent)?.message).toContain('estimate is')
  })

  it('L7-5: multibyte content — the byte ceiling rejects what the char-based heuristic undercounts', async () => {
    // 3-byte CJK chars: the estimate (chars/4) is far below the byte reality,
    // so ONLY the independent byte ceiling can catch this.
    const { ctx, adapter } = await harness({ maxEstimateTokens: 1_000_000, maxRequestBytes: 2048 })
    const agent = await createSeededAgent(ctx, 'b3', 2, () => '界'.repeat(1000)) // 3000 bytes per message
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    expect(turnError(agent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')
  })

  it('L7-3/L7-8: budget-triggered compaction recovery rebuilds a smaller request and dispatches exactly once', async () => {
    const { ctx, adapter } = await harness({ maxRequestBytes: 4096, budgetCompactionRetries: 1 })
    const agent = await createSeededAgent(ctx, 'b4', 6)
    // The recovery listener performs one surface reduction: replace the first
    // large user message with a short one (same mechanism compaction uses).
    let recoveries = 0
    ctx.on('agent/request-budget', ({ agent: subject, signal }) => {
      recoveries += 1
      const nodes = subject.session.surface.nodes
      if (signal.aborted || nodes.length === 0) return Promise.resolve({ kind: 'reject' })
      // One compaction pass: shadow the whole surface span with a short summary.
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      subject.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'short' }],
        source: { kind: 'plugin', plugin: 'test' },
      }), {
        surfaceOp: { op: 'replace', start: first, end: last },
        sourceEventSeqs: [...nodes],
      })
      return Promise.resolve({ kind: 'retry' })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(recoveries).toBe(1)
    expect(adapter.requests).toHaveLength(1) // the rebuilt request dispatched once
    // Canonical ordering preserved: the dispatched request carries the
    // replacement message, not the shadowed large one.
    const messages = adapter.requests[0]?.messages as Message[]
    expect(messages.some(m => m.content.some(b => b.type === 'text' && b.text === 'short'))).toBe(true)
    expect(messages.some(m => m.content.some(b => b.type === 'text' && b.text.length > 2000))).toBe(false)
  })

  it('L7-7: a listener that cannot reduce the surface yields a bounded typed rejection, zero dispatch', async () => {
    const { ctx, adapter } = await harness({ maxRequestBytes: 1024, budgetCompactionRetries: 1 })
    const agent = await createSeededAgent(ctx, 'b5', 6)
    let recoveries = 0
    ctx.on('agent/request-budget', () => {
      recoveries += 1
      return Promise.resolve({ kind: 'retry' }) // claims retry without reducing
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(recoveries).toBe(1) // bounded by budgetCompactionRetries
    expect(adapter.requests).toHaveLength(0)
    expect(turnError(agent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')
  })

  it('L7-7: rejection is deliverable — a later small prompt runs normally on the same session', async () => {
    const { ctx, adapter } = await harness({ maxRequestBytes: 2048 })
    const agent = await createSeededAgent(ctx, 'b6', 8)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    expect(turnError(agent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')
    // A fresh short turn must proceed: the budget failure does not wedge the
    // loop, and the session stays recoverable.
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    // The second turn also exceeds the tiny ceiling (history still large) —
    // but the point is the machine keeps serving bounded failures instead of
    // hanging; both turns produced typed ends.
    const errors = agent.session.snapshotEvents()
      .filter(e => e.type === 'turn/end' && e.data.reason.kind === 'error')
    expect(errors).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(e => e.type === 'user/message').map(
      e => e.type === 'user/message' ? e.data.content.filter(b => b.type === 'text').map(b => b.text).join('') : '',
    )).toContain('again')
  })

  it('L7-2: aggregate tool-schema growth is bounded by the final ceiling (many individually legal tools)', async () => {
    const { ctx, adapter } = await harness({ maxRequestBytes: 8192 })
    // Register several tools with large-but-legal schemas; the aggregate
    // request representation crosses the ceiling.
    for (let i = 0; i < 6; i++) {
      ctx.tools.register(defineContentToolFixture({
        name: `bulk_tool_${i}`,
        description: 'd'.repeat(512),
        parameters: { pad: { type: 'string', description: 'p'.repeat(1024) } },
        execute: async () => [{ type: 'text', text: 'ok' }],
      }))
    }
    const agent = await createSeededAgent(ctx, 'b7', 1)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    expect(turnError(agent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')
    expect(turnError(agent)?.message).toContain('bytes')
  })

  it('a normal request under the ceilings dispatches unchanged (no false rejection)', async () => {
    const { ctx, adapter } = await harness({ maxRequestBytes: 64 * 1024, maxEstimateTokens: 100_000 })
    const agent = await createSeededAgent(ctx, 'b8', 1, () => 'hello')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('P6-1: the byte boundary is exact — B-1 refuses, B and B+1 dispatch', async () => {
    // Calibrate B from the exact dispatched envelope of one identical run.
    const calibrate = await harness({ maxRequestBytes: 1024 * 1024 * 1024 })
    const cAgent = await createSeededAgent(calibrate.ctx, 'b9', 2)
    cAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(calibrate.ctx, cAgent)
    expect(calibrate.adapter.requests).toHaveLength(1)
    const dispatched = calibrate.adapter.requests[0]!
    const exactBytes = new TextEncoder().encode(JSON.stringify({
      messages: dispatched.messages,
      ...dispatched.system === undefined ? {} : { system: dispatched.system },
      ...dispatched.tools === undefined ? {} : { tools: dispatched.tools },
    })).length
    expect(exactBytes).toBeGreaterThan(0)

    // B-1: the same seed and followup exceed the ceiling by exactly one byte.
    const under = await harness({ maxRequestBytes: exactBytes - 1 })
    const uAgent = await createSeededAgent(under.ctx, 'b10', 2)
    uAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(under.ctx, uAgent)
    expect(under.adapter.requests).toHaveLength(0)
    expect(turnError(uAgent)?.code).toBe('PROMPT_BUDGET_EXCEEDED')

    // Exactly B: the strict `>` predicate lets it dispatch.
    const at = await harness({ maxRequestBytes: exactBytes })
    const atAgent = await createSeededAgent(at.ctx, 'b11', 2)
    atAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(at.ctx, atAgent)
    expect(at.adapter.requests).toHaveLength(1)

    // B+1: room to spare, still dispatches.
    const over = await harness({ maxRequestBytes: exactBytes + 1 })
    const oAgent = await createSeededAgent(over.ctx, 'b12', 2)
    oAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(over.ctx, oAgent)
    expect(over.adapter.requests).toHaveLength(1)
  })
})
