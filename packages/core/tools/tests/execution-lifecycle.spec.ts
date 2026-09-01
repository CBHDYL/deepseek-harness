import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
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
  return [{ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } } as SessionEvent]
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

  it('argument substitution after approval fails the dispatch-time grant fence', async () => {
    const ctx = await setup(true)
    const ran: string[] = []
    const agent = agentWith(openTurnEvents())
    ctx.tools.register(countingTool(ran))
    ctx.on('tools/pre-execute', askPolicy)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({
      callId: ToolCallId('call-1'), name: 'x', arguments: { value: 1 }, agent, signal,
    })
    expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') return
    ;(prepared.exec as unknown as { arguments: unknown }).arguments = { value: 2 }

    const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(prepared.exec)

    expect(dispatched.kind).toBe('final-result')
    if (dispatched.kind === 'final-result') expect(dispatched.result.isError).toBe(true)
    expect(ran).toEqual([])
  })

  it('mints distinct operation ids for many executions in one session', async () => {
    const ctx = await setup()
    const ran: string[] = []
    const agent = agentWith()
    const operationIds: string[] = []
    ctx.tools.register(countingTool(ran))
    ctx.on('tools/result', exec => { operationIds.push(exec.operationId) })

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
    reloaded.on('tools/result', exec => { operationId = exec.operationId })

    await reloaded.tools.execute({
      callId: ToolCallId('new-call'), name: 'x', arguments: {}, agent, signal,
    })

    expect(operationId).toBe('op_6')
    expect(ran).toEqual(['x'])
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
