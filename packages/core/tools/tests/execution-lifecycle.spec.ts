/**
 * Registry-owned execution lifecycle: one execution attempt may dispatch at
 * most once, authorization takes atomically at the dispatch boundary, and the
 * durable operation identity is per-session, restart-safe, and never
 * caller-selectable. These are the permanent negative tests for the
 * verification review's P0/P1 probes.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineContentToolFixture, TOOL_RUNTIME_SCHEDULER, type PreToolDecision, type ToolExecution,
} from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

const signal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function countingTool(ran: string[]) {
  return defineContentToolFixture({
    name: 'x', description: 'x', parameters: {}, effects: 'side-effectful',
    async execute() { ran.push('x'); return [{ type: 'text', text: 'ok' }] },
  })
}

function sessionWith(calls: number): { session: { events: SessionEvent[]; id: ReturnType<typeof SessionId> } } {
  const events: SessionEvent[] = []
  for (let i = 1; i <= calls; i++) {
    events.push({ type: 'tool/call', seq: i, time: 0, data: { turn: 1, step: 1, callId: CallId(`c${i}`), name: 'x', arguments: '{}', operationId: `${i}` as never } } as never)
  }
  return { session: { events, id: SessionId('restart-session') } }
}

describe('execution lifecycle: one-shot dispatch', () => {
  it('a captured prepared execution cannot dispatch twice', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({ callId: CallId('c'), name: 'x', arguments: {}, signal })
    expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') return
    const first = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)
    const second = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)
    expect(ran).toEqual(['x'])
    expect(first.kind).toBe('post-result')
    expect(second.kind).toBe('final-result')
    if (second.kind === 'final-result') expect(second.result.error?.info?.code).toBe('DUPLICATE_TOOL_DISPATCH')
  })

  it('concurrent dispatch of one prepared execution runs the body once', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({ callId: CallId('c'), name: 'x', arguments: {}, signal })
    expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') return
    await Promise.all([
      ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec),
      ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec),
    ])
    expect(ran).toEqual(['x'])
  })

  it('a tools/execute wrapper invoking next() twice dispatches the body once', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    ctx.on('tools/execute', async (_exec, next) => {
      await next()
      const second = await next()
      expect(second.isError).toBe(true)
      expect(second.error?.info?.code).toBe('DUPLICATE_TOOL_DISPATCH')
      return second
    })
    const result = await ctx.tools.execute({ callId: CallId('c'), name: 'x', arguments: {}, signal })
    expect(result.error?.info?.code).toBe('DUPLICATE_TOOL_DISPATCH')
    expect(ran).toEqual(['x'])
  })
})

describe('execution lifecycle: atomic authorization take', () => {
  it('an allowed attempt takes its grant exactly once and the grant dies at dispatch', async () => {
    const ctx = await setup()
    await ctx.plugin(ApprovalService, {})
    const ran: string[] = []
    let captured: ToolExecution | undefined
    const fakeAgent = {
      ctx, session: { events: [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }], append: () => ({ seq: 2 }) },
    } as never
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => { captured = exec; return next() })
    ctx.tools.register(countingTool(ran))
    const result = await ctx.tools.execute({ callId: CallId('c'), name: 'x', arguments: {}, agent: fakeAgent, signal })
    expect(result.isError).toBe(false)
    expect(ran).toEqual(['x'])
    // The grant was taken at the dispatch boundary and revoked at the
    // terminal transition: nothing survives the attempt.
    expect(captured).toBeDefined()
    expect(ctx.approval.isAuthorized(captured!)).toBe(false)
    expect(ctx.approval.take(captured!)).toBe(false)
    expect(ctx.approval.executionApproval(captured!)).toBeUndefined()
  })

  it('cancellation after the grant mints and before the take revokes the grant (no live grant outlives the attempt)', async () => {
    const ctx = await setup()
    await ctx.plugin(ApprovalService, {})
    const ran: string[] = []
    const controller = new AbortController()
    let captured: ToolExecution | undefined
    const fakeAgent = {
      ctx, session: { events: [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }], append: () => ({ seq: 2 }) },
    } as never
    ctx.on('approval/request', (req) => {
      expect(req.signal).toBe(controller.signal)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => { captured = exec; return next() })
    // The monotonic guard runs AFTER the ask resolved allowed-once (the grant
    // is minted) and BEFORE the dispatch boundary: aborting the caller signal
    // here lands exactly in the allowed → minted → cancel-before-take window.
    ctx.tools.guard(() => {
      controller.abort()
      return undefined
    })
    ctx.tools.register(countingTool(ran))
    const result = await ctx.tools.execute({ callId: CallId('c'), name: 'x', arguments: {}, agent: fakeAgent, signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('ABORTED_BEFORE_DISPATCH')
    expect(ran).toEqual([])
    expect(captured).toBeDefined()
    expect(ctx.approval.isAuthorized(captured!)).toBe(false)
    expect(ctx.approval.take(captured!)).toBe(false)
    expect(ctx.approval.executionApproval(captured!)).toBeUndefined()
  })

  it('a mutated live operationId cannot move another attempt onto a grant', async () => {
    const ctx = await setup()
    await ctx.plugin(ApprovalService, {})
    const ran: string[] = []
    const fakeAgent = {
      ctx, session: { events: [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }], append: () => ({ seq: 2 }) },
    } as never
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    // A pre-execute listener rewrites the live object's operationId to an
    // unrelated string. Enforcement reads the frozen identity record, so the
    // rewrite cannot address another attempt's grant.
    ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => {
      ;(exec as unknown as { operationId: string }).operationId = 'forged'
      return next()
    })
    ctx.tools.register(countingTool(ran))
    const result = await ctx.tools.execute({ callId: CallId('c'), name: 'x', arguments: {}, agent: fakeAgent, signal })
    expect(result.isError).toBe(false)
    expect(ran).toEqual(['x'])
  })
})

describe('durable operation identity: restart-safe and never caller-selectable', () => {
  it('a caller-supplied id that was never minted is replaced by a registry-minted id', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const events: { type: string; data: Record<string, unknown> }[] = []
    const fakeAgent = {
      session: {
        events: [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } } as never, { type: 'step/start', seq: 2, time: 0, data: { turn: 1, step: 1 } } as never],
        append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }); return { seq: events.length + 2 } },
      },
    } as never
    await ctx.tools.execute({ callId: CallId('c'), name: 'x', arguments: {}, agent: fakeAgent, operationId: '12345' as never, signal })
    const call = events.find(e => e.type === 'tool/call')
    const result = events.find(e => e.type === 'tool/result')
    expect(call?.data.operationId).not.toBe('12345')
    expect(call?.data.operationId).toBeTruthy()
    expect(result?.data.operationId).toBe(call?.data.operationId)
  })

  it('a minted id claims exactly once through the scheduler channel; a replayed id is replaced', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const session = sessionWith(0)
    const minted = ctx.tools[TOOL_RUNTIME_SCHEDULER].mintOperationId(session.session as never)
    const ids: (string | undefined)[] = []
    ctx.on('tools/result', (exec: ToolExecution) => { ids.push(exec.operationId) })
    const first = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({ callId: CallId('c1'), name: 'x', arguments: {}, operationId: minted, signal })
    const second = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({ callId: CallId('c2'), name: 'x', arguments: {}, operationId: minted, signal })
    expect(first.kind === 'dispatch' && first.exec.operationId).toBe(String(minted))
    expect(second.kind === 'dispatch' && second.exec.operationId).not.toBe(String(minted))
  })

  it('the public execute path ignores a caller-supplied operation id and owns the audit rows (F4)', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const events: { type: string; data: Record<string, unknown> }[] = []
    const sessionEvents = [
      { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } } as never,
      { type: 'step/start', seq: 2, time: 0, data: { turn: 1, step: 1 } } as never,
    ]
    const fakeAgent = {
      session: {
        events: sessionEvents,
        append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }); return { seq: events.length + 2 } },
      },
    } as never
    // A scheduler-minted id supplied through the PUBLIC execute path must be
    // ignored: the registry mints its own id and owns tool/call+tool/result.
    const minted = ctx.tools[TOOL_RUNTIME_SCHEDULER].mintOperationId((fakeAgent as { session: never }).session)
    await ctx.tools.execute({ callId: CallId('c'), name: 'x', arguments: {}, agent: fakeAgent, operationId: minted, signal })
    const call = events.find(e => e.type === 'tool/call')
    const result = events.find(e => e.type === 'tool/result')
    expect(call).toBeDefined()
    expect(result).toBeDefined()
    expect(call?.data.operationId).not.toBe(String(minted))
    expect(result?.data.operationId).toBe(call?.data.operationId)
  })

  it('a fresh ToolRuntime seeds the counter from Code Mode rows too (F2)', async () => {
    const events: SessionEvent[] = [
      { type: 'tool/call', seq: 1, time: 0, data: { turn: 1, step: 1, callId: CallId('c1'), name: 'run_code', arguments: '{}', operationId: '1' as never } } as never,
      { type: 'tool/code-dispatch-start', seq: 2, time: 0, data: { rootCallId: CallId('c1'), parentCallId: CallId('c1'), subCallId: CallId('c1:code:1'), name: 'bash', arguments: {}, operationId: '2' as never } } as never,
      { type: 'tool/code-dispatch', seq: 3, time: 0, data: { rootCallId: CallId('c1'), parentCallId: CallId('c1'), subCallId: CallId('c1:code:1'), name: 'bash', arguments: {}, isError: false, content: [], operationId: '2' as never } } as never,
    ]
    const session = { events, id: SessionId('code-resume') } as never
    const ctx = await setup()
    expect(ctx.tools[TOOL_RUNTIME_SCHEDULER].mintOperationId(session)).toBe('3')
  })

  it('a fresh ToolRuntime (restart/HMR) seeds from the session log and never re-mints a logged id', async () => {
    const session = sessionWith(5)
    const ctx = await setup()
    const next = ctx.tools[TOOL_RUNTIME_SCHEDULER].mintOperationId(session.session as never)
    expect(next).toBe('6')
    // A brand-new runtime (the restart case) seeds from the same log.
    const ctx2 = await setup()
    const again = ctx2.tools[TOOL_RUNTIME_SCHEDULER].mintOperationId(session.session as never)
    expect(again).toBe('6')
  })
})

describe('scheduler entry guards (F3)', () => {
  it('a second finalize of a terminal execution appends no duplicate disposition and re-notifies nothing', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const events: { type: string; data: Record<string, unknown> }[] = []
    const fakeAgent = {
      session: {
        events: [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } } as never, { type: 'step/start', seq: 2, time: 0, data: { turn: 1, step: 1 } } as never],
        append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }); return { seq: events.length + 2 } },
      },
    } as never
    let notified = 0
    ctx.on('tools/result', () => { notified++ })
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({ callId: CallId('c'), name: 'x', arguments: {}, agent: fakeAgent, signal })
    if (prepared.kind !== 'dispatch') throw new Error('expected dispatch')
    const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)
    if (dispatched.kind !== 'post-result') throw new Error('expected post-result')
    const first = await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(prepared.exec, dispatched.result)
    const second = await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(prepared.exec, dispatched.result)
    expect(second).toBe(first)
    expect(events.filter(e => e.type === 'tool/result')).toHaveLength(1)
    expect(notified).toBe(1)
    expect(ran).toEqual(['x'])
  })

  it('finalize and dispatch reject an object the registry never minted', async () => {
    const ctx = await setup()
    ctx.tools.register(countingTool({} as never))
    const forged = { name: 'x', callId: CallId('f'), arguments: {}, signal } as never
    const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(forged)
    expect(dispatched.kind).toBe('final-result')
    if (dispatched.kind === 'final-result') expect(dispatched.result.error?.info?.code).toBe('UNRECOGNIZED_TOOL_EXECUTION')
    await expect(ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(forged, { content: [], isError: false } as never)).rejects.toThrow(/unrecognized execution/)
  })
})

describe('registry-owned audit for direct executions', () => {
  it('an agent-bearing direct execute logs tool/call and tool/result on one operation id', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const events: { type: string; data: Record<string, unknown> }[] = []
    const fakeAgent = {
      session: {
        events: [
          { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } } as never,
          { type: 'step/start', seq: 2, time: 0, data: { turn: 1, step: 1 } } as never,
        ],
        append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }); return { seq: events.length + 2 } },
      },
    } as never
    await ctx.tools.execute({ callId: CallId('direct'), name: 'x', arguments: {}, agent: fakeAgent, signal })
    const call = events.find(e => e.type === 'tool/call')
    const result = events.find(e => e.type === 'tool/result')
    expect(call).toBeDefined()
    expect(result).toBeDefined()
    expect(call?.data.operationId).toBeTruthy()
    expect(result?.data.operationId).toBe(call?.data.operationId)
  })
})
