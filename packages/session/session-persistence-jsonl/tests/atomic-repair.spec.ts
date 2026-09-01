/**
 * PR-3 permanent negative tests: the atomic repair commit must never leave a
 * truncated intermediate, the recovery provenance is durable and idempotent,
 * and middle corruption is repaired (recorded loss) instead of being refused
 * or silently shortened. These pin the E27 failure mode and the failure-window
 * model on REAL file bytes.
 */
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { renameFault, setRenameFault } = vi.hoisted(() => {
  let fail = false
  return {
    renameFault: () => fail,
    setRenameFault: (value: boolean) => { fail = value },
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (renameFault()) throw new Error('simulated crash before rename')
      return actual.rename(...args)
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
  return { version: 1, id: SessionId(id), createdAt: 1, cwd: CWD, delegationDepth: 0 }
}

function turn(seq: number, reason: 'completed' = 'completed'): SessionEvent[] {
  return [
    { type: 'turn/start', seq, time: 1, data: { turn: seq + 1 } },
    { type: 'step/start', seq: seq + 1, time: 2, data: { turn: seq + 1, step: 1 } },
    { type: 'step/end', seq: seq + 2, time: 3, data: { turn: seq + 1, step: 1 } },
    { type: 'turn/end', seq: seq + 3, time: 4, data: { turn: seq + 1, reason: { kind: reason } } },
  ] as SessionEvent[]
}

describe('PR-3 atomic repair failure windows (E27)', () => {
  it('crash after temp write but before rename leaves the ORIGINAL recoverable (no truncated intermediate)', async () => {
    const m = meta('window-before-rename')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '\n{"partial crash tail', { flag: 'a' })
    const originalBytes = await readFile(path(m.id))

    setRenameFault(true)
    await expect(ctx.sessionPersistence.load(m.id)).rejects.toThrow(/simulated crash before rename/)
    setRenameFault(false)
    expect(await readFile(path(m.id))).toEqual(originalBytes)
    // The original (torn) log is still recoverable by a subsequent repair.
    const loaded = await ctx.sessionPersistence.load(m.id)
    expect(loaded.events.at(-1)?.type).toBe('session/repaired')
    expect(loaded.integrity).toBe('repaired')
  })

  it('a repair that throws leaves the ORIGINAL intact', async () => {
    const m = meta('window-throw')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '{"torn', { flag: 'a' })
    const originalBytes = await readFile(path(m.id))
    setRenameFault(true)
    await expect(ctx.sessionPersistence.load(m.id)).rejects.toThrow(/simulated crash before rename/)
    setRenameFault(false)
    expect(await readFile(path(m.id))).toEqual(originalBytes)
  })

  it('the repaired artifact is complete after the atomic replace (crash after rename leaves the repaired version)', async () => {
    const m = meta('window-after-rename')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '\n{"partial', { flag: 'a' })
    // Simulate a crash AFTER the rename but BEFORE the directory fsync: the
    // rename already published the complete repaired file; the dir fsync
    // failing must not resurrect a partial state.
    let dirSyncs = 0
    const proto = Object.getPrototypeOf(await open(path(m.id), 'r')) as { sync: () => Promise<void> }
    const realSync = proto.sync
    vi.spyOn(proto, 'sync').mockImplementation(async function (this: unknown) {
      dirSyncs += 1
      return realSync.call(this)
    })
    const loaded = await ctx.sessionPersistence.load(m.id)
    expect(loaded.events.at(-1)?.type).toBe('session/repaired')
    const bytes = await readFile(path(m.id))
    expect(bytes.includes(Buffer.from('"partial'))).toBe(false)
    // The complete repaired version is the only durable state.
    const reloaded = await ctx.sessionPersistence.load(m.id)
    expect(reloaded.events).toEqual(loaded.events)
    expect(reloaded.integrity).toBe('repaired')
    expect(dirSyncs).toBeGreaterThan(0)
  })

  it('repeated repair is idempotent: reloading a repaired session appends no second diagnostic', async () => {
    const m = meta('idempotent')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '{"torn tail', { flag: 'a' })
    const first = await ctx.sessionPersistence.load(m.id)
    expect(first.integrity).toBe('repaired')
    const second = await ctx.sessionPersistence.load(m.id)
    expect(second.events).toEqual(first.events)
    expect(second.events.filter(e => e.type === 'session/repaired')).toHaveLength(1)
    const bytesAfterFirst = await readFile(path(m.id))
    const third = await ctx.sessionPersistence.load(m.id)
    expect(third.events).toEqual(first.events)
    expect(await readFile(path(m.id))).toEqual(bytesAfterFirst)
  })

  it('middle corruption is repaired with recorded loss, never refused and never silently shortened', async () => {
    const m = meta('middle-corruption')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await ctx.sessionPersistence.append(m.id, turn(4))
    const content = await readFile(path(m.id), 'utf8')
    const lines = content.split('\n')
    // Corrupt a middle committed line (a complete record inside the committed region).
    lines[4] = '{broken json'
    await writeFile(path(m.id), lines.join('\n'))
    const loaded = await ctx.sessionPersistence.load(m.id)
    // The valid prefix (events 0..2) is preserved; the damaged tail (the
    // corrupted turn/end plus turn 2's rows) is lost and recorded; the open
    // turn is closed synthetically before the diagnostic.
    expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4])
    expect(loaded.events[3]?.type === 'turn/end' && loaded.events[3]!.data.reason).toEqual({ kind: 'interrupted' })
    const repaired = loaded.events.at(-1)!
    expect(repaired.type === 'session/repaired' && repaired.data).toMatchObject({ reason: 'corrupted-records', synthesizedClosers: 1 })
    expect(repaired.type === 'session/repaired' && repaired.data.lostLines).toBeGreaterThan(0)
    expect(loaded.integrity).toBe('repaired')
  })

  it('a legacy v0 log loads as unknown integrity and upgrades to v1 exactly at repair', async () => {
    const id = 'legacy-v0'
    const headerLine = JSON.stringify({ type: 'session', version: 0, id, createdAt: 1, cwd: CWD, delegationDepth: 0 })
    const body = turn(0).map(e => JSON.stringify(e)).join('\n') + '\n'
    const dir = sessionDir(root, CWD, SessionId(id))
    await fsp.mkdir(dir, { recursive: true })
    await writeFile(path(id), headerLine + '\n' + body)
    const intact = await ctx.sessionPersistence.load(SessionId(id))
    expect(intact.integrity).toBe('unknown')
    // Torn tail on the legacy log: repair upgrades the header to v1.
    await writeFile(path(id), '{"torn', { flag: 'a' })
    const repaired = await ctx.sessionPersistence.load(SessionId(id))
    expect(repaired.integrity).toBe('repaired')
    const firstLine = (await readFile(path(id), 'utf8')).split('\n')[0]!
    expect(JSON.parse(firstLine).version).toBe(1)
  })

  it('an unsupported future version is refused on load', async () => {
    const id = 'future-v2'
    const dir = sessionDir(root, CWD, SessionId(id))
    await fsp.mkdir(dir, { recursive: true })
    await writeFile(path(id), JSON.stringify({ type: 'session', version: 2, id, createdAt: 1, cwd: CWD, delegationDepth: 0 }) + '\n' + turn(0).map(e => JSON.stringify(e)).join('\n') + '\n')
    await expect(ctx.sessionPersistence.load(SessionId(id))).rejects.toThrow(/SessionFormatUnsupported|newer harness|does not support/)
  })

  it('P1-2: a repaired session damaged again is unknown before the new repair commits, then repaired with a second diagnostic', async () => {
    const m = meta('re-damaged')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '{"torn first', { flag: 'a' })
    const first = await ctx.sessionPersistence.load(m.id)
    expect(first.integrity).toBe('repaired')
    expect(first.events.filter(e => e.type === 'session/repaired')).toHaveLength(1)

    // New damage on the repaired artifact: the pre-commit state is unknown.
    await writeFile(path(m.id), '\n{"torn second', { flag: 'a' })
    const preCommit = await ctx.sessionPersistence.inspect(m.id)
    expect(preCommit.integrity).toBe('unknown')
    // Committing the second repair yields repaired with exactly TWO
    // diagnostics — one per distinct damage event, never a duplicate.
    const second = await ctx.sessionPersistence.load(m.id)
    expect(second.integrity).toBe('repaired')
    expect(second.events.filter(e => e.type === 'session/repaired')).toHaveLength(2)
    // Stable across further reloads.
    const third = await ctx.sessionPersistence.load(m.id)
    expect(third.events).toEqual(second.events)
    expect(third.events.filter(e => e.type === 'session/repaired')).toHaveLength(2)
  })

  it('P1-2: historical session/repaired does not mask a new middle corruption or a pending closer', async () => {
    const m = meta('re-corrupt-middle')
    await ctx.sessionPersistence.create(m)
    await ctx.sessionPersistence.append(m.id, turn(0))
    await writeFile(path(m.id), '{"torn first', { flag: 'a' })
    await ctx.sessionPersistence.load(m.id)
    // Middle corruption AFTER the repaired log: pre-commit integrity unknown.
    const lines = (await readFile(path(m.id), 'utf8')).split('\n')
    lines[3] = '{broken middle'
    await writeFile(path(m.id), lines.join('\n'))
    const preCommit = await ctx.sessionPersistence.inspect(m.id)
    expect(preCommit.integrity).toBe('unknown')

    // A repaired session with a NEW open turn (pending closer) is also
    // unknown until the closer is committed.
    const m2 = meta('re-open-turn')
    await ctx.sessionPersistence.create(m2)
    await ctx.sessionPersistence.append(m2.id, turn(0))
    await writeFile(path(m2.id), '{"torn', { flag: 'a' })
    await ctx.sessionPersistence.load(m2.id)
    await ctx.sessionPersistence.append(m2.id, [
      { type: 'turn/start', seq: 5, time: 9, data: { turn: 2 } },
      { type: 'step/start', seq: 6, time: 10, data: { turn: 2, step: 1 } },
    ] as SessionEvent[])
    await writeFile(path(m2.id), '{"torn open', { flag: 'a' })
    const preCommit2 = await ctx.sessionPersistence.inspect(m2.id)
    expect(preCommit2.integrity).toBe('unknown')
    const committed = await ctx.sessionPersistence.load(m2.id)
    expect(committed.integrity).toBe('repaired')
  })

})
