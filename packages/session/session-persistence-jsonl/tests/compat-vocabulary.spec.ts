/**
 * P-EVENTS: fork-era vocabulary compatibility through the real jsonl backend.
 * A reconstructed fork-written session (evidence-shaped: fork-era events and
 * packed rows, restored vocabulary records, and current-port records) must
 * reopen, validate, replay without fake behavior, and accept later appends
 * while preserving every stored record byte-for-byte. The fail-closed
 * unknown-vocabulary and format/corruption boundaries stay intact.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  COMPATIBILITY_EVENT_TYPES,
  KNOWN_SESSION_EVENT_TYPES,
  SessionId,
  SessionSeq,
  isSurfaceEligibleType,
  sessionRepairedEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
} from '@deepseek-ai/dsh-session-persistence'

const ID = '22222222-2222-4222-8222-222222222222'

/** The fork-era + current-port records of one reconstructed fork session. */
function forkRecords(): string[] {
  const records: string[] = []
  let seq = 0
  const push = (event: Record<string, unknown>): void => {
    records.push(JSON.stringify({ ...event, seq, time: 1784973850000 + seq }))
    seq += 1
  }
  records.push(JSON.stringify({
    type: 'session',
    version: 0,
    id: ID,
    createdAt: 1784973850000,
    delegationDepth: 0,
  }))
  push({ type: 'turn/start', data: { turn: 1 } })
  push({
    type: 'user/message',
    surfaceOp: 'append',
    data: {
      id: 'msg-user-1',
      role: 'user',
      content: [{ type: 'text', text: 'run echo OK' }],
      source: { kind: 'user' },
    },
  })
  // Fork-era packed reasoning row (3 members) — the physical row form.
  records.push(JSON.stringify({
    type: 'reasoning-chunks',
    seq0: seq,
    time0: 1784973850000 + seq,
    data: { turn: 1, step: 1, index: 0, dt: [5, 5], texts: ['think', 'ing', '…'] },
  }))
  seq += 3
  // Fork-era compatibility EVENT form of the same vocabulary type.
  push({
    type: 'reasoning-chunks',
    data: { turn: 1, step: 1, index: 1, dt: [4, 4], texts: ['more', 'thoughts', '…'] },
  })
  // Fork-authored ledger/journal events (the fork wrote them ignorable).
  push({ type: 'job/start', ignorable: true, data: { jobId: 'bash-1', kind: 'bash', label: 'true' } })
  push({
    type: 'request/attempt-start',
    ignorable: true,
    data: { turn: 1, step: 1, attempt: 1, provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  push({
    type: 'request/attempt-end',
    ignorable: true,
    data: { turn: 1, step: 1, attempt: 1, outcome: 'ok' },
  })
  push({
    type: 'job/end',
    ignorable: true,
    data: { jobId: 'bash-1', status: 'killed', detail: 'signal: SIGTERM', finishedAt: 1784973852000 },
  })
  push({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'msg-assistant-1',
        role: 'assistant',
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        content: [{ type: 'text', text: 'DONE' }],
      },
    },
  })
  push({ type: 'tool/call', data: { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'bash', arguments: '{}' } })
  push({
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'msg-tool-1',
        role: 'user',
        source: { kind: 'tool', callId: ToolCallId('call-1') },
        content: [{ type: 'tool-result', toolCallId: ToolCallId('call-1'), content: [{ type: 'text', text: 'OK' }] }],
      },
    },
  })
  push({ type: 'step/end', data: { turn: 1, step: 1 } })
  push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } })
  // Current-port records interleaved at the tail (P-DURABILITY + P-GUARD).
  push({ type: 'session/repaired', data: sessionRepairedEvent([], [{ type: 'step/start', seq: SessionSeq(0), time: 1, data: { turn: 1, step: 1 } }]).data })
  push({ type: 'action-policy/candidate', data: { toolName: 'bash', callId: ToolCallId('c1'), effectSource: 'declared' } })
  return records
}

/** Read one fork session into its logical event array. */
async function openForkSession(root: string): Promise<readonly SessionEvent[]> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const handle = await ctx.sessionPersistence.open(SessionId(ID), 'read')
  const events = await handle.read()
  await handle.close()
  await ctx.fiber.dispose()
  return events
}

const dirs: string[] = []

async function writeForkSession(records: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-events-compat-'))
  dirs.push(root)
  const dir = join(root, '_no-cwd', encodeURIComponent(ID))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.jsonl'), records.join('\n') + '\n')
  return root
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('P-EVENTS restored vocabulary', () => {
  it('every restored compatibility type is a known vocabulary member', () => {
    expect([...COMPATIBILITY_EVENT_TYPES].sort()).toEqual([
      'job/end',
      'job/start',
      'reasoning-chunks',
      'request/attempt-end',
      'request/attempt-start',
    ])
    for (const type of COMPATIBILITY_EVENT_TYPES) {
      expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(true)
    }
  })

  it('compatibility types are never surface events (no fake model-visible behavior)', () => {
    for (const type of COMPATIBILITY_EVENT_TYPES) {
      expect(isSurfaceEligibleType(type as SessionEvent['type'])).toBe(false)
    }
  })

  it('reopens a reconstructed fork session: rows expand, every record survives in order with verbatim payloads', async () => {
    const records = forkRecords()
    const root = await writeForkSession(records)
    const events = await openForkSession(root)
    // Header + rows + events: rows expand to 3 assistant/chunk events, so the
    // logical count is the record count minus the header plus 2.
    expect(events).toHaveLength(records.length - 1 + 2)
    for (let i = 0; i < events.length; i += 1) expect(events[i]!.seq).toBe(i)
    const types = events.map(event => event.type)
    expect(types).toEqual([
      'turn/start',
      'user/message',
      'assistant/chunk',
      'assistant/chunk',
      'assistant/chunk',
      'reasoning-chunks',
      'job/start',
      'request/attempt-start',
      'request/attempt-end',
      'job/end',
      'assistant/message',
      'tool/call',
      'tool/result',
      'step/end',
      'turn/end',
      'session/repaired',
      'action-policy/candidate',
    ])
    // The compatibility event payload survived verbatim.
    const reasoning = events.find(event => event.type === 'reasoning-chunks')
    expect(reasoning?.data).toEqual({ turn: 1, step: 1, index: 1, dt: [4, 4], texts: ['more', 'thoughts', '…'] })
    const jobEnd = events.find(event => event.type === 'job/end')
    expect(jobEnd?.data).toEqual({ jobId: 'bash-1', status: 'killed', detail: 'signal: SIGTERM', finishedAt: 1784973852000 })
    expect(jobEnd?.ignorable).toBe(true)
    const attemptStart = events.find(event => event.type === 'request/attempt-start')
    expect(attemptStart?.data).toEqual({ turn: 1, step: 1, attempt: 1, provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    // The expanded row members carry the row's content, one per member.
    expect(events[2]!.data).toMatchObject({ chunk: { type: 'reasoning-delta', text: 'think' } })
    expect(events[4]!.data).toMatchObject({ chunk: { type: 'reasoning-delta', text: '…' } })
  })

  it('appends after reopen without rewriting or dropping any restored record', async () => {
    const records = forkRecords()
    const root = await writeForkSession(records)
    const before = await openForkSession(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const handle = await ctx.sessionPersistence.open(SessionId(ID), 'write')
    const appended: SessionEvent[] = [{
      type: 'turn/start',
      seq: before.length,
      time: 1784973860000,
      data: { turn: 2 },
    }, {
      type: 'turn/end',
      seq: before.length + 1,
      time: 1784973860001,
      data: { turn: 2, reason: { kind: 'stop' } },
    }] as unknown as SessionEvent[]
    await handle.append(appended)
    await handle.close()
    await ctx.fiber.dispose()
    const after = await openForkSession(root)
    expect(after).toHaveLength(before.length + 2)
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i]).toEqual(before[i])
    }
    expect(after[before.length]?.type).toBe('turn/start')
    expect(after[before.length]?.data).toEqual({ turn: 2 })
  })

  it('a fork session composed entirely of compatibility events plus one current event reopens', async () => {
    const records = forkRecords()
    // The vocabulary alone must carry the fork part: keep the compat events,
    // drop the current-port tail records.
    const trimmed = records.slice(0, records.length - 2)
    const root = await writeForkSession(trimmed)
    const events = await openForkSession(root)
    expect(events.some(event => event.type === 'reasoning-chunks')).toBe(true)
    expect(events.some(event => event.type === 'job/start')).toBe(true)
    expect(events.some(event => event.type === 'request/attempt-end')).toBe(true)
  })
})

describe('P-EVENTS fail-closed boundaries stay intact', () => {
  /** Open and read, capturing whichever stage rejects. */
  async function refusal(root: string): Promise<unknown> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const handle = await ctx.sessionPersistence.open(SessionId(ID), 'read')
    try {
      return await handle.read()
    } finally {
      await handle.close()
      await ctx.fiber.dispose()
    }
  }

  it('an arbitrary unknown event type still refuses the whole log (unsupported vocabulary, not a skip)', async () => {
    const records = forkRecords()
    // The logical event count is records minus the header plus the row expansion.
    const nextSeq = records.length - 1 + 2
    records.push(JSON.stringify({
      type: 'future/evil-unknown-event',
      seq: nextSeq,
      time: 1784973860000,
      data: { anything: true },
    }))
    const root = await writeForkSession(records)
    await expect(refusal(root)).rejects.toThrow(SessionFormatUnsupportedError)
    await expect(refusal(root)).rejects.toThrow('future/evil-unknown-event')
  })

  it('an unsupported format version stays a format error, never a vocabulary skip', async () => {
    const records = forkRecords()
    records[0] = JSON.stringify({ type: 'session', version: 1, id: ID, createdAt: 1784973850000, delegationDepth: 0 })
    const root = await writeForkSession(records)
    await expect(refusal(root)).rejects.toThrow(SessionFormatUnsupportedError)
  })

  it('a malformed known event classifies as corruption, not as vocabulary refusal', async () => {
    const records = forkRecords()
    // Break the user/message wrapper: known type, wrong payload shape.
    const userIndex = records.findIndex(record => record.includes('"type":"user/message"'))
    records[userIndex] = JSON.stringify({
      type: 'user/message',
      seq: 1,
      time: 1784973850001,
      data: { content: [{ type: 'text', text: 'missing message wrapper' }], source: { kind: 'user' } },
    })
    const root = await writeForkSession(records)
    await expect(refusal(root)).rejects.toThrow(SessionPersistenceCorruptionError)
    await expect(refusal(root)).rejects.toThrow('failed validation')
  })

  it('a malformed reasoning-chunks row (row envelope without the compat seq form) still classifies as corruption', async () => {
    const records = forkRecords()
    const rowIndex = records.findIndex(record => record.includes('"type":"reasoning-chunks"') && record.includes('seq0'))
    // Corrupt the row: drop the seq0 anchor but keep the row-tagged shape.
    records[rowIndex] = JSON.stringify({
      type: 'reasoning-chunks',
      time0: 1784973850000,
      data: { turn: 1, step: 1, index: 0, dt: [5, 5], texts: ['think', 'ing', '…'] },
    })
    const root = await writeForkSession(records)
    await expect(refusal(root)).rejects.toThrow(SessionPersistenceCorruptionError)
  })
})
