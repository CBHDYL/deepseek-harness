# Agent Note: P-PROJECTION port (single-flight cold builds, covered-clean reuse, no resurrection)

Status: implemented

English | [中文](2026-09-03-p-projection-port.zh.md)

## Problem

The candidate's `SessionObservationReader` cached prepared cold reads per session id, keyed by persistence instance and the stat revision, but nothing de-duplicated concurrent builds and nothing ordered commits: two reads racing over the same source and revision each paid the full log read plus `Session.prepare`, and an in-flight build that a newer read superseded could still land its stale entry into the cache after the newer one committed — the classic resurrection race the verified PR4 invariants forbid.

## Decision

Added the minimal mechanism on the candidate's own reader seam, reusing its existing revision-keyed prepared-entry cache:

- **Single-flight** — an `inFlight` map keyed by `id@revision`, bound to the producing persistence instance. Concurrent reads over the same source and revision share one log read + prepare; only the build starter owns a commit ticket, so sharers cannot move the ordering.
- **No resurrection** — a per-id `loadGeneration` ticket taken when a build starts; the build commits into the cache only while its generation is still the newest for the id, so a stale in-flight build commits nowhere. Its own lease still serves the caller its exact (older) cut — staleness is confined to that lease, never resurrected into the cache.
- **Failure semantics** — a failed or aborted build clears its in-flight slot with the promise (the cleanup promise swallows the shared rejection), so the next read retries from scratch; nothing partial is stored. Covered-clean reuse, revision-mismatch rebuild, capacity eviction, and pinning are unchanged.

## Consequences

- Eight permanent tests on the reader: same-key concurrent sharing, cross-key isolation, failure + retry, exact covered-clean, stale-revision rebuild, stale in-flight build vs newer commit (no resurrection), abort + healthy retry, and stable idempotent reads across leases.
- Counterfactuals RED and md5-restored: A (single-flight disabled) breaks the sharing test; B (covered-clean disabled) breaks eight cache tests; C (commit guard removed) breaks the no-resurrection test.
- The reader's cache remains a pure optimization: entries are possibly stale but never wrong, and eviction/pinning semantics are untouched.

## Alternatives considered

- A per-session promise/borrow cache in the persistence layer: rejected — that is the deleted coordinator-era borrow/reservation architecture; the candidate reader cache is its designated successor seam.
- A global projection lock: rejected — per-reader state keyed by session id is strictly smaller and owns no shared authority.
