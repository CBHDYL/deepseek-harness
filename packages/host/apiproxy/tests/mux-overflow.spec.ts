import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { DEFAULT_MAX_QUEUED_FRAMES } from '../src/api-proxy.ts'

/**
 * Downlink overflow: a consumer slower than the host's event rate loses the
 * oldest frames, and the stream says so instead of leaving the client on a
 * view that stopped tracking the session.
 */

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create()
  const agent = {
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as Agent
  ctx.agents.register(agent)
  return { ctx, session }
}

const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('mux downlink overflow', () => {
  it('announces the gap ahead of the frames that outlived it', async () => {
    const { ctx, session } = await harness()
    const proxy = api(ctx)
    // Opened but never drained: the subscription registers eagerly, so every
    // appended event queues behind a consumer that reads nothing.
    const stream = proxy.events.mux({ rpcId: RpcId('t-overflow'), payload: {} }, new AbortController().signal)
    for (let turn = 0; turn <= DEFAULT_MAX_QUEUED_FRAMES; turn += 1) {
      session.append('turn/start', { turn })
    }

    const frames: MuxFrame[] = []
    for await (const envelope of stream) {
      frames.push(envelope.payload)
      break
    }

    // First out of the queue: the marker precedes every surviving frame, so the
    // client rebuilds before applying anything that sits after the gap.
    const first = frames[0]
    expect(first?.type).toBe('session/resync')
    expect((first as Extract<MuxFrame, { type: 'session/resync' }>).dropped).toBeGreaterThan(0)
    await ctx.fiber.dispose()
  })
})
