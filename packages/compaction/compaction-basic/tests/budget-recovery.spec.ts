/**
 * P6-16 / E30: the prompt-budget rejection path cannot be bypassed through
 * compaction. When the final byte ceiling refuses a request and the
 * `agent/request-budget` recovery listener drives compaction, a summarizer
 * whose own reserve (`summarizationMaxBytes`) refuses the auxiliary call must
 * NOT dispatch anything, must NOT replace the surface, and the typed
 * PROMPT_BUDGET_EXCEEDED rejection survives — the historical compaction
 * bypass is closed on both dispatch paths.
 *
 * Test fidelity (F3 remediation): the seed reproduces the production loop's
 * exact step shape (`user/message → step/start → assistant/message →
 * step/end`), so the TokenMeter fold succeeds and the recovery path reaches
 * the summarizer. An observation subclass of the engine proves the summarizer
 * was actually CONSTRUCTED and refused by its byte reserve (the production
 * refusal message carries the measured byte count) — the test distinguishes
 * that refusal from any earlier failure and stays RED when the summarizer
 * bound is removed (CF-2).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(c => c.fiber.dispose()))
})

/** Test-only observation seam: count summarizer constructions and delegate to the real byte-bound path. */
class ObservingCompactionEngine extends BasicCompactionEngine {
  summarizeCalls = 0
  lastInput: SummarizationInput | undefined
  override async summarize(input: SummarizationInput, agent: Agent, signal?: AbortSignal): Promise<SummaryResult> {
    this.summarizeCalls += 1
    this.lastInput = input
    return super.summarize(input, agent, signal)
  }
}

/** The compacted allowance the summarizer must refuse the shadowed surface against. */
const SUMMARIZATION_ALLOWANCE = 512

/** Oversized surface seeded with the production loop's step shape behind one routed request header. */
function oversizedSeed(): SessionEvent[] {
  const events: SessionEvent[] = []
  let seq = 0
  events.push({ type: 'turn/start', seq: SessionSeq(seq++), time: seq, data: { turn: 1 } })
  events.push({
    type: 'request/header', seq: SessionSeq(seq++), time: seq,
    data: { header: { config: { provider: 'mock', model: 'mock' } }, reason: 'initial' },
  })
  for (let i = 0; i < 4; i++) {
    events.push({
      type: 'user/message', seq: SessionSeq(seq++), time: seq,
      data: createUserMessage({ content: [{ type: 'text', text: 'x'.repeat(2048) }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    })
    events.push({ type: 'step/start', seq: SessionSeq(seq++), time: seq, data: { turn: 1, step: i + 1 } })
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
    events.push({ type: 'step/end', seq: SessionSeq(seq++), time: seq, data: { turn: 1, step: i + 1 } })
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

describe('P6-16 / E30 compaction cannot bypass the request budget', () => {
  it('an oversize request whose recovery summarizer also refuses: zero dispatch, zero surface replacement, typed rejection preserved', async () => {
    // Two queued responses exist only so a bound REMOVAL (CF-2) would let the
    // summarizer dispatch and land a replacement — the assertions below then
    // turn RED for the right reason instead of failing on an empty queue.
    const adapter = new MockAdapter([textResponse('CHECKPOINT'), textResponse('ok')])
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentLoop, { agents: [] })
    // The compaction reserve is tiny on purpose: the auxiliary summarizer call
    // for the oversized surface is itself refused before dispatch.
    const engine = new ObservingCompactionEngine(ctx, { summarizationMaxBytes: SUMMARIZATION_ALLOWANCE })
    const warns: string[] = []
    ctx.logger.warn = ((message: string) => { warns.push(message) }) as never
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = (await ctx.agents.create({
      sessionId: SessionId('e30-attack'),
      seed: oversizedSeed(),
      agentOptions: {
        provider: 'mock',
        model: 'mock',
        maxRequestBytes: 4096,
        budgetCompactionRetries: 1,
      },
    })).agent
    const surfaceBefore = agent.session.surface.replaceGeneration
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // Budget recovery invoked exactly once and drove compaction all the way to
    // the summarizer construction — the observation seam proves the flow did
    // NOT die earlier (the pre-F3 fixture died in the TokenMeter fold here).
    expect(engine.summarizeCalls).toBe(1)
    expect(engine.lastInput).toBeDefined()
    // The summarizer envelope was constructed from the oversized region: its
    // replayed messages alone already exceed the compaction reserve.
    const inputBytes = new TextEncoder().encode(JSON.stringify({
      messages: engine.lastInput!.messages,
      ...engine.lastInput!.system === undefined ? {} : { system: engine.lastInput!.system },
      ...engine.lastInput!.tools === undefined ? {} : { tools: engine.lastInput!.tools },
    })).length
    expect(inputBytes).toBeGreaterThan(SUMMARIZATION_ALLOWANCE)

    // The production refusal message is the byte-bound evidence: the summarizer
    // measured the full envelope and refused BEFORE dispatch. Its absence (or a
    // token-meter fold warning) would mean the flow died before the bound.
    const refusal = warns.find(message => message.includes('compaction summarization input is') && message.includes('refusing to dispatch'))
    expect(refusal).toBeDefined()
    const measured = /summarization input is (\d+) bytes \(allowance 512\)/.exec(refusal!)
    expect(Number(measured?.[1])).toBeGreaterThan(SUMMARIZATION_ALLOWANCE)
    expect(warns.join('\n')).not.toContain('has no matching step/start event')

    // Neither the main loop nor the auxiliary summarizer dispatched anything.
    expect(adapter.requests).toHaveLength(0)
    expect(adapter.requests.some(request => request.purpose === 'compaction')).toBe(false)
    // No summary landed: the surface was not replaced without a successful summary.
    expect(agent.session.surface.replaceGeneration).toBe(surfaceBefore)
    expect(agent.session.snapshotEvents().some(event => event.type === 'compaction/summary')).toBe(false)
    // The typed request rejection survived the failed recovery.
    const end = agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)
    expect(end?.type === 'turn/end' && end.data.reason.kind === 'error' && end.data.reason.error.code).toBe('PROMPT_BUDGET_EXCEEDED')
  })
})
