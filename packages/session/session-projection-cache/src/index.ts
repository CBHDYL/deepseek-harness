/**
 * Persisted projection cache (`ctx.sessionProjectionCache`): durable
 * checkpoints of every client-visible or explicitly persisted projection unit's state, one record per
 * session on the domain data form (`session_projcache` domain — the shipped
 * json backend lands it beside `workspace.json`). The cache is a fold
 * shortcut, never an authority: a row is possibly stale (its `seq`
 * says how stale) but never wrong, so every write path is fail-soft (a lost
 * write costs a longer tail replay on the next cold read) and a
 * `ver` mismatch discards the row instead of migrating it. Design
 * authority: the session-projection RFC
 * (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
 * @module @deepseek-ai/dsh-session-projection-cache
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
// Empty type import: applies the package's cordis Context merge
// (`ctx.sessionPersistence`), which this service reads on the cold path.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionCheckpoint, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { projectionCacheDomainSpec } from './spec.ts'
import type { CheckpointIdentity, CheckpointRecord } from './spec.ts'

export { checkpointIdentity, checkpointRecord, checkpointRow, projectionCacheDomainSpec } from './spec.ts'
export type { CheckpointIdentity, CheckpointRecord } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionProjectionCache: SessionProjectionCache
  }
}

/**
 * Plugin config. Both throttle triggers are deployment choices with no
 * universally correct value, so the composition states them explicitly
 * (cordis.yml); the two mandatory write points (`turn/end` and session
 * disposal) are policy, not tunables, and always fire.
 */
export interface Config {
  /** Committed events per session that force a durable checkpoint write between mandatory points. */
  writeEveryEvents: number
  /** Longest time (milliseconds) a dirty checkpoint may stay unwritten between mandatory points. */
  writeIntervalMs: number
}

export const Config: z<Config> = z.object({
  writeEveryEvents: z.natural().min(1).required(),
  writeIntervalMs: z.natural().min(1).required(),
})

/** Per-session single-flight write tail plus its dirty bookkeeping (live sessions only; dropped at retire). */
interface SessionWriteState extends DirtyState {
  /** Promise settling after the last enqueued write (never rejects). */
  tail: Promise<void>
  /** A write is scheduled and not yet running: later triggers coalesce onto it. */
  queued: boolean
  /** The session is detached: no new live writes enqueue; the final task owns the last checkpoint. */
  detached: boolean
}

/** Per-session write-behind bookkeeping (live sessions only; dropped at retire). */
interface DirtyState {
  /** Committed events since the last durable write. */
  pending: number
  /** Interval trigger armed at the first dirty event after a clean write. */
  timer: ReturnType<typeof setTimeout> | undefined
  /** Consecutive failed durable writes since the last success. */
  failures: number
  /** Automatic retries remaining for a failed mandatory checkpoint. */
  retries: number
}

/** Automatic retries per failed mandatory checkpoint before it goes silent. */
const MAX_WRITE_RETRIES = 3

/**
 * The persisted projection cache service. Opens the `session_projcache`
 * domain at init, checkpoints live sessions on a throttled write-behind
 * (count/interval triggers from {@link Config}) plus two mandatory points —
 * `turn/end` and session disposal (the live-to-cold moment) — and serves the
 * cold-read ladder: cached row, persistence `readFrom` tail, registry
 * `restore`, durable write-back. Every durable write is fail-soft: failures
 * log a warning and the cache self-heals on the next write or cold read.
 */
export class SessionProjectionCache extends Service {
  static inject = ['storageDomain', 'sessionProjections', 'sessionPersistence', 'sessions']

  static Config: z<Config> = Config

  private table?: KvTable<SessionId, CheckpointRecord>
  private readonly dirty = new Map<Session, SessionWriteState>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'sessionProjectionCache')
  }

  /** Open the domain and install the write-behind listeners. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(projectionCacheDomainSpec)
    this.table = domain.table('sessions')
    this.installWritePath()
    // Teardown: dispose child effects (session detach) first, then this
    // disposer runs. Every final detach task is on its tail by then, so
    // drain the tails while the domain is still open, then close it.
    this.ctx.effect(() => async () => {
      for (const state of this.dirty.values()) {
        if (state.timer !== undefined) clearTimeout(state.timer)
      }
      await Promise.all([...this.dirty.values()].map(state => state.tail))
      this.dirty.clear()
      await domain.close()
    }, 'sessionProjectionCache.dispose')
  }

  /**
   * The stored record for one session, accepted only when its bound log
   * identity matches `expected`. A session id names a slot, not a lifecycle:
   * a recreated id or a persistence store swapped under a surviving cache
   * must not let an old record seed state folded from an unrelated log.
   * Synchronous from the domain's in-memory state.
   * @param id - the session whose record is read.
   * @param expected - the log identity the caller holds (live or stored header).
   * @returns the identity-matching record, or `undefined` (absent or unrelated).
   */
  private recordFor(id: SessionId, expected: CheckpointIdentity): CheckpointRecord | undefined {
    const record = this.requireTable().get(id)
    if (record === undefined) return undefined
    return identityMatches(record.identity, expected) ? record : undefined
  }

  /**
   * The zero-I/O listing read: whole values viewed straight from the stored
   * rows (version-matching keys only), each cut carried with its watermark
   * so a client value store can seed under its higher-seq-wins rule — as
   * stale as the last durable checkpoint but never wrong, and never from an
   * unrelated log (the caller's header is the identity witness). Fresher
   * paths (the history tail baseline, {@link coldSnapshot}) supersede these
   * values whenever a session is actually opened.
   * @param meta - the listed session's header (identity witness; no log read).
   * @returns the cut (`asOfSeq` = lowest served-row watermark), or
   *   `undefined` when no usable row exists for this lifecycle.
   */
  cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined {
    const record = this.recordFor(meta.id, identityOf(meta))
    if (record === undefined) return undefined
    const values = this.ctx.sessionProjections.viewCheckpoint(record.rows)
    const keys = Object.keys(values)
    if (keys.length === 0) return undefined
    // The block carries ONE cut: the lowest served watermark is the seq every
    // value is at least current as of (under-claiming is safe under
    // higher-seq-wins; over-claiming would let a stale value outrank pushes).
    const asOfSeq = Math.min(...keys.map(key => (record.rows[key] as { seq: number }).seq))
    return { asOfSeq, values }
  }

  /**
   * Durably checkpoint one live session NOW (both mandatory points call
   * this; tests and carriers may too). The registry cut is snapshotted at
   * this boundary (states are live references), then the whole record is
   * replaced. NOT fail-soft — callers on the fail-soft paths contain it.
   * @param session - the live session to checkpoint.
   * @param _trigger - the trigger name for diagnostics (unused by this method:
   *   the enqueueing caller owns the failure log).
   * @param final - the ordered detach task: skips the post-flush lifecycle
   *   recheck (the session is already detached; the last cut must land).
   * @param captured - a cut snapshotted at detach time (the disposal cascade
   *   unregisters projection units while the task is queued).
   * @returns resolution after durability and event emission.
   */
  async write(session: Session, _trigger?: string, final: boolean = false, captured?: ProjectionCheckpoint): Promise<void> {
    // The checkpoint cut snapshots the LIVE registry state at this ordered
    // task's turn: a cut taken later is never older than an earlier task's
    // cut, so the last write in the tail always carries the newest state.
    // The final (detach) task uses the cut captured synchronously at
    // detach: the disposal cascade unregisters projection units while this
    // task is still queued, and a task-time checkpoint would be empty.
    const state = this.dirty.get(session)
    const rows = captured ?? this.ctx.sessionProjections.checkpoint(session)
    // The cut covers every event committed up to this task's turn. Only
    // those pending events become durable when this write succeeds; events
    // committed during the flush stay pending for the next task.
    const covered = state?.pending ?? 0
    // Durability barrier: the checkpoint cut was taken above, so flushing
    // AFTER it guarantees every event inside the cut is durably logged
    // before the cache row lands — a crash can leave the cache behind the
    // log (longer tail replay) but never ahead of it (phantom values folded
    // from events no stored log contains).
    const liveBeforeFlush = this.ctx.sessions.get(session.id) === session
    if (liveBeforeFlush) await this.ctx.sessions.flush(session)
    // Lifecycle recheck AFTER the await gap: a non-final write whose session
    // detached while it flushed must not publish a stale mid-flight
    // checkpoint after the final task's cut — the ordered final (detach)
    // task owns the last durable cut, so this task stands down.
    if (!final && this.ctx.sessions.get(session.id) !== session) return
    // An empty cut names no registered units. Writing it would only REPLACE
    // a good row with an empty one (the captured-final fallback after the
    // registry unloaded at teardown): skip the put instead — absent beats
    // wiped, and the stale row is ver-discarded or tail-corrected on read.
    if (Object.keys(rows).length === 0) return
    await this.put(session.id, identityOf(session.header), rows)
    // Only a SUCCESSFUL durability barrier may retire dirty bookkeeping:
    // clearing it before the flush/put would leave a failed mandatory
    // checkpoint permanently stale (no retry trigger, no later event). The
    // final task's bookkeeping is dropped by the disposal handler after the
    // task settles.
    if (!final && state !== undefined) this.markClean(session, covered)
  }

  /**
   * Cold-read one persisted session's projections with zero full-log load:
   * cached rows + a persistence `readFrom` tail from the registry's restore
   * floor, refolded by the registry and written back (fail-soft) so the next
   * cold read starts closer. A cache row invalidated by a shrunk log
   * (crash-repair truncation) triggers one full re-read from seq 0 — the
   * ladder's slow rung, still no crash. Rejects when the session has no
   * persisted log (`not found` from the persistence seam).
   * @param id - the persisted session to read.
   * @param signal - optional cancellation for the persistence reads.
   * @returns the snapshot cut at the stored log end.
   */
  async coldSnapshot(id: SessionId, signal?: AbortSignal): Promise<ProjectionSnapshot> {
    const record = this.requireTable().get(id)
    const cached = record?.rows ?? {}
    const floor = this.ctx.sessionProjections.restoreFloor(cached)
    const persistence = this.ctx.sessionPersistence
    if (floor === undefined) {
      // No unit registered: nothing to fold, but the not-found contract must
      // hold in this topology too — the probe read rejects for an absent log
      // and dates the empty cut for a present one.
      const probe = await persistence.readFrom(id, 0, signal)
      return { asOfSeq: probe.events.at(-1)?.seq ?? -1, values: {} }
    }
    let restored: { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }
    const tail = await persistence.readFrom(id, floor, signal)
    // The tail's stored header is the identity witness: a record bound to a
    // different lifecycle (recreated id, swapped store) is discarded whole
    // before any of its rows can seed a fold.
    const related = record === undefined || identityMatches(record.identity, identityOf(tail.meta))
    try {
      if (!related) throw new Error('unrelated log identity')
      restored = this.ctx.sessionProjections.restore(cached, tail.events, floor)
    } catch {
      // Recoverable failures are an unrelated record, a row outside the
      // supplied suffix or log end, and stateSchema rejection. The full read
      // removes every checkpoint seed and lets each unit refold from init.
      const whole = await persistence.readFrom(id, 0, signal)
      restored = this.ctx.sessionProjections.restore({}, whole.events, 0)
    }
    await this.putSoft(id, identityOf(tail.meta), restored.checkpoint, 'cold-read write-back')
    return restored.snapshot
  }

  // --- write-behind (throttle + mandatory points) ---

  private installWritePath(): void {
    // Every committed event advances the dirty counter; turn/end is a
    // mandatory point (the durable value most reads want is the turn-final
    // one), count/interval throttle the in-turn stream. Every trigger enters
    // the SAME per-session single-flight tail: concurrent triggers can never
    // run two checkpoints for one session at once, and each queued write
    // captures the newest registry cut when its turn arrives (a later cut
    // never loses to an earlier one).
    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      // A detached session emits no further live events; if one arrives
      // anyway, its state entry is already deleted and re-creating it here
      // would resurrect bookkeeping for a retired session. The final task
      // already owns the last cut.
      if (this.ctx.sessions.get(session.id) !== session) return
      if (event.type === 'turn/end') {
        void this.flushSoft(session, 'turn/end')
        return
      }
      const state = this.dirty.get(session) ?? this.stateFor(session)
      state.pending += 1
      if (state.pending >= this.config.writeEveryEvents) {
        void this.flushSoft(session, 'count threshold')
        return
      }
      state.timer ??= setTimeout(() => {
        // Vacate the slot before flushing: a successful write can leave
        // mid-flight events dirty, and markClean re-arms the interval only
        // when the slot is free (a stale fired id would strand them).
        state.timer = undefined
        void this.flushSoft(session, 'interval')
      }, this.config.writeIntervalMs)
    })

    // Detach (the live-to-cold moment): the second mandatory point. The final
    // checkpoint is an ORDERED task on the same tail (it runs after any
    // queued/in-flight write, so the last durable cut is the newest), and the
    // dirty bookkeeping is dropped only after that task settles — a failed
    // final write still cleans up, but never before its write actually ran.
    // The final cut is captured SYNCHRONOUSLY here: during the disposal
    // cascade the projection units unregister concurrently with this queue
    // draining, so a task-time checkpoint would read an empty registry and
    // wipe the last good row with an empty one.
    this.ctx.on('session/disposed', (session: Session) => {
      let finalCheckpoint: ProjectionCheckpoint | undefined
      try {
        finalCheckpoint = this.ctx.sessionProjections.checkpoint(session)
      } catch (error) {
        // checkpoint is total for contract-following units; a throwing one
        // must not break the disposal handler — the task falls back to a
        // task-time cut.
        this.ctx.logger.warn(`session projection cache: detach checkpoint capture for "${session.id}" failed: ${String(error)}`)
      }
      void this.enqueue(session, 'detach', { final: true, checkpoint: finalCheckpoint }).finally(() => {
        const state = this.dirty.get(session)
        if (state?.timer !== undefined) clearTimeout(state.timer)
        this.dirty.delete(session)
      })
    })
  }

  /** Fetch or create one session's dirty bookkeeping (write-tail fields initialized). */
  private stateFor(session: Session): SessionWriteState {
    const existing = this.dirty.get(session)
    if (existing !== undefined) return existing
    const state: SessionWriteState = {
      pending: 0, timer: undefined, failures: 0, retries: MAX_WRITE_RETRIES,
      tail: Promise.resolve(), queued: false, detached: false,
    }
    this.dirty.set(session, state)
    return state
  }

  /**
   * Enqueue one write onto the session's single-flight tail. Coalescing: when
   * a write is queued but has NOT yet taken its checkpoint cut, later
   * non-final triggers ride the same task (that write snapshots the newest
   * cut when it runs), so trigger storms cannot grow the queue or lose an
   * update. A trigger that arrives while a task is already past its cut
   * enqueues a follow-up task instead — its events are not in the running
   * task's cut. The final (detach) task is never coalesced away: it always
   * runs last, after every prior write. A rejected tail never poisons the
   * chain — the next task starts from the settled state regardless of how
   * the previous one settled.
   */
  private enqueue(
    session: Session,
    trigger: string,
    options: { final?: boolean; checkpoint?: ProjectionCheckpoint | undefined } = {},
  ): Promise<void> {
    const state = this.stateFor(session)
    if (state.detached && options.final !== true) return state.tail
    if (options.final === true) state.detached = true
    // `queued` means a task whose checkpoint cut is NOT yet taken: safe to
    // coalesce onto. The running task clears it when it takes its cut, so a
    // trigger arriving mid-flight schedules a follow-up task instead of
    // silently riding a cut that can never include its events.
    if (options.final !== true && state.queued) return state.tail

    state.queued = true
    const run = async (): Promise<void> => {
      state.queued = false // the cut is taken inside write(): no more coalescing onto this task
      try {
        await this.write(session, trigger, options.final === true, options.checkpoint)
      } catch (error) {
        // Fail-soft, contained per task: the failure is logged and the
        // automatic retry budget re-arms on the dirty counter, but the next
        // legitimate write starts from the settled tail, never a rejected one.
        this.ctx.logger.warn(`session projection cache: ${trigger} write for "${session.id}" failed (cache stays stale): ${String(error)}`)
        state.failures += 1
        if (state.retries > 0 && options.final !== true && state.pending > 0) {
          state.retries -= 1
          if (state.timer !== undefined) clearTimeout(state.timer)
          state.timer = setTimeout(() => {
            state.timer = undefined
            void this.flushSoft(session, 'retry')
          }, this.config.writeIntervalMs)
        }
      }
    }
    // Tail reset: `then(run, run)` schedules the next task after the
    // previous one settles either way — a rejection cannot strand the tail.
    const next = state.tail.then(run, run)
    state.tail = next.catch(() => {})
    return next
  }

  /**
   * One fail-soft durable checkpoint. Every caller has work by construction:
   * the throttle triggers only fire dirty (markClean clears the timer with
   * the counter) and the two mandatory points write unconditionally.
   */
  private async flushSoft(session: Session, trigger: string): Promise<void> {
    await this.enqueue(session, trigger)
  }

  /**
   * Retire one successful write's dirty bookkeeping. Only the `covered`
   * pending events folded into the settled checkpoint are retired: events
   * committed during the write's flush remain pending, and the trigger that
   * counted them has already scheduled (or will schedule) a follow-up write
   * covering them. A successful checkpoint restores the retry budget, so one
   * transient failure does not leave a session without automatic retries
   * forever. The interval timer is cleared only once nothing remains dirty.
   */
  private markClean(session: Session, covered: number): void {
    const state = this.dirty.get(session)
    if (state === undefined) return
    state.pending = Math.max(0, state.pending - covered)
    state.failures = 0
    state.retries = MAX_WRITE_RETRIES
    if (state.pending === 0 && state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
  }

  /** Replace one session's stored record with its log identity and a detached snapshot of `rows`. */
  private async put(id: SessionId, identity: CheckpointIdentity, rows: ProjectionCheckpoint): Promise<void> {
    const detached = snapshotJsonValue(rows)
    if (detached === undefined) {
      throw new TypeError('projection checkpoint is not losslessly JSON-serializable (a unit state violates the plain-JSON contract)')
    }
    await this.requireTable().put(id, { identity, rows: detached as CheckpointRecord['rows'] })
  }

  /** Fail-soft {@link put}: cache writes must never fail their caller's read or event path. */
  private async putSoft(id: SessionId, identity: CheckpointIdentity, rows: ProjectionCheckpoint, what: string): Promise<void> {
    try {
      await this.put(id, identity, rows)
    } catch (error) {
      this.ctx.logger.warn(`session projection cache: ${what} for "${id}" failed (cache stays stale): ${String(error)}`)
    }
  }

  /**
   * Write-behind health for one live session: pending count (0 = clean),
   * consecutive failures, and remaining automatic retries. A nonzero
   * `failures` with `pending > 0` means a checkpoint is stale and being
   * retried.
   * @param session - the live session to inspect.
   * @returns the write-behind health for that session.
   */
  dirtyStats(session: Session): { pending: number; failures: number; retriesLeft: number } {
    const state = this.dirty.get(session)
    if (state === undefined) return { pending: 0, failures: 0, retriesLeft: MAX_WRITE_RETRIES }
    return { pending: state.pending, failures: state.failures, retriesLeft: state.retries }
  }

  private requireTable(): KvTable<SessionId, CheckpointRecord> {
    /* v8 ignore next -- Service.init assigns the table before the service becomes injectable */
    if (this.table === undefined) throw new Error('session projection cache is not initialized')
    return this.table
  }
}

/** Project a header onto the identity fields a record is bound to. */
function identityOf(header: SessionHeader): CheckpointIdentity {
  return { createdAt: header.createdAt, ...header.cwd === undefined ? {} : { cwd: header.cwd } }
}

/** Whether a stored record's bound identity names the caller's lifecycle. */
function identityMatches(stored: CheckpointIdentity, expected: CheckpointIdentity): boolean {
  return stored.createdAt === expected.createdAt && stored.cwd === expected.cwd
}

export default SessionProjectionCache
