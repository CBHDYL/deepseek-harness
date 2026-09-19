# Agent Note: Per-session settlement during search-index reconciliation

Status: implemented

English | [中文](2026-09-16-session-search-per-item-settlement.zh.md)

## Problem

The SQLite session-search index rebuilt its corpus under a whole-batch atomicity assumption. After inspecting every persisted session, reconciliation re-listed the corpus and discarded the entire attempt whenever any single session's revision differed from the one it had inspected (`samePersistenceSnapshots`). Two attempts were allowed; a third failure surfaced as `SESSION_QUERY_PERSISTENCE_FAILED`, which the search tools report as an unavailable history storage.

Any session written faster than one observation pass made that check unreachable, so the failure was deterministic on a working machine rather than rare. The searching agent is itself the churn source, because a tool call appends to its own log. Measured on one host against a corpus of 402 logs, the unmodified build spent 464 seconds on two attempts and then rejected; the index being warm does not help, because the check compares every entry of the corpus rather than the entries an attempt read.

## Decision

Reconciliation settles each session independently. The archived [unified session-query service](2026-07-23-unified-session-query-service.md) owns the service boundaries and the derived-index model; this note changes only how one observation pass treats an individual session's instability.

- `touchEntry` inspects one entry, skipping cache hits and live-shadowed sessions. The initial pass and every top-up round call it, so both apply identical rules regardless of when a session was discovered.
- A read that raises `SessionFormatUnsupportedError` drops that session from the corpus instead of failing the observation; the raw log is untouched and every compatible session is still indexed.
- A session appearing between listings is topped up into the same attempt rather than deferred, bounded by `MAX_TOPUP_ROUNDS`. A steady trickle cannot extend the loop past that budget; when the budget runs out, one further listing supplies the snapshot the drift check compares against, so no entry is checked against itself. That listing can also reveal sessions this attempt never inspected; recording them as present without inspecting them keeps the reconcile from reading a session that exists as deleted, and leaves them to the next observation like any cache hit.
- An inspected entry is kept only when its revision and header still match the freshest listing. A session that keeps changing defers alone: its loaded result is discarded so reconciliation neither writes nor deletes its row, leaving whatever the backend already indexed for it untouched. An inspected session absent from the freshest listing has genuinely gone and is deleted.
- `samePersistenceSnapshots` and the corpus-wide discard it guarded are removed.
- `Config.backgroundWarmUp` builds the index once the persistence service attaches, so the first cold build does not have to fit inside one search's `searchTimeoutMs`. It is best-effort and serialized with searches through the existing queue, so a search issued while it runs waits for it rather than racing it; a search whose own deadline expires during that wait still fails.

Deferral is self-healing: the next observation re-reads a deferred session against its then-current revision, so a session that eventually settles is indexed without operator action.

## Evidence

- `session-query-sqlite` unit suite: 77/77 at per-file 100% statements, branches, functions, and lines. The deferral test indexes a session, then makes it churn, and asserts its earlier text is still found — replacing the deferral with a delete fails it.
- Real corpus, one host, same 402 logs, packages taken only from the candidate install: the unmodified build rejects after 464 s with `session-search persistence observation did not stabilize after one retry`; the patched build resolves in 222 s and returns 20 hits.
- End to end through the shipped entry point: a web instance built from the patched slot, run against a cloned state home on a spare port, returns content hits for a sidebar query whose snippets come from session bodies.

## Alternatives considered

- Raise the retry budget. Rejected: the check is unreachable at any budget when a session is written faster than one pass, and every pass costs the full read.
- Exclude live sessions from the drift check. Rejected: it narrows the window without removing the assumption, because a session owned by another process still fails the batch.
- Raise the tool's `searchTimeoutMs`. Rejected: that changes the deadline, not the atomicity, and the budget belongs to the caller's contract.
- Discard the derived index and rebuild on every search. Rejected: it pays the full pass each time while still failing on the same churn.

## Consequences

- A session that never settles is absent from search results until it settles; its indexed row is left untouched rather than deleted.
- `SESSION_QUERY_PERSISTENCE_FAILED` still covers the live-membership retry, which remains a corpus-wide retry, so callers cannot yet treat it as storage-only.
- A cold build still reads the whole corpus once. Deployments that want it charged to activation rather than to a search set `backgroundWarmUp`.
