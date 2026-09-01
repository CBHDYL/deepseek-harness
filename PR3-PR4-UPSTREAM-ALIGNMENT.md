# PR3-PR4-UPSTREAM-ALIGNMENT

Upstream Remediation Semantic Port — Phase 1 read-only alignment. Source of truth: `origin/master` (`dd6322d60`), read via `git show` where the migration baseline's auto-merge could contaminate content. Verified stopgap reference: `dsh-core-stopgap @ 3e02e7bb0`. No production code was modified in this phase.

## Baseline correction recorded

The migration baseline (`dsh-core-stopgap-rebased`) carries one auto-merged semantic residue: `packages/session/session-persistence/src/index.ts` contains the stopgap `SessionIntegrity` type and the `integrity` field on `SessionInspection` (stopgap PR-3 content auto-merged because upstream never touched those lines). Upstream `origin/master` has **no** `SessionIntegrity` and no `integrity` field (`grep -c integrity` on the upstream file = 0). The three `TS2741` errors on `coordinator.ts:992/1066/1071` in the baseline census are artifacts of that residue, not upstream defects. The PR-3 port decision below resolves it (complete or drop).

## PR-3

### Current write topology (upstream)

```
session.append (in-memory seq)
  → PersistenceCoordinator.append (generic over TornMarker, shared by backends)
    → backend.appendLines (JSONL: zstd packed frames; seq-ranges via encodeSeqRanges/packChunkRuns)
      → fsync steps; the seam documents truncate-then-append in two fsync'd steps and
        explicitly does NOT require atomicity
load/inspect → backend readStoredRevision + scanner
  → committed-region damage ("unparsable committed event", "seq gap in committed region")
    → THROW SessionPersistenceCorruptionError (fail-loud; never presented as a short log)
  → torn FINAL frame → JsonlTornMarker { truncateTo, recoveredEvents }
    → prepared inspection + closers = interruptedTurnClosers(storedEvents)
commitPrepared → backend.commitRepair(meta, tornMarker, closers)
    = truncate torn tail → append recovered events + synthetic closers (two fsync'd steps)
    → coordinator warns; reloads the committed graph
```

### Repair topology

- Truncation repair is **actually persisted** (truncate + append), not offset computation only.
- The repair commit boundary is `commitRepair` on the backend seam (`session-persistence-jsonl/src/index.ts:447-468`).
- Repair is triggered at adoption (`commitPrepared`), not inside `load()` (load is non-mutating) — same load/adopt split as the stopgap design.
- No durable diagnostic event is appended on repair: `session/repaired` has **zero occurrences** upstream.
- No `SessionIntegrity` provenance is published to consumers.

### Format / version behavior

- `SESSION_FORMAT_VERSION` check exists; unsupported versions are refused loudly (`SessionFormatUnsupportedError`).
- `xtr/session-format-migration` was merged then **reverted** (`211e6939e`): format migration is in flux upstream — the port must not touch format encoding.
- The SQLite persistence backend was **removed** upstream (`4553c9d95 refactor(session)!: remove SQLite persistence backend`): stopgap PR-3's sqlite contract changes are obsolete.

### Invariant gap matrix

| OLD PR-3 INVARIANT | CURRENT UPSTREAM MECHANISM | EQUIVALENT? | GAP | NEW IMPLEMENTATION POINT |
|---|---|---|---|---|
| D1: load publishes integrity tri-state; repaired only by an atomic repair transaction | none (no tri-state; repair is two-step truncate+append) | NO | provenance surface entirely missing | add `integrity` to `SessionInspection`; compute at the coordinator's prepare/inspect boundary; wire into the backend scan results |
| D2: committed corruption never presented as a normal short log | scanner throws `SessionPersistenceCorruptionError` | YES (different mechanism: refusal vs repair-with-loss) | none for the invariant; stopgap's middle-corruption recovery is optional | keep upstream fail-loud (recommendation: accept) |
| D3: unknown completeness never marked intact after crash/restart | torn tail detected and repaired; no intact claim exists | PARTIAL | no completeness signal reaches consumers at all | same point as D1: provenance computed from tornMarker/recovery state |
| D4: durable log is the only canonical source; projections never feed recovery | coordinator reloads from the log; cold-read anchored floor | YES | none | — |
| E13/E27 middle corruption recorded loss | upstream refuses loudly (throws) | PARTIAL (invariant of "not silent" holds; recovery semantics differ) | decision needed: adopt upstream refusal, or port recorded-loss recovery | if ported: the scanner's committed-region branch + commitRepair |
| E14: no truncated intermediate (atomic rename-replace) | seam documents two-step non-atomicity as intended | NO | atomicity guarantee absent; torn tail is repaired on next load (recoverable, not silent) | decision needed: align with upstream's documented seam (accept + document crash window), or re-introduce rename-replace |
| V1/durable `session/repaired` event with provenance | absent (0 occurrences) | NO | model-visible repair notice missing | append the event inside the coordinator's repair path (before commitRepair's closers append) — upstream's own removed `SessionIntegrity` doc prose describes exactly this intent |
| SESSION_FORMAT_VERSION boundary | upstream-owned refusal | YES | none (version is upstream's; stopgap 0→1 is obsolete) | — |

### Recommended implementation point

The coordinator `commitPrepared` / inspection-prepare boundary (`packages/session/session-persistence/src/coordinator.ts`) plus the backend seam's repair result (tornMarker present or not) — NOT the format encoding, NOT a copy of the stopgap `commitRepair`.

### Migration risk

- format.ts is upstream-in-flux (migration merge + revert): touching the encoding is forbidden.
- The stopgap's atomicity guarantee conflicts with the upstream seam contract; forcing rename-replace would fight the documented backend design.
- The `SessionIntegrity` residue in the baseline must be completed (if the port proceeds) or dropped (if the human accepts upstream's no-provenance state) before the baseline typechecks.

## PR-4

### Current projection topology (upstream)

```
session/event → SessionProjectionRegistry.apply per registered unit (views, Object.is change detection)
  → change feed (unit watermark at emission, fold semantics, persisted (sessionId, key, ver, seq, val))
SessionProjectionCache (write-behind):
  dirty = Map<Session, { pending, timer }>
  triggers: turn/end, count threshold, interval timer, session/created, session/disposed
    → void this.flushSoft(session, trigger)   (fire-and-forget everywhere)
      flushSoft = try { await this.write(session) } catch { warn }
        write(session):
          1. rows = ctx.sessionProjections.checkpoint(session)   // cut at call time
          2. this.markClean(session)                              // dirty zeroed BEFORE the put
          3. if live: await ctx.sessions.flush(session)          // durability barrier
          4. await this.put(id, identityOf(header), rows)        // no lifecycle recheck after the await gap
  session/disposed:
    void this.flushSoft(session, 'detach'); this.markClean(session); this.dirty.delete(session)
    // detach write is fire-and-forget; dirty state dropped immediately
  coldSnapshot: fire-and-forget write-back put (un-ordered path)
```

### Authoritative write paths

- `write()` (awaited, called by flushSoft from every trigger) and `coldSnapshot`'s write-back are the only put paths.
- Old `flushSoft` is still authoritative; there is **no** per-session single-flight tail, no queue, no ordered final task.
- The domain write chain named in the comment is the KV table's own serialization, not per-session ordering of cuts: two concurrent `write()` calls take cuts independently and put in arrival order of the `put` await — a stale cut can land after a newer one.

### Migration / live-view interaction

- Fold migration (`ver` on persisted rows) is read-side: registry `restore` replays the fold over cached rows. It does not touch the write path.
- The change feed's `Object.is` raw-view gate suppresses no-op emissions; it does not serialize or order durable writes.

### Invariant gap matrix

| OLD PR-4 INVARIANT | CURRENT UPSTREAM MECHANISM | STILL NEEDED? | PARTIALLY REPLACED? | NEW INSERTION POINT | RACE TEST NEEDED |
|---|---|---|---|---|---|
| P1/P2: at most one in-flight write per session; mid-flight event survives the stale cut | none (concurrent flushSoft calls interleave freely) | YES | NO | a per-session tail around `write()` with cut-at-turn semantics | concurrent turn/end + count/interval triggers → newest cut last |
| P2/P6: dirty cleared only for the covered cut; failure keeps bookkeeping | `markClean` before the put; failure leaves counter zeroed | YES | NO | move clean to after a successful settle, covered-prefix bookkeeping | put-gated markClean boundary probe |
| P3: a rejected write never poisons subsequent writes | no tail exists; each flushSoft is independent (warn only) | PARTIAL (no poisoning possible, but no ordering either) | NO | the tail absorbs rejections (catch-contained next) | middle-reject then success |
| P4/P7: detach is an ordered final task; its cut captured synchronously at detach; no empty-checkpoint wipe | fire-and-forget detach flushSoft + immediate markClean/dirty.delete; cut happens later inside write() after the disposal cascade may have unregistered units | YES (root cause E4.1 persists: empty-checkpoint wipe risk) | NO (upstream mitigations: cold-read anchored floor, persistence retirement drain — recovery-side, not prevention) | capture the cut synchronously in the disposed handler; ordered final task | full-context dispose with zero-registration cut |
| P7: lifecycle recheck after every await gap | live check before the flush only; `put` lands unconditionally after the flush await | YES | NO | recheck before the put; stand down when detached | detach-during-flush probe |
| post-detach events ignored | upstream registry unregisters units at dispose; dirty.delete drops bookkeeping | YES (bookkeeping) | PARTIAL | guard the session/event handler by lifecycle | post-detach append → silent |
| timer slot vacated at fire; interval re-arm both windows | `state.timer ??= setTimeout(...)`; markClean clears it | PARTIAL (single-timer design avoids the stranded-slot defect but re-arm semantics differ) | PARTIAL | adapt to `{ pending, timer }` shape | fired-and-in-flight vs queued-not-cut |
| coldSnapshot write-back ordering | fire-and-forget put | PARTIAL (never-wrong interleaving documented) | PARTIAL | leave as documented or route through the tail | optional |

### Recommended implementation point

The single-flight tail wraps the existing `write()` entry inside `session-projection-cache` (flushSoft becomes the enqueue caller; the five trigger sites stay), preserving upstream's DirtyState shape, the KV identity fields (`createdAt` + `cwd`), and the cold-read anchored floor. The registry/view/migration architecture is untouched.

### Migration risk

- `xtr/session-projection-migrations` landed on master and is still being adjusted (`a6c7c70d4 fix(session-projection): close review findings from the fold migration`); the port must not alter the registry or fold/ver semantics.
- Upstream's detach handler comment claims the fire-and-forget + immediate-clean pattern is safe because "flushSoft's synchronous prefix reads and resets the dirty state" — that reasoning predates the async `await this.write()` inside flushSoft; the checkpoint cut is taken inside write() at await time. The port must not preserve that comment's claim; the new detach capture makes it moot.

## DECISION

**PR-3 direction decision (human-decided 2026-08-31):**
- (a) Keep upstream fail-loud semantics for committed-region corruption; do NOT port the old E13 recovery-with-loss behavior. "Refusing corrupted history" satisfies the "no silent truncation" objective (upstream's refusal is the accepted, more conservative security semantics).
- (b) Keep the upstream two-step `commitRepair` seam; do NOT re-introduce rename-replace atomic replacement this round. The crash window across the truncate+append sequence is recorded as a residual risk / future hardening item: "repair persistence is durable but not crash-atomic across the full truncate+append sequence" — re-evaluate only after the upstream persistence format stabilizes.
- Do NOT touch format-migration / seq-range encoding.

PR-3: **ADAPT**
Upstream already owns: torn-tail repair (persisted, two-step), fail-loud committed corruption (closes E27's silent-shortening), version refusal, and the coordinator/backend seam split. The port adds, on the upstream seam: the `SessionInspection` integrity provenance (complete or drop the baseline's auto-merged type), and the durable `session/repaired` diagnostic on the repair path. Two open direction choices for the human (recommendation in parentheses): (a) middle corruption — keep upstream fail-loud (recommended; E13 recovery is then not ported); (b) atomicity — accept the upstream two-step seam and document the crash window (recommended) instead of re-introducing rename-replace. SQLite changes are obsolete (backend removed).

PR-4: **PARTIALLY_REPLACED → ADAPT** (verdict: ADAPT)
Upstream's registry evolution (views, change feed, fold+ver migration, anchored floor) replaces none of the write-path invariants; every PR-4 failure class persists at the cache write path with new shapes. Port = single-flight tail + ordered detach + covered-clean + lifecycle rechecks, adapted to `DirtyState`/`flushSoft`/identity fields, with race tests re-targeted to the five trigger sites. No registry/fold changes.

NOT IMPLEMENTED — this phase is analysis only. Next authorized step is the PR-1 sandbox-authority semantic port (Phase 2), per the port order.
