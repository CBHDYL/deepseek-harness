/**
 * P6-4/P6-5 compaction summarizer reserve: the summarizer's own dispatch is
 * bounded by `summarizationMaxBytes` over the EXACT dispatched model-facing
 * envelope (messages + system + tools, UTF-8 bytes). Oversize means zero
 * provider dispatch and the typed COMPACTION_BUDGET_EXCEEDED failure — never
 * truncation, retry, or a silent fall-through that could replace the surface
 * without a successful summary. The predicate is strict `>`: an envelope
 * exactly at the allowance dispatches.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  summarizeWithLlm,
  COMPACTION_BUDGET_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []

async function harness(): Promise<{ ctx: Context; adapter: MockAdapter; agent: Agent }> {
  const adapter = new MockAdapter([textResponse('summary ok')])
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  ctx.llm.registerAdapter(['mock'], adapter)
  const session = Session.create(SessionId('summarizer-budget'))
  const agent = { session, options: { provider: 'mock', model: 'mock' } } as Agent
  return { ctx, adapter, agent }
}

async function run(ctx: Context, agent: Agent, maxBytes: number, input: SummarizationInput) {
  return summarizeWithLlm(ctx, {
    summarizationProvider: '',
    summarizationModel: '',
    maxTokens: 1024,
    summarizationMaxBytes: maxBytes,
  }, input, agent)
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(c => c.fiber.dispose()))
})

describe('P6-4/P6-5 compaction summarizer reserve', () => {
  it('an oversized summarizer envelope refuses BEFORE dispatch: zero provider calls, typed COMPACTION_BUDGET_EXCEEDED', async () => {
    const { ctx, adapter, agent } = await harness()
    const input: SummarizationInput = {
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'x'.repeat(4096) }],
        source: { kind: 'user' },
      })],
    }
    await expect(run(ctx, agent, 1, input)).rejects.toMatchObject({ code: COMPACTION_BUDGET_EXCEEDED_CODE })
    expect(adapter.requests).toHaveLength(0)
  })

  it('the allowance is strict: an envelope exactly at the ceiling dispatches exactly once, one byte over refuses', async () => {
    const { ctx, adapter, agent } = await harness()
    const input: SummarizationInput = {
      system: 'sys'.repeat(100),
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'x'.repeat(2048) }],
        source: { kind: 'user' },
      })],
      tools: [{ name: 'probe_tool', description: 'd'.repeat(512), parameters: {} }],
    }

    // Calibrate: run once under a permissive ceiling and measure the EXACT
    // envelope the adapter received (the summarizer appends its instruction
    // message, so the test reconstructs the boundary from the dispatched
    // request instead of duplicating production composition).
    await run(ctx, agent, 1024 * 1024 * 1024, input)
    expect(adapter.requests).toHaveLength(1)
    const dispatched = adapter.requests[0]!
    const exactBytes = new TextEncoder().encode(JSON.stringify({
      messages: dispatched.messages,
      ...dispatched.system === undefined ? {} : { system: dispatched.system },
      ...dispatched.tools === undefined ? {} : { tools: dispatched.tools },
    })).length
    expect(exactBytes).toBeGreaterThan(0)

    // Exactly at the allowance: strict `>` lets it dispatch.
    const exact = await harness()
    await expect(run(exact.ctx, exact.agent, exactBytes, input)).resolves.toBeDefined()
    expect(exact.adapter.requests).toHaveLength(1)

    // One byte over: refusal, zero dispatch.
    const over = await harness()
    await expect(run(over.ctx, over.agent, exactBytes - 1, input)).rejects.toMatchObject({ code: COMPACTION_BUDGET_EXCEEDED_CODE })
    expect(over.adapter.requests).toHaveLength(0)
  })

  it('multibyte UTF-8 counts bytes, not characters: CJK content trips the reserve at the byte boundary', async () => {
    const { ctx, adapter, agent } = await harness()
    // 3-byte chars: a char-counting implementation would undercount by 3x.
    const input: SummarizationInput = {
      messages: [createUserMessage({
        content: [{ type: 'text', text: '界'.repeat(2000) }],
        source: { kind: 'user' },
      })],
    }
    // Calibrate the exact byte size under a permissive ceiling.
    await run(ctx, agent, 1024 * 1024 * 1024, input)
    const dispatched = adapter.requests[0]!
    const exactBytes = new TextEncoder().encode(JSON.stringify({
      messages: dispatched.messages,
      ...dispatched.system === undefined ? {} : { system: dispatched.system },
      ...dispatched.tools === undefined ? {} : { tools: dispatched.tools },
    })).length
    // A char-based allowance (bytes/3) would still dispatch — the byte reserve refuses.
    const over = await harness()
    await expect(run(over.ctx, over.agent, exactBytes - 1, input)).rejects.toMatchObject({ code: COMPACTION_BUDGET_EXCEEDED_CODE })
    expect(over.adapter.requests).toHaveLength(0)
  })
})
