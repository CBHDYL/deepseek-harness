import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as OutputRepetitionGuard from '@deepseek-ai/dsh-output-repetition-guard'
import { RepetitionDetector } from '@deepseek-ai/dsh-output-repetition-guard'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Stream a text block as one delta PER copy, so the exact S+S state is reached mid-stream. */
function sectionRepeatedResponse(section: string, copies: number, tail = ''): StreamChunk[] {
  const text = section.repeat(copies) + tail
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from({ length: copies }, () => ({ type: 'text-delta' as const, index: 0, text: section })),
    ...(tail.length > 0 ? [{ type: 'text-delta' as const, index: 0, text: tail }] : []),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('RepetitionDetector', () => {
  const opts = { minSectionChars: 16, minRepeat: 2 }
  /** A non-periodic section so the detector's reported period is the section itself. */
  const section = 'ABCDEFGHIJKLMNOPQRSTUVWX' // 24 chars, no internal repetition

  it('detects an adjacent repeated section', () => {
    const d = new RepetitionDetector(opts)
    const hit = d.push(section + section)
    expect(hit).toEqual({ sectionChars: 24, repeatCount: 2 })
  })

  it('detects once and then stays quiet', () => {
    const d = new RepetitionDetector(opts)
    expect(d.push(section + section)).not.toBeUndefined()
    expect(d.push(section + section)).toBeUndefined()
  })

  it('does not detect a single occurrence or non-adjacent text', () => {
    const d = new RepetitionDetector(opts)
    expect(d.push(section)).toBeUndefined() // one section only
    const d2 = new RepetitionDetector(opts)
    expect(d2.push(section + 'XYZQ'.repeat(6))).toBeUndefined()
  })

  it('does not report a short internal period (repeat count must span >= minSectionChars)', () => {
    const d = new RepetitionDetector(opts)
    expect(d.push('ab'.repeat(40))).toBeUndefined() // period 2 < minSectionChars
  })

  it('handles streaming piece-by-piece (per-char deltas)', () => {
    const d = new RepetitionDetector(opts)
    const text = section + section
    let hit
    for (const char of text) hit = d.push(char)
    expect(hit).toEqual({ sectionChars: 24, repeatCount: 2 })
  })

  it('counts a longer run correctly (3 identical sections)', () => {
    const d = new RepetitionDetector(opts)
    const hit = d.push(section + section + section)
    expect(hit).toEqual({ sectionChars: 24, repeatCount: 3 })
  })

  it('rejects invalid options fail-loud', () => {
    expect(() => new RepetitionDetector({ minSectionChars: 0, minRepeat: 2 })).toThrow(/minSectionChars/)
    expect(() => new RepetitionDetector({ minSectionChars: 10, minRepeat: 1 })).toThrow(/minRepeat/)
  })
})

describe('agent stream wiring', () => {
  async function harness(config: object = {}): Promise<{ ctx: Context; agent: Agent }> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(OutputRepetitionGuard, config)
    return { ctx, agent: ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' }) }
  }

  function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
    return new Promise((resolve) => {
      const d = ctx.on('agent/status', ({ agent: s, status }) => {
        if (s === agent && status === 'idle') {
          d()
          resolve()
        }
      })
    })
  }

  it('emits output-repetition/detected once when a step streams a repeated section', async () => {
    const { ctx, agent } = await harness({ minSectionChars: 64 })
    const section = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz0123' // 64 chars, non-periodic
    const detections: { sectionChars: number; repeatCount: number }[] = []
    ctx.on('output-repetition/detected', (payload) => {
      detections.push({ sectionChars: payload.sectionChars, repeatCount: payload.repeatCount })
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      () => sectionRepeatedResponse(section, 2, 'tail'),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(detections).toHaveLength(1)
    // The exact reported period may differ from 64 when a tail follows the copies
    // (the whole string can have a coincidental larger border); the section must
    // still be at least minSectionChars and repeat at least minRepeat times.
    expect(detections[0]!.sectionChars).toBeGreaterThanOrEqual(64)
    expect(detections[0]!.repeatCount).toBeGreaterThanOrEqual(2)
    // The durable log is untouched by the guard: the assistant message holds the full text.
    const messages = [...agent.session.events].filter((e): e is SessionEvent<'assistant/message'> => e.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    const text = messages[0]!.data.message.content.map(b => b.type === 'text' ? b.text : '').join('')
    expect(text).toBe(section + section + 'tail')
  })

  it('emits nothing for non-repetitive output', async () => {
    const { ctx, agent } = await harness({ minSectionChars: 64 })
    let fired = 0
    ctx.on('output-repetition/detected', () => {
      fired += 1
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      textResponse('ordinary output '.repeat(8)),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(fired).toBe(0)
  })
})

describe('abort mode', () => {
  /** Stream one full text block per-char so cancellation can land mid-stream. */
  function perCharResponse(text: string): StreamChunk[] {
    return [
      { type: 'block-start', index: 0, blockType: 'text' },
      ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
  }

  async function abortHarness(config: object): Promise<{ ctx: Context; agent: Agent }> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(OutputRepetitionGuard, config)
    return { ctx, agent: ctx.agentLoop.create(SessionId('a9'), { provider: 'mock', model: 'mock' }) }
  }

  function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
    return new Promise((resolve) => {
      const d = ctx.on('agent/status', ({ agent: s, status }) => {
        if (s === agent && status === 'idle') {
          d()
          resolve()
        }
      })
    })
  }

  it('cancels the streaming turn on detection and preserves one interrupted copy', async () => {
    const { ctx, agent } = await abortHarness({ minSectionChars: 64, abortStream: true })
    const section = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz0123' // 64 non-periodic chars
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      () => perCharResponse(section + section + section),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const turns = [...agent.session.events].filter((e): e is SessionEvent<'turn/end'> => e.type === 'turn/end')
    expect(turns.at(-1)!.data.reason.kind).toBe('aborted')
    // The streamed prefix was preserved as an interrupted assistant message —
    // not the full triple repetition.
    const messages = [...agent.session.events].filter((e): e is SessionEvent<'assistant/message'> => e.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.data.interrupted).toBe(true)
    const text = messages[0]!.data.message.content.map(b => b.type === 'text' ? b.text : '').join('')
    expect(text.length).toBeLessThan(section.length * 3)
    expect(text.length).toBeGreaterThanOrEqual(section.length * 2)
  })

  it('stays telemetry-only when abortStream is false (default)', async () => {
    const { ctx, agent } = await abortHarness({ minSectionChars: 64 })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      () => perCharResponse('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz0123'.repeat(2)),
    ]))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const turns = [...agent.session.events].filter((e): e is SessionEvent<'turn/end'> => e.type === 'turn/end')
    expect(turns.at(-1)!.data.reason.kind).toBe('completed')
  })
})
