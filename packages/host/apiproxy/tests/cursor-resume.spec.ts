import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/**
 * Host cursor resume: a mux open with `since` replays only the tail after the
 * cursor (incremental), and live pushes never duplicate replayed events.
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

async function drainUntil(
  iterable: AsyncIterable<RpcRequest<MuxFrame>>,
  predicate: (frame: MuxFrame) => boolean,
): Promise<MuxFrame[]> {
  const frames: MuxFrame[] = []
  for await (const envelope of iterable) {
    frames.push(envelope.payload)
    if (predicate(envelope.payload)) break
  }
  return frames
}

describe('mux cursor resume', () => {
  it('replays only events after the cursor and does not duplicate live pushes', async () => {
    const { ctx, session } = await harness()
    // Seed events seq 0..2 BEFORE the stream opens.
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const lastSeq = session.seq - 1 // client already has everything through here

    const proxy = api(ctx)
    // Open with since = lastSeq: only events AFTER the cursor should appear.
    const stream = proxy.events.mux({ rpcId: RpcId('t-cursor'), payload: { since: { [session.id]: lastSeq } } }, new AbortController().signal)
    const collected = drainUntil(stream, frame => frame.type === 'session/subscribed')
    const frames = await collected

    const events = frames.filter((frame): frame is Extract<MuxFrame, { type: 'session/event' }> => frame.type === 'session/event')
    expect(events).toHaveLength(0) // nothing after the cursor yet

    // A NEW event after the cursor arrives live, exactly once.
    const liveStream = proxy.events.mux({ rpcId: RpcId('t-cursor2'), payload: { since: { [session.id]: lastSeq } } }, new AbortController().signal)
    const liveFrames: MuxFrame[] = []
    const draining = (async () => {
      for await (const envelope of liveStream) {
        liveFrames.push(envelope.payload)
        if (liveFrames.some(f => f.type === 'session/event' && f.sessionId === session.id)) break
      }
    })()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await draining

    const liveEvents = liveFrames.filter((frame): frame is Extract<MuxFrame, { type: 'session/event' }> => frame.type === 'session/event' && frame.sessionId === session.id)
    expect(liveEvents).toHaveLength(1)
    expect(liveEvents[0]!.event.type).toBe('turn/end')
    await ctx.fiber.dispose()
  })

  it('replays the tail after a low cursor (incremental, not full refetch)', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const proxy = api(ctx)
    const stream = proxy.events.mux({ rpcId: RpcId('t-cursor3'), payload: { since: { [session.id]: 0 } } }, new AbortController().signal)
    const frames = await drainUntil(stream, frame => frame.type === 'session/subscribed')
    const events = frames.filter((frame): frame is Extract<MuxFrame, { type: 'session/event' }> => frame.type === 'session/event')
    // seq 1 (step/start) is above the cursor and must be replayed; seq 0 is not.
    expect(events.map(e => e.event.seq)).toEqual([1])
    await ctx.fiber.dispose()
  })
})
