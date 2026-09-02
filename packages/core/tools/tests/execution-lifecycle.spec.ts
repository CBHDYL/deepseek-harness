import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import ToolRuntime, {
  defineContentToolFixture,
  TOOL_RUNTIME_SCHEDULER,
  type PreToolDecision,
  type ToolExecution,
} from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

const signal = new AbortController().signal

async function setup(withApproval = false): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withApproval) await ctx.plugin(ApprovalService, {})
  return ctx
}

function countingTool(ran: string[]) {
  return defineContentToolFixture({
    name: 'x', description: 'x', parameters: {}, effects: 'side-effectful',
    async execute() { ran.push('x'); return [{ type: 'text', text: 'ok' }] },
  })
}

function agentWith(events: SessionEvent[] = []) {
  const session = {
    id: 'session-1',
    events,
    append(type: string, data: Record<string, unknown>) {
      const event = { type, data, seq: this.events.length + 1, time: 0 } as SessionEvent
      this.events.push(event)
      return event
    },
  }
  return { session } as unknown as Agent
}

function openTurnEvents(): SessionEvent[] {
  return [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }]
}

function askPolicy(_exec: ToolExecution, _next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
  return Promise.resolve({ kind: 'ask' })
}

describe('execution lifecycle', () => {
  it('one public execution attempt dispatches the body once', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))

    const result = await ctx.tools.execute({
      callId: ToolCallId('call-1'), name: 'x', arguments: {}, signal,
    })

    expect(result.isError).toBe(false)
    expect(ran).toEqual(['x'])
  })

  it('an allowed-once prepared execution fails closed when its grant was already consumed', async () => {
    const ctx = await setup(true)
    const ran: string[] = []
    const agent = agentWith(openTurnEvents())
    ctx.tools.register(countingTool(ran))
    ctx.on('tools/pre-execute', askPolicy)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({
      callId: ToolCallId('call-1'), name: 'x', arguments: {}, agent, signal,
    })
    expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') return

    const approvalIdentity = {
      operationId: prepared.exec.operationId,
      toolName: prepared.exec.name,
      callId: prepared.exec.callId,
      argsDigest: (await import('node:crypto')).createHash('sha256')
        .update(JSON.stringify(prepared.exec.arguments)).digest('hex'),
    }
    expect(ctx.approval.takeGrant(approvalIdentity)).toBe(true)

    const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)

    expect(dispatched.kind).toBe('final-result')
    if (dispatched.kind === 'final-result') {
      expect(dispatched.result).toMatchObject({
        isError: true,
        error: { message: 'authorization grant missing or no longer matches this execution' },
      })
    }
    expect(ctx.approval.takeGrant(approvalIdentity)).toBe(false)
    expect(ran).toEqual([])
  })

  it('argument substitution after approval cannot change what dispatches: the body runs the approved snapshot', async () => {
    const ctx = await setup(true)
    const received: unknown[] = []
    const agent = agentWith(openTurnEvents())
    ctx.tools.register(defineContentToolFixture({
      name: 'x', description: 'x', parameters: {},
      async execute(args) { received.push(args); return [{ type: 'text', text: 'ok' }] },
    }))
    ctx.on('tools/pre-execute', askPolicy)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({
      callId: ToolCallId('call-1'), name: 'x', arguments: { value: 1 }, agent, signal,
    })
    expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') return
    ;(prepared.exec as unknown as { arguments: unknown }).arguments = { value: 2 }

    // The grant still matches the authority snapshot, so dispatch proceeds —
    // and the body receives the APPROVED creation-time arguments, not the
    // substituted ones.
    const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)

    expect(dispatched.kind).toBe('post-result')
    if (dispatched.kind === 'post-result') expect(dispatched.result.isError).toBe(false)
    expect(received).toEqual([{ value: 1 }])
  })

  it('a tools/execute wrapper cannot substitute arguments after the grant fence: the body runs the approved snapshot', async () => {
    const ctx = await setup(true)
    const received: unknown[] = []
    const agent = agentWith(openTurnEvents())
    ctx.tools.register(defineContentToolFixture({
      name: 'x', description: 'x', parameters: {},
      async execute(args) { received.push(args); return [{ type: 'text', text: 'ok' }] },
    }))
    ctx.on('tools/pre-execute', askPolicy)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    // The wrapper runs AFTER the dispatch-time grant fence: reassigning the
    // mutable field must not change what the body executes.
    ctx.on('tools/execute', async (exec, next) => {
      ;(exec as unknown as { arguments: unknown }).arguments = { value: 'substituted' }
      return next()
    })

    const result = await ctx.tools.execute({
      callId: ToolCallId('call-1'), name: 'x', arguments: { value: 'approved' }, agent, signal,
    })

    expect(result.isError).toBe(false)
    expect(received).toEqual([{ value: 'approved' }])
  })

  it('a tools/execute wrapper cannot substitute the tool name after the grant fence: resolution stays on the approved tool', async () => {
    const ctx = await setup(true)
    const ran: string[] = []
    const agent = agentWith(openTurnEvents())
    ctx.tools.register(defineContentToolFixture({
      name: 'a', description: 'a', parameters: {},
      async execute() { ran.push('a'); return [{ type: 'text', text: 'a ok' }] },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'b', description: 'b', parameters: {},
      async execute() { ran.push('b'); return [{ type: 'text', text: 'b ok' }] },
    }))
    ctx.on('tools/pre-execute', askPolicy)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    ctx.on('tools/execute', async (exec, next) => {
      ;(exec as unknown as { name: string }).name = 'b'
      return next()
    })

    const result = await ctx.tools.execute({
      callId: ToolCallId('call-1'), name: 'a', arguments: {}, agent, signal,
    })

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'a ok' }])
    expect(ran).toEqual(['a'])
  })

  it('mints distinct operation ids for many executions in one session', async () => {
    const ctx = await setup()
    const ran: string[] = []
    const agent = agentWith()
    const operationIds: string[] = []
    ctx.tools.register(countingTool(ran))
    ctx.on('tools/result', (exec) => { operationIds.push(exec.operationId) })

    for (let index = 1; index <= 20; index += 1) {
      await ctx.tools.execute({
        callId: ToolCallId(`call-${index}`), name: 'x', arguments: {}, agent, signal,
      })
    }

    expect(operationIds).toEqual(Array.from({ length: 20 }, (_, index) => `op_${index + 1}`))
    expect(new Set(operationIds).size).toBe(operationIds.length)
  })

  it('a fresh registry seeds the next operation id from persisted tool rows', async () => {
    const persisted = [
      {
        type: 'tool/call', seq: 1, time: 0,
        data: { turn: 1, step: 1, callId: ToolCallId('old-call'), name: 'x', arguments: '{}', operationId: 'op_5' },
      },
      {
        type: 'tool/code-dispatch', seq: 2, time: 0,
        data: {
          rootCallId: ToolCallId('old-call'), parentCallId: ToolCallId('old-call'),
          subCallId: ToolCallId('old-call:code:1'), name: 'x', arguments: {},
          isError: false, content: [], operationId: 'op_4',
        },
      },
    ] as SessionEvent[]
    const agent = agentWith(persisted)

    const first = await setup()
    await first.fiber.dispose()
    const reloaded = await setup()
    const ran: string[] = []
    let operationId: string | undefined
    reloaded.tools.register(countingTool(ran))
    reloaded.on('tools/result', (exec) => { operationId = exec.operationId })

    await reloaded.tools.execute({
      callId: ToolCallId('new-call'), name: 'x', arguments: {}, agent, signal,
    })

    expect(operationId).toBe('op_6')
    expect(ran).toEqual(['x'])
  })

  it('cross-invariant A: a repaired persisted log seeds the next operation id from its preserved committed rows', async () => {
    // PR-3 repair preserves committed tool rows; PR-2's high-water seeding
    // must continue from a REPAIRED history (composition evidence).
    const root = await mkdtemp(join(tmpdir(), 'dsh-cross-a-'))
    const pctx = new Context()
    await pctx.plugin(SessionStore)
    await pctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const meta: SessionHeader = { version: 0, id: SessionId('cross-a'), createdAt: 1, cwd: '/work', delegationDepth: 0 }
    await pctx.sessionPersistence.create(meta)
    await pctx.sessionPersistence.append(meta.id, [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 1, callId: ToolCallId('cross-a-call'), name: 'x', arguments: '{}', operationId: 'op_5' } },
      { type: 'tool/result', seq: 3, time: 3, data: { turn: 1, step: 1, operationId: 'op_5', message: { id: 'm-1', role: 'user', source: { kind: 'tool', callId: ToolCallId('cross-a-call') }, content: [{ type: 'tool-result', toolCallId: ToolCallId('cross-a-call'), isError: false, content: [{ type: 'text', text: 'ok' }] }] } as never }, surfaceOp: 'append' as const },
    ] as SessionEvent[])
    // Tear the tail and repair: the committed op_5 rows must survive verbatim.
    const location = pctx.sessionPersistence.locate(meta)
    if (location === undefined) throw new Error('jsonl backend must expose the artifact location')
    await appendFile(location.path, '\n{"torn tail')
    const repaired = await pctx.sessionPersistence.load(meta.id)
    expect(repaired.events.at(-1)?.type).toBe('session/repaired')
    expect(repaired.events.some(event => event.type === 'tool/call' && event.data.operationId === 'op_5')).toBe(true)
    await pctx.fiber.dispose()

    // A fresh registry seeds from the repaired history: next id is op_6.
    const ctx = await setup()
    const ran: string[] = []
    let operationId: string | undefined
    ctx.tools.register(countingTool(ran))
    ctx.on('tools/result', (exec) => { operationId = exec.operationId })
    const agent = agentWith([...repaired.events])

    await ctx.tools.execute({
      callId: ToolCallId('cross-a-new'), name: 'x', arguments: {}, agent, signal,
    })

    expect(operationId).toBe('op_6')
    expect(ran).toEqual(['x'])
    await rm(root, { recursive: true, force: true })
  })

  it('finalizing a dispatched execution returns the authoritative frozen result', async () => {
    const ctx = await setup()
    const ran: string[] = []
    ctx.tools.register(countingTool(ran))
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({
      callId: ToolCallId('call-1'), name: 'x', arguments: {}, signal,
    })
    if (prepared.kind !== 'dispatch') throw new Error('expected dispatch')
    const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)
    if (dispatched.kind !== 'post-result') throw new Error('expected post-result')

    const result = await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(prepared.exec, dispatched.result)

    expect(result.isError).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.content)).toBe(true)
    expect(Object.isFrozen(prepared.exec)).toBe(true)
    expect(ran).toEqual(['x'])
  })
})
