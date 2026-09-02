/**
 * PR-3 permanent tests for the current upstream repair seam (truncate +
 * append + fsync, non-atomic): committed-region corruption FAILS LOUD and is
 * never silently shortened; only an identified torn/uncommitted tail is
 * bounded-repaired; a committed repair appends exactly one `session/repaired`
 * evidence record; failed repair commits are never reported as successful.
 * Adapted from the stopgap oracle to the current topology (no rename-replace,
 * no v1 stamp, no integrity tri-state).
 */
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { truncateFault, setTruncateFault } = vi.hoisted(() => {
  let fail = false
  return {
    truncateFault: () => fail,
    setTruncateFault: (value: boolean) => { fail = value },
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    truncate: async (...args: Parameters<typeof actual.truncate>) => {
      if (truncateFault()) throw new Error('simulated crash during truncate')
      return actual.truncate(...args)
    },
  }
})
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { logPath, sessionDir } from '../src/format.ts'

const fsp = await import('node:fs/promises')

let root: string
let ctx: Context

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-atomic-repair-'))
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const CWD = '/work'
const path = (id: string): string => logPath(root, CWD, SessionId(id), 'none')

function meta(id: string) {
  return { version: 0, id: SessionId(id), createdAt: 1, cwd: CWD, delegationDepth: 0 }
}

function turn(seq: number): SessionEvent[] {
  return [
    { type: 'turn/start', seq, time: 1, data: { turn: seq + 1 } },
    { type: 'step/start', seq: seq + 1, time: 2, data: { turn: seq + 1, step: 1 } },
    { type: 'step/end', seq: seq + 2, time: 3, data: { turn: seq + 1, step: 1 } },
    { type: 'turn/end', seq: seq + 3, time: 4, data: { turn: seq + 1, reason: { kind: 'completed' } } },
  ] as SessionEvent[]
}

describe('PR-3 repair seam: committed corruption fails loud, torn tails bounded-repair (E27)', () => {
  it('committed-region corruption fails loud: no truncate, no repair commit, no shorter adoption, later reads still refuse', async () => {
    const m = meta('committed-corruption')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await ctx.sessionPersistence.append(m.id, turn(4))
    const content = await readFile(path(m.id), 'utf8')
    const lines = content.split('\n')
    // A complete record inside the committed region (before the second turn's
    // turn/end) is broken: the scanner must refuse, not truncate to a prefix.
    lines[5] = '{broken json'
    await writeFile(path(m.id), lines.join('\n'))
    const damagedBytes = await readFile(path(m.id))

    const failure = await ctx.sessionPersistence.load(m.id).then(() => undefined, (error: unknown) => error as Error)
    expect(failure?.name).toBe('SessionPersistenceCorruptionError')
    expect(failure?.message).toContain('unparsable committed event')
    // No truncate, no repair commit: the bytes are untouched and the damage
    // remains identifiable by every later read.
    expect(await readFile(path(m.id))).toEqual(damagedBytes)
    expect((await readFile(path(m.id), 'utf8')).includes('session/repaired')).toBe(false)
    const second = await ctx.sessionPersistence.load(m.id).then(() => undefined, (error: unknown) => error as Error)
    expect(second?.name).toBe('SessionPersistenceCorruptionError')
  })

  it('torn-tail positive control: the identified torn tail is truncated and exactly one repair evidence record is committed', async () => {
    const m = meta('torn-tail')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    // A never-committed fragment (no trailing newline) after a balanced turn.
    await writeFile(path(m.id), '\n{"partial crash tail', { flag: 'a' })

    const loaded = await ctx.sessionPersistence.load(m.id)

    // The committed prefix survives verbatim; the torn fragment is discarded
    // and the recovery appends exactly one required-on-read evidence record.
    expect(loaded.events.map(e => e.type)).toEqual([
      'turn/start', 'step/start', 'step/end', 'turn/end', 'session/repaired',
    ])
    const repaired = loaded.events.at(-1)!
    expect(repaired.type === 'session/repaired' && repaired.data).toMatchObject({
      reason: 'torn-tail', synthesizedClosers: 0,
    })
    const blocks = repaired.type === 'session/repaired' ? repaired.data.message.content : []
    expect(blocks.some(block => block.type === 'text' && block.text.includes('damaged and has been repaired'))).toBe(true)
    expect((await readFile(path(m.id), 'utf8')).includes('"partial crash tail')).toBe(false)
  })

  it('a torn tail inside an open turn closes the turn synthetically before the evidence record', async () => {
    const m = meta('torn-open-turn')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await ctx.sessionPersistence.append(m.id, [
      { type: 'turn/start', seq: 4, time: 5, data: { turn: 2 } },
      { type: 'step/start', seq: 5, time: 6, data: { turn: 2, step: 1 } },
    ] as SessionEvent[])
    await writeFile(path(m.id), '\n{"torn open', { flag: 'a' })

    const loaded = await ctx.sessionPersistence.load(m.id)

    expect(loaded.events.map(e => e.type)).toEqual([
      'turn/start', 'step/start', 'step/end', 'turn/end', // turn 1
      'turn/start', 'step/start', 'step/end', 'turn/end', // turn 2: real + synthetic closers
      'session/repaired',
    ])
    const repaired = loaded.events.at(-1)!
    expect(repaired.type === 'session/repaired' && repaired.data.synthesizedClosers).toBe(2)
  })

  it('a clean session load appends no repair evidence', async () => {
    const m = meta('clean')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    const loaded = await ctx.sessionPersistence.load(m.id)
    expect(loaded.events.some(event => event.type === 'session/repaired')).toBe(false)
    expect((await readFile(path(m.id), 'utf8')).includes('session/repaired')).toBe(false)
  })

  it('a failed truncate is not a successful repair: bytes stay intact, no evidence, a later load repairs exactly once', async () => {
    const m = meta('truncate-failure')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '\n{"partial crash tail', { flag: 'a' })
    const tornBytes = await readFile(path(m.id))

    setTruncateFault(true)
    await expect(ctx.sessionPersistence.load(m.id)).rejects.toThrow(/simulated crash during truncate/)
    setTruncateFault(false)

    // Nothing was committed: the torn tail is intact and no evidence exists.
    expect(await readFile(path(m.id))).toEqual(tornBytes)
    expect((await readFile(path(m.id), 'utf8')).includes('session/repaired')).toBe(false)

    // The original damage is still recoverable by a later repair.
    const loaded = await ctx.sessionPersistence.load(m.id)
    expect(loaded.events.filter(event => event.type === 'session/repaired')).toHaveLength(1)
  })

  it('a failed repair append is not reported as success and leaves the documented truncate-only residual', async () => {
    const m = meta('append-failure')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '\n{"partial crash tail', { flag: 'a' })

    // Fail the append step of commitRepair: the truncate already ran, the
    // append throws, and the load must reject — never a successful repair.
    const proto = Object.getPrototypeOf(await open(path(m.id), 'a')) as { writeFile: (...args: unknown[]) => Promise<unknown> }
    const realWriteFile = proto.writeFile
    let armed = true
    vi.spyOn(proto, 'writeFile').mockImplementation(async function (this: unknown, ...args: unknown[]) {
      if (armed) {
        armed = false
        throw new Error('simulated crash during repair append')
      }
      return realWriteFile.call(this, ...args)
    })

    await expect(ctx.sessionPersistence.load(m.id)).rejects.toThrow(/simulated crash during repair append/)
    vi.restoreAllMocks()

    // KNOWN_RESIDUAL: non-atomic truncate+append repair crash window — the
    // truncate step was already durable, so the discarded tail is gone and the
    // later load yields the balanced prefix WITHOUT a new evidence record
    // (a repair did not commit this time). Pinned as current seam behavior.
    const reloaded = await ctx.sessionPersistence.load(m.id)
    expect(reloaded.events.map(event => event.type)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])
    expect(reloaded.events.some(event => event.type === 'session/repaired')).toBe(false)
  })

  it('repeated reloads of a repaired session are stable and append no second evidence record', async () => {
    const m = meta('idempotent')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '{"torn tail', { flag: 'a' })
    const first = await ctx.sessionPersistence.load(m.id)
    expect(first.events.filter(event => event.type === 'session/repaired')).toHaveLength(1)
    const bytesAfterFirst = await readFile(path(m.id))
    const second = await ctx.sessionPersistence.load(m.id)
    expect(second.events).toEqual(first.events)
    const third = await ctx.sessionPersistence.load(m.id)
    expect(third.events).toEqual(first.events)
    expect(third.events.filter(event => event.type === 'session/repaired')).toHaveLength(1)
    expect(await readFile(path(m.id))).toEqual(bytesAfterFirst)
  })

  it('an unsupported newer format version is refused without repair side effects', async () => {
    const id = 'future-v2'
    const dir = sessionDir(root, CWD, SessionId(id))
    await fsp.mkdir(dir, { recursive: true })
    await writeFile(path(id), JSON.stringify({ type: 'session', version: 2, id, createdAt: 1, cwd: CWD, delegationDepth: 0 }) + '\n' + turn(0).map(event => JSON.stringify(event)).join('\n') + '\n')
    const originalBytes = await readFile(path(id))

    const failure = await ctx.sessionPersistence.load(SessionId(id)).then(() => undefined, (error: unknown) => error as Error)
    expect(failure?.name).toBe('SessionFormatUnsupportedError')
    expect(failure?.message).toMatch(/newer harness/)
    // No truncation, no repair, no shorter valid state.
    expect(await readFile(path(id))).toEqual(originalBytes)
    expect((await readFile(path(id), 'utf8')).includes('session/repaired')).toBe(false)
  })

  it('a filesystem read failure at the log path is infrastructure, not content corruption (F1)', async () => {
    const m = meta('io-directory')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    // Replace the log with a directory: reading it fails with EISDIR — a
    // generic I/O failure that must keep its filesystem identity.
    await rm(path(m.id))
    await fsp.mkdir(path(m.id))

    const failure = await ctx.sessionPersistence.load(m.id).then(() => undefined, (error: unknown) => error as Error)
    expect(failure).toBeDefined()
    expect(failure?.name).not.toBe('SessionPersistenceCorruptionError')
    expect(failure?.name).not.toBe('SessionFormatUnsupportedError')
    expect((failure as unknown as NodeJS.ErrnoException).code).toBe('EISDIR')

    // Restoring a valid artifact afterwards loads cleanly: the failed attempt
    // mutated nothing.
    await rm(path(m.id), { recursive: true })
    await writeFile(path(m.id), JSON.stringify({ type: 'session', version: 0, id: m.id, createdAt: 1, cwd: CWD, delegationDepth: 0 }) + '\n' + turn(0).map(event => JSON.stringify(event)).join('\n') + '\n')
    const loaded = await ctx.sessionPersistence.load(m.id)
    expect(loaded.events.map(event => event.type)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])
    expect(loaded.events.some(event => event.type === 'session/repaired')).toBe(false)
  })
})
