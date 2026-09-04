/**
 * P-BUDGET: the summarizer's INDEPENDENT byte allowance — recovery can never
 * re-dispatch an unbounded auxiliary request, and the refusal is distinct from
 * the runtime's global ceiling.
 */

import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, LlmError, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { COMPACTION_BUDGET_EXCEEDED_CODE, summarizeWithLlm } from '../src/summarizer.ts'
import type { SummarizationInput } from '../src/summarizer.ts'

class RecordingAdapter extends LlmAdapter {
  calls = 0

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function mount(): Promise<{ ctx: Context; adapter: RecordingAdapter }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['sum'], adapter)
  return { ctx, adapter }
}

function agentWith(): Agent {
  const session = Session.create(SessionId('summarizer-budget'))
  return { session, options: {} } as unknown as Agent
}

function input(text: string): SummarizationInput {
  return {
    messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })],
  }
}

/** Classify one summarization attempt: dispatched (incl. downstream errors) or refused by the allowance. */
async function classify(
  ctx: Context,
  config: { summarizationProvider: string; summarizationModel: string; maxTokens: number; summarizationMaxBytes: number },
  text: string,
): Promise<'dispatch' | 'budget'> {
  try {
    await summarizeWithLlm(ctx, config, input(text), agentWith())
    return 'dispatch'
  } catch (error) {
    return (error as LlmError).code === COMPACTION_BUDGET_EXCEEDED_CODE ? 'budget' : 'dispatch'
  }
}

describe('P-BUDGET summarizer independent allowance', () => {
  it('enforces a strict byte boundary: the largest dispatching input is exactly one byte below refusal', async () => {
    const { ctx, adapter } = await mount()
    const config = {
      summarizationProvider: 'sum',
      summarizationModel: 'sum-model',
      maxTokens: 100,
      summarizationMaxBytes: 3000,
    }
    // Binary search the largest text that still dispatches: each 'x' adds one
    // byte to the summarizer's own JSON envelope (which also carries the
    // fixed compaction instruction), so the boundary is exact.
    let low = 1
    let high = 5000
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (await classify(ctx, config, 'x'.repeat(mid)) === 'budget') high = mid - 1
      else low = mid
    }
    expect(await classify(ctx, config, 'x'.repeat(low))).toBe('dispatch')
    expect(await classify(ctx, config, 'x'.repeat(low + 1))).toBe('budget')
    expect(adapter.calls).toBeGreaterThan(0) // the boundary input really dispatched
    await ctx.fiber.dispose()
  })

  it('refuses a huge summarization input with the compaction code, never dispatching', async () => {
    const { ctx, adapter } = await mount()
    const config = {
      summarizationProvider: 'sum',
      summarizationModel: 'sum-model',
      maxTokens: 100,
      summarizationMaxBytes: 100,
    }
    const failure = await summarizeWithLlm(ctx, config, input('y'.repeat(10_000)), agentWith())
      .then(() => undefined, (error: unknown) => error as LlmError)
    expect(failure?.code).toBe(COMPACTION_BUDGET_EXCEEDED_CODE)
    expect(failure?.message).toContain('refusing to dispatch')
    expect(adapter.calls).toBe(0)
    await ctx.fiber.dispose()
  })
})
