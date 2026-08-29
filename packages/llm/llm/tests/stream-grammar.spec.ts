import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '../src/index.ts'
import { LlmAdapter, createMessage, type GenerateOptions, type StreamChunk } from '../src/index.ts'

class ScriptedAdapter extends LlmAdapter {
  constructor(private script: StreamChunk[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * this.script
  }
}

const USER = createMessage({
  role: 'user',
  content: [{ type: 'text', text: 'hello' }],
  source: { kind: 'user' },
})

async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of chunks) out.push(chunk)
  return out
}

function run(script: StreamChunk[]): Promise<StreamChunk[]> {
  const ctx = new Context()
  return (async () => {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test-provider'], new ScriptedAdapter(script))
    return collect(ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [USER] }))
  })()
}

/** A well-formed minimal stream: one text block, usage, then a single stop finish. */
function properStream(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'hello' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('stream grammar enforcement', () => {
  it('passes a well-formed stream through unchanged', async () => {
    const script = properStream()
    expect(await run(script)).toEqual(script)
  })

  it('turns a clean EOF without a terminal finish into a structured protocol error', async () => {
    const chunks = await run(properStream().filter(chunk => chunk.type !== 'finish'))
    const last = chunks.at(-1)
    expect(last?.type).toBe('finish')
    if (last?.type !== 'finish') return
    expect(last.reason).toMatchObject({ kind: 'error', failure: { code: 'STREAM_UNTERMINATED' } })
  })

  it('drops a chunk delivered after the terminal finish (grammar stays one-finish)', async () => {
    const late: StreamChunk = { type: 'text-delta', index: 0, text: 'late' }
    const script = [...properStream(), late]
    const chunks = await run(script)
    // The late delta is rejected (never surfaces to the consumer); the stream
    // ends with the single valid finish.
    expect(chunks).toEqual(properStream())
  })

  it('drops a second terminal finish (grammar stays one-finish)', async () => {
    const secondFinish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
    const script = [...properStream(), secondFinish]
    const chunks = await run(script)
    expect(chunks).toEqual(properStream())
  })

  it('treats a mid-stream throw exactly as before (adapter failure chunk, no grammar interference)', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const failing = new class extends LlmAdapter {
      async * stream(): AsyncIterable<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'partial' }
        throw new Error('boom')
      }
    }()
    ctx.llm.registerAdapter(['test-provider'], failing)
    const chunks = await collect(ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [USER] }))
    const last = chunks.at(-1)
    expect(last?.type).toBe('finish')
    if (last?.type !== 'finish') return
    expect(last.reason).toMatchObject({ kind: 'error', failure: { message: 'boom' } })
  })
})
