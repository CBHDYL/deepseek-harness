/**
 * P-BUDGET: the runtime's hard UTF-8 byte ceiling at the provider-dispatch
 * boundary — exact ASCII/multibyte measurement, pre-dispatch refusal, and the
 * advisory-free normative metric.
 */

import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, LlmRuntime, PromptBudgetError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_REQUEST_BYTES, measureRequestBytes } from '../src/budget.ts'

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
  ctx.llm.registerAdapter(['budget'], adapter)
  return { ctx, adapter }
}

function options(text: string): GenerateOptions {
  return {
    provider: 'budget',
    model: 'budget-model',
    messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })],
  }
}

describe('P-BUDGET runtime byte ceiling', () => {
  it('dispatches exactly at the ceiling and refuses one ASCII byte past it', async () => {
    const { ctx, adapter } = await mount()
    const base = measureRequestBytes({ messages: options('base').messages })
    const atCeiling = options('base' + 'a'.repeat(DEFAULT_MAX_REQUEST_BYTES - base))
    expect(measureRequestBytes({ messages: atCeiling.messages })).toBe(DEFAULT_MAX_REQUEST_BYTES)
    expect(() => ctx.llm.stream(atCeiling)).not.toThrow()
    for await (const _ of ctx.llm.stream(atCeiling)) void _
    expect(adapter.calls).toBe(1)

    const onePast = options('base' + 'a'.repeat(DEFAULT_MAX_REQUEST_BYTES - base + 1))
    expect(() => ctx.llm.stream(onePast)).toThrow(PromptBudgetError)
    expect(adapter.calls).toBe(1) // no second dispatch
    await ctx.fiber.dispose()
  })

  it('counts multibyte UTF-8 (emoji) exactly, not by string length', async () => {
    const { ctx, adapter } = await mount()
    // 1_100_000 emoji = 4.4 MB UTF-8 but only 1.1M code units — only the byte
    // metric may refuse it.
    const request = options('😀'.repeat(1_100_000))
    const bytes = measureRequestBytes({ messages: request.messages })
    expect(bytes).toBeGreaterThan(DEFAULT_MAX_REQUEST_BYTES)
    expect(() => ctx.llm.stream(request)).toThrow(PromptBudgetError)
    expect(adapter.calls).toBe(0)
    await ctx.fiber.dispose()
  })

  it('refuses an oversized tool-schema payload before any adapter dispatch', async () => {
    const { ctx, adapter } = await mount()
    const request: GenerateOptions = {
      provider: 'budget',
      model: 'budget-model',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
      tools: [{
        name: 'oversized',
        description: 'x'.repeat(DEFAULT_MAX_REQUEST_BYTES),
        parameters: {},
      }],
    }
    expect(() => ctx.llm.stream(request)).toThrow(PromptBudgetError)
    expect(adapter.calls).toBe(0)
    await ctx.fiber.dispose()
  })

  it('names the provider route in the refusal facts', async () => {
    const { ctx } = await mount()
    const request = options('😀'.repeat(1_100_000))
    try {
      ctx.llm.stream(request)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(PromptBudgetError)
      const budget = error as PromptBudgetError
      expect(budget.provider).toBe('budget')
      expect(budget.bytes).toBe(measureRequestBytes({ messages: request.messages }))
      expect(budget.code).toBe('PROMPT_BUDGET_EXCEEDED')
    }
    await ctx.fiber.dispose()
  })
})
