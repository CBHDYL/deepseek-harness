/**
 * PR-4 single-flight invariants (adapted to the current topology): one
 * in-flight commit per session, no lost updates under concurrent triggers,
 * covered-clean accounting, tail recovery after rejections, ordered detach,
 * lifecycle rechecks after await gaps, and settle-gated dirty bookkeeping.
 * Deterministic barrier control — no sleep/timing races. The ported cache
 * keeps the upstream creation write, so gated scenarios account for the
 * creation task's own flush gate.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SessionProjectionCache from '../src/index.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'cache-test/race': RaceState
  }
  interface SessionProjectionMap {
    'cache-test/race': RaceState
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'cache-test/race': Record<string, never>
  }
  interface OutOfBandSessionEventMap {
    'cache-test/race': true
  }
}

/** The count unit's state; `poison` is a deliberate non-JSON seam (a nested Set). */
type RaceState = { n: number } | { n: number; poison: Set<unknown> }

const contexts: Context[] = []

interface HarnessOptions {
  /** The count event that makes `state.n` equal this value carries a non-JSON nested Set (deterministic serialization failure). */
  poisonAt?: number
  /** Block every `session/flush` until the matching gate in `flushGates` is released. */
  gateFlush?: boolean
}

/** The count unit definition with an optional non-JSON poison seam (serialization failure only, never a corrupted fold). */
const raceUnit = (options: HarnessOptions) => ({
  key: 'cache-test/race',
  stateSchema: z.union([z.object({ n: z.number() }), z.object({ n: z.number(), poison: z.instanceof(Set) })]),
  init: () => ({ n: 0 }),
  apply: (state, event) => {
    if (event.type !== 'cache-test/race') return state
    const n = state.n
    // poisonAt makes the event that would yield `n === poisonAt` carry a
    // nested Set (non-JSON) while preserving the count: that checkpoint
    // write fails at serialization, and the next event heals it.
    return options.poisonAt === n + 1 ? { n: n + 1, poison: new Set() } : { n: n + 1 }
  },
  wire: {
    viewSchema: z.union([z.object({ n: z.number() }), z.object({ n: z.number(), poison: z.instanceof(Set) })]),
    view: state => state,
  },
  stateVersion: 1,
}) satisfies Omit<ProjectionDefinition<'cache-test/race', RaceState>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<'cache-test/race', RaceState>['wire']>
}

/** Context with storage + registry + cache wired; `session` is the created session, `flushGates` collects flush-release gates. */
async function harness(
  config: { writeEveryEvents: number; writeIntervalMs: number },
  options: HarnessOptions = {},
) {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(raceUnit(options))
  ctx.provide('sessionPersistence', {
    readFrom: async () => ({ meta: { version: 0, id: SessionId('x'), createdAt: 0 }, events: [] }),
    flush: async () => true,
  } as never)
  const flushGates: Array<() => void> = []
  if (options.gateFlush) {
    ctx.on('session/flush', () => new Promise<void>((resolve) => { flushGates.push(resolve) }))
  }
  await ctx.plugin(SessionProjectionCache, config)
  const session = ctx.sessions.create(SessionId('race'), { meta: { createdAt: 0 } })
  session.append('turn/start', { turn: 1 })
  return { ctx, session, cache: ctx.sessionProjectionCache, pool, flushGates }
}

/** A bare context (storage + registry + cache, no session) for tests that own the session lifecycle. */
async function bareContext(config: { writeEveryEvents: number; writeIntervalMs: number }, options: HarnessOptions = {}) {
  const pool = new MemoryMediaPool()
  const c = new Context()
  contexts.push(c)
  await c.plugin(Storage)
  c.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(c, { backend: 'memory', routes: {} })
  c.storage.mount('domain', facility)
  c.provide('storageDomain', facility)
  await c.plugin(SessionStore)
  await c.plugin(SessionProjectionRegistry)
  c.sessionProjections.register(raceUnit(options))
  c.provide('sessionPersistence', {
    readFrom: async () => ({ meta: { version: 0, id: SessionId('x'), createdAt: 0 }, events: [] }),
    flush: async () => true,
  } as never)
  const flushGates: Array<() => void> = []
  if (options.gateFlush) {
    c.on('session/flush', () => new Promise<void>((resolve) => { flushGates.push(resolve) }))
  }
  await c.plugin(SessionProjectionCache, config)
  return { c, pool, flushGates }
}

function rowOf(pool: MemoryMediaPool, id: string) {
  return pool.media.get('session_projcache')?.tables.get('sessions')?.get(id) as
    { rows: Record<string, { ver: number; seq: number; val: unknown }> } | undefined
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** Release parked flush gates until the session's creation cut lands (the
 * store's own materialization flush and the cache's creation write each park
 * one gate in the gated harness). */
async function drainToCreation(pool: MemoryMediaPool, gates: Array<() => void>, id: string): Promise<void> {
  // Release parked flush gates until the creation cut lands AND the gate
  // queue is empty: the store's materialization flush count varies with
  // microtask timing, so drain whatever the pre-scenario phase parked.
  for (let guard = 0; guard < 10; guard += 1) {
    const cutLanded = rowOf(pool, id)?.rows?.['cache-test/race'] !== undefined
    const gate = gates.shift()
    if (gate === undefined) {
      if (cutLanded) return
      await settle()
      continue
    }
    gate()
    await settle()
    await settle()
  }
  throw new Error('creation cut never landed')
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('PR-4 single-flight projection', () => {
  it('P1/P2: concurrent mandatory triggers never overlap; every committed event lands in the final row', async () => {
    const { session, pool } = await harness({ writeEveryEvents: 1000, writeIntervalMs: 60_000 })
    // Interleave turn/end (mandatory write) with a burst of events across
    // ticks: each trigger enqueues on ONE tail; the final stored cut must
    // carry the newest registry state, never an older one.
    for (let i = 0; i < 5; i++) {
      session.append('cache-test/race', {})
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await settle()
    }
    await settle()
    await settle()
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { seq: number; val: { n: number } } | undefined
    expect(stored?.val.n).toBe(5)
    expect(stored?.seq).toBe(session.snapshotEvents().at(-1)?.seq)
  })

  it('P2/P6: an event committed while a write is in flight survives its stale cut; dirty stays set until the follow-up settles', async () => {
    const { session, cache, pool, flushGates } = await harness(
      { writeEveryEvents: 1000, writeIntervalMs: 60_000 },
      { gateFlush: true },
    )
    // The store's own materialization flush and the ported cache's creation
    // write each park one gate; drain both before the scenario.
    await drainToCreation(pool, flushGates, 'race')
    expect(rowOf(pool, 'race')?.rows?.['cache-test/race']?.val).toEqual({ n: 0 })
    // Task A is enqueued by turn/end and parks INSIDE its flush await gap.
    session.append('cache-test/race', {}) // n: 1, pending 1
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // enqueue A
    await settle()
    expect(flushGates).toHaveLength(1) // A is parked at the flush gate
    // A's checkpoint cut is already taken (n: 1). A second event arrives
    // while A is past its cut: its trigger must enqueue a FOLLOW-UP task,
    // never coalesce onto a cut that cannot include it.
    session.append('cache-test/race', {}) // n: 2, pending 2
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // enqueue B
    await settle()
    expect(flushGates).toHaveLength(1) // B is queued, not running (A still parked)
    flushGates.shift()!() // release A's flush
    await settle()
    await settle()
    // A's stale cut (n: 1) landed, but its success retires ONLY the pending
    // event it covered: the mid-flight event stays dirty for B.
    expect(cache.dirtyStats(session).pending).toBe(1)
    expect(rowOf(pool, 'race')?.rows?.['cache-test/race']?.val).toEqual({ n: 1 })
    // B parks at the second flush gate with the newest cut.
    expect(flushGates).toHaveLength(1)
    flushGates[0]!()
    await settle()
    await settle()
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { seq: number; val: { n: number } } | undefined
    expect(stored?.val.n).toBe(2)
    expect(stored?.seq).toBe(session.snapshotEvents().at(-1)?.seq)
    expect(cache.dirtyStats(session).pending).toBe(0)
    expect(cache.dirtyStats(session).failures).toBe(0)
  })

  it('P3: a rejected write does not poison the tail; the next write succeeds and carries the newest cut', async () => {
    const { session, cache, pool } = await harness(
      { writeEveryEvents: 1, writeIntervalMs: 60_000 },
      { poisonAt: 1 },
    )
    // The first event makes the checkpoint non-JSON (its trigger coalesces
    // onto the creation task, whose cut then carries the poison): the write
    // fails at serialization; the tail must recover and the healed second
    // write must succeed with the newest cut.
    session.append('cache-test/race', {}) // triggers count-threshold write → fails
    await settle(); await settle()
    expect(cache.dirtyStats(session).failures).toBe(1)
    expect(cache.dirtyStats(session).pending).toBeGreaterThan(0)
    session.append('cache-test/race', {}) // heals state; next write succeeds
    await settle(); await settle(); await settle()
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { val: { n: number } } | undefined
    expect(stored?.val.n).toBe(2)
  })

  it('middle reject: the second of three writes fails; the third heals and the failure streak resets', async () => {
    const { session, cache, pool } = await harness(
      { writeEveryEvents: 1, writeIntervalMs: 60_000 },
      { poisonAt: 2 },
    )
    // Sequential deterministic failure in the MIDDLE of the tail: write 1 ok
    // (coalesced creation cut), write 2 fails at serialization, write 3
    // succeeds and resets the streak.
    session.append('cache-test/race', {}) // n: 1 → write ok
    await settle(); await settle()
    expect(cache.dirtyStats(session).failures).toBe(0)
    session.append('cache-test/race', {}) // n: 2 → write fails
    await settle(); await settle()
    expect(cache.dirtyStats(session).failures).toBe(1)
    expect(cache.dirtyStats(session).retriesLeft).toBe(2)
    session.append('cache-test/race', {}) // n: 3 → write ok, streak resets
    await settle(); await settle(); await settle()
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { val: { n: number } } | undefined
    expect(stored?.val.n).toBe(3)
    expect(cache.dirtyStats(session).failures).toBe(0)
    expect(cache.dirtyStats(session).retriesLeft).toBe(3)
  })

  it('P4/P6: detach is an ordered final task; dirty bookkeeping survives until its settle', async () => {
    const { c, pool } = await bareContext({ writeEveryEvents: 1000, writeIntervalMs: 60_000 })
    // Sessions dispose with their owning fiber: create in a child plugin.
    let session: Session | undefined
    const owner = await c.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create(SessionId('race'), { meta: { createdAt: 0 } })
      session.append('turn/start', { turn: 1 })
    }, { inject: ['sessions'] }))
    if (session === undefined) throw new Error('session was not created')
    session.append('cache-test/race', {})
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // enqueue write
    await owner.dispose() // detach fires session/disposed → ordered final task
    await settle(); await settle()
    const row = rowOf(pool, 'race')
    const stored = row?.rows?.['cache-test/race'] as { val: { n: number } } | undefined
    expect(stored?.val.n).toBe(1)
    // After detach, no new live write can resurrect the projection row.
    const before = JSON.stringify(row)
    session.append('cache-test/race', {}) // post-detach event: no enqueue
    await settle(); await settle()
    expect(JSON.stringify(rowOf(pool, 'race'))).toBe(before)
  })

  it('P7: a write whose session detaches during its flush stands down; the ordered final task publishes the last cut', async () => {
    const { c, pool, flushGates } = await bareContext(
      { writeEveryEvents: 1000, writeIntervalMs: 60_000 },
      { gateFlush: true, poisonAt: 1 },
    )
    const warns: string[] = []
    const originalWarn = c.logger.warn.bind(c.logger) as (...args: unknown[]) => void
    c.logger.warn = (...args: unknown[]) => { warns.push(String(args[0])); originalWarn(...args) }
    let session: Session | undefined
    const owner = await c.plugin(Object.assign((inner: Context) => {
      session = inner.sessions.create(SessionId('race'), { meta: { createdAt: 0 } })
      session.append('turn/start', { turn: 1 })
    }, { inject: ['sessions'] }))
    if (session === undefined) throw new Error('session was not created')
    // The store's materialization flush and the creation write each park one
    // gate; drain both before the scenario.
    await drainToCreation(pool, flushGates, 'race')
    session.append('cache-test/race', {}) // n: 1 poisoned cut
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // task A parks at flush
    await settle()
    expect(flushGates).toHaveLength(1) // A is past its cut, parked in the await gap
    session.append('cache-test/race', {}) // n: 2, heals the cut
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // task B enqueued
    await owner.dispose() // detach: final task C enqueued after A and B
    flushGates[0]!() // A resumes: its session detached during the flush → A must stand down
    await settle(); await settle(); await settle()
    // B also stands down (non-final, detached); C is the ordered final task.
    expect(flushGates.length).toBeGreaterThan(0) // B and/or C parked at gates
    while (flushGates.length > 0) {
      flushGates.shift()!()
      await settle()
      await settle()
    }
    // A's poisoned cut never reached a put (no warn, no failure) and the
    // ordered final task published the healed newest cut.
    expect(warns).toEqual([])
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { seq: number; val: { n: number } } | undefined
    expect(stored?.val.n).toBe(2)
    expect(stored?.seq).toBe(session.snapshotEvents().at(-1)?.seq)
  })

  it('queue reuse after drain: a second burst on the settled tail lands without residue', async () => {
    const { session, cache, pool } = await harness({ writeEveryEvents: 1000, writeIntervalMs: 60_000 })
    session.append('cache-test/race', {})
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle(); await settle()
    expect(cache.dirtyStats(session).pending).toBe(0)
    expect((rowOf(pool, 'race')?.rows?.['cache-test/race'] as { val: { n: number } })?.val.n).toBe(1)
    // The same tail is reused for the next burst.
    session.append('cache-test/race', {})
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle(); await settle()
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { val: { n: number } } | undefined
    expect(stored?.val.n).toBe(2)
    expect(cache.dirtyStats(session).pending).toBe(0)
  })

  it('session/repaired adjacent to normal updates: the checkpoint still lands at the canonical event seq', async () => {
    const { session, pool } = await harness({ writeEveryEvents: 1000, writeIntervalMs: 60_000 })
    // A required-on-read surface diagnostic between ordinary updates must
    // not disturb projection ordering: the registry ignores it and the row
    // still lands at the canonical last event seq.
    session.append('cache-test/race', {})
    session.append('session/repaired', {
      message: createUserMessage({
        content: [{ type: 'text', text: 'The session history was damaged and has been repaired.' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      reason: 'torn-tail', synthesizedClosers: 0,
    }, { surfaceOp: 'append' })
    session.append('cache-test/race', {})
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle(); await settle()
    const stored = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { seq: number; val: { n: number } } | undefined
    expect(stored?.val.n).toBe(2)
    expect(stored?.seq).toBe(session.snapshotEvents().at(-1)?.seq)
  })

  it('teardown: pre-dispose writes land while the domain is open; the post-close detach task fails soft (composition residual)', async () => {
    const { ctx, session, pool } = await harness({ writeEveryEvents: 1000, writeIntervalMs: 60_000 })
    session.append('cache-test/race', {})
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // The pre-dispose tasks settle while the domain is open.
    await settle(); await settle(); await settle()
    const pre = rowOf(pool, 'race')?.rows?.['cache-test/race'] as { val: { n: number } } | undefined
    expect(pre?.val.n).toBe(1)
    const warns: string[] = []
    const originalWarn = ctx.logger.warn.bind(ctx.logger) as (...args: unknown[]) => void
    ctx.logger.warn = (...args: unknown[]) => { warns.push(String(args[0])); originalWarn(...args) }
    // KNOWN_RESIDUAL (upstream composition ordering): the session store
    // disposes after the projection cache, so the ordered detach task
    // enqueues after the cache domain closed. Its write fails SOFT — the
    // mandatory live-to-cold checkpoint is skipped at full-context teardown
    // and the cold read replays the log (no correctness loss, never a
    // phantom success).
    await ctx.fiber.dispose()
    expect(warns.some(message => message.includes('detach write for "race" failed'))).toBe(true)
  })
})
