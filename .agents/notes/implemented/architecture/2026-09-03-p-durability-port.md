# Agent Note: P-DURABILITY port (torn-tail recovery evidence on the candidate handle seam)

Status: implemented

English | [中文](2026-09-03-p-durability-port.zh.md)

## Problem

The candidate persistence architecture already carried the physical repair machinery the verified PR3 invariants need: the JSONL backend detects a torn tail on read, serves only the committed prefix, truncates the torn bytes durably before the write path's first append, rewrites complete events recovered from a torn Zstandard frame, and fails loud on proven stored-content corruption while keeping format refusals and infrastructure failures in their own error classes. What it lacked was verifiable evidence: recovery surfaced only as a process-log warning, so a repaired history resumed silently and no consumer could distinguish a clean log from a torn-tail recovery from unrecoverable corruption.

## Decision

Kept the candidate architecture — the handle seam, the JSONL provider, and the agent layer's ownership of semantic crash repair. Added evidence on two native surfaces:

- **Seam evidence** — `SessionTornTailRecovery` (`{kind:'torn-tail', tornBytes, recoveredEvents}`) on `SessionHandle.tornTailRecovery`, populated only by a `write` open that detected a torn tail and fixed at open time so the fact stays verifiable after the truncation lands. Read opens, clean logs, and created sessions carry none; unrecoverable damage fails the open with `SessionPersistenceCorruptionError`.
- **Durable model-visible evidence** — the new `session/repaired` surface event. The agent loop's resume path appends it after the synthetic closers when the handle reports a recovery, so the resumed model reads that earlier history may be incomplete. A clean resume appends nothing.

The torn-vs-corruption boundary is unchanged and matches the verified reference: an unparsable newline-terminated record is proven damage (corruption, fail-loud) only when later committed content containing a `turn/end` follows it; trailing unparsable bytes stay a recoverable torn tail.

## Consequences

- `session/repaired` is required-on-read and surface-eligible; `deriveEventMessage` projects its notice; `session-reference` skips it in human conversation excerpts.
- Permanent tests: shared handle contract asserts the recovery fact across both JSONL encodings; JSONL specs pin the exact torn-byte count and the corruption boundary (malformed committed record, middle-of-log damage, infra errors untouched); agent-loop resume specs pin the durable notice with and without closers.
- Counterfactuals RED and md5-restored: A (unparsable committed records degrade to torn instead of throwing) breaks six corruption tests; B (write opens stop exposing the recovery fact) breaks the evidence assertions.

## Alternatives considered

- Emitting the notice from the persistence backend: rejected — the candidate documents semantic crash repair as the agent layer's job; the backend reports the physical fact, the agent layer writes the durable record.
- Reviving the verified PR3 coordinator/`TornMarker` repair transaction: rejected — the candidate handle's single-mutation chain already commits truncate-then-rewrite-then-batch with per-step retry; a second repair mechanism would duplicate it.
