/**
 * P-AUTHZ authorization invariants: durable per-session operation identity,
 * single approval, exact grant binding, consume-once, and the creation-time
 * authority snapshot every dispatch-stage read follows.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, { TOOL_RUNTIME_SCHEDULER, defineContentToolFixture, type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'

const signal = new AbortController().signal

let callCounter = 0

function execInput(name: string, args: unknown, agent?: Agent): ToolExecutionInput {
  callCounter += 1
  return {
    signal,
    callId: ToolCallId(`call-${callCounter}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent } : {},
  }
}

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function agentWith(seedEvents: Array<{ type: string; data?: Record<string, unknown> }>): { agent: Agent; session: Session } {
  const sessionId = SessionId(`op-${Math.random().toString(36).slice(2, 10)}`)
  const session = Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    isSeeded: false,
  })
  for (const event of seedEvents) {
    // Surface-eligible types (user/message) require the marker; plain
    // lifecycle types must not carry one.
    const append = session.append.bind(session) as (...args: unknown[]) => unknown
    if (event.type === 'user/message') {
      append(event.type, event.data, { surfaceOp: 'append' })
    } else {
      append(event.type, event.data)
    }
  }
  return { agent: { session } as unknown as Agent, session }
}

function recordingTool(name: string, bodies: unknown[]): ReturnType<typeof defineContentToolFixture> {
  return defineContentToolFixture({
    name,
    description: 'test',
    parameters: {},
    async execute(args: unknown) {
      bodies.push({ tool: name, args })
      return [{ type: 'text', text: `${name} ok` }]
    },
  })
}

describe('operation identity and grant (P-AUTHZ)', () => {
  it('a legitimate allow executes the body with the approved arguments', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('plain', bodies))
    const { agent } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    const result = await ctx.tools.execute(execInput('plain', { v: 'ok' }, agent))
    expect(result.isError).toBe(false)
    expect(bodies).toEqual([{ tool: 'plain', args: { v: 'ok' } }])
  })

  it('ask -> approve dispatches exactly once and consumes the grant', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('guarded', bodies))
    const { agent, session } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    ctx.on('tools/pre-execute', (_exec, next) => {
      void next
      return Promise.resolve({ kind: 'ask' as const, reason: 'guard asks' })
    })
    const askSpy = vi.spyOn(ctx.approval, 'request')
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
    const input = execInput('guarded', { v: 1 }, agent)
    const result = await ctx.tools.execute(input)
    expect(result.isError).toBe(false)
    expect(bodies).toEqual([{ tool: 'guarded', args: { v: 1 } }])
    expect(askSpy).toHaveBeenCalledTimes(1)
    const asked = session.snapshotEvents().filter(e => e.type === 'approval/asked')
    expect(asked).toHaveLength(1)
    expect((asked[0]?.data as { operationId?: string }).operationId).toMatch(/^op_\d+$/)
  })

  it('ask -> deny never dispatches the body', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('denied', bodies))
    const { agent } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    ctx.on('tools/pre-execute', (_exec, next) => {
      void next
      return Promise.resolve({ kind: 'ask' as const, reason: 'guard asks' })
    })
    ctx.on('approval/request', () => Promise.resolve('rejected' as const))
    const result = await ctx.tools.execute(execInput('denied', {}, agent))
    expect(result.isError).toBe(true)
    expect(bodies).toHaveLength(0)
  })

  it('a second dispatch of the same execution fails closed (grant already consumed)', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('once', bodies))
    const { agent } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    ctx.on('tools/pre-execute', (_exec, next) => {
      void next
      return Promise.resolve({ kind: 'ask' as const, reason: 'guard asks' })
    })
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
    const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
    const prepared = await scheduler.prepare(execInput('once', { n: 1 }, agent))
    if (prepared.kind !== 'dispatch') throw new Error('expected dispatch stage')
    const dispatchedExec = prepared.exec
    const settle = async (dispatch: Awaited<ReturnType<typeof scheduler.dispatch>>): Promise<ToolExecutionResult> =>
      dispatch.kind === 'post-result'
        ? scheduler.finalize(dispatchedExec, dispatch.result)
        : scheduler.finish(dispatchedExec, dispatch.result)
    const first = await settle(await scheduler.dispatch(dispatchedExec))
    expect(first.isError).toBe(false)
    const replay = await settle(await scheduler.dispatch(dispatchedExec))
    expect(replay.isError).toBe(true)
    expect((replay.error as { message: string }).message).toContain('grant is missing or already consumed')
    expect(bodies).toEqual([{ tool: 'once', args: { n: 1 } }])
  })

  it('wrapper arguments mutation after approval cannot change what dispatches', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('subst', bodies))
    const { agent } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    ctx.on('tools/pre-execute', (_exec, next) => {
      void next
      return Promise.resolve({ kind: 'ask' as const, reason: 'guard asks' })
    })
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
    ctx.on('tools/execute', (exec, next) => {
      ;(exec as { arguments: unknown }).arguments = { v: 'substituted' }
      return next()
    })
    const result = await ctx.tools.execute(execInput('subst', { v: 'approved' }, agent))
    expect(result.isError).toBe(false)
    expect(bodies).toEqual([{ tool: 'subst', args: { v: 'approved' } }])
  })

  it('wrapper tool-name mutation after approval cannot change what dispatches', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('real', bodies))
    ctx.tools.register(recordingTool('decoy', bodies))
    const { agent } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    ctx.on('tools/pre-execute', (_exec, next) => {
      void next
      return Promise.resolve({ kind: 'ask' as const, reason: 'guard asks' })
    })
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
    ctx.on('tools/execute', (exec, next) => {
      ;(exec as { name: string }).name = 'decoy'
      return next()
    })
    const result = await ctx.tools.execute(execInput('real', {}, agent))
    expect(result.isError).toBe(false)
    expect(bodies).toEqual([{ tool: 'real', args: {} }])
  })

  it('a failing wrapper after dispatch yields an error result, never a fake not-executed', async () => {
    const ctx = await mounted()
    const bodies: unknown[] = []
    ctx.tools.register(recordingTool('boom-after', bodies))
    const { agent } = agentWith([{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { message: 'hi' } }])
    ctx.on('tools/execute', (_exec, next) => next().then(() => {
      throw new Error('wrapper failed after the body ran')
    }))
    const result: ToolExecutionResult = await ctx.tools.execute(execInput('boom-after', {}, agent))
    expect(result.isError).toBe(true)
    expect(bodies).toHaveLength(1)
  })

  it('mints distinct operation ids and seeds past the logged high-water mark', async () => {
    const ctx = await mounted()
    const { agent, session } = agentWith([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { message: 'hi' } },
      { type: 'tool/call', data: { turn: 0, step: 0, callId: 'old', name: 'plain', arguments: {}, operationId: 'op_3' } },
    ])
    const first = ctx.tools.mintOperationId(agent)
    const second = ctx.tools.mintOperationId(agent)
    expect(first).toBe('op_4')
    expect(second).toBe('op_5')
    expect(session.snapshotEvents().filter(e => e.type === 'tool/call')).toHaveLength(1)
  })

  it('agentless mints use the separate counter', async () => {
    const ctx = await mounted()
    const first = ctx.tools.mintOperationId(undefined)
    const second = ctx.tools.mintOperationId(undefined)
    expect(first).toMatch(/^op_x\d+$/)
    expect(second).not.toBe(first)
  })
})
