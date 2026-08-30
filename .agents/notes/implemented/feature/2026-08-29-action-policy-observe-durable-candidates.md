# Agent Note: Action-policy guard — durable observe-mode candidate events

Status: implemented

English | [中文](2026-08-29-action-policy-observe-durable-candidates.zh.md)

## Problem

The action-policy guard's `observe` mode reported ungoverned side-effectful calls only through `logger.warn`, a process-local channel that leaves no durable trace. A deployment could not audit which tools were ungoverned, measure the baseline before flipping to `enforce`, or correlate candidates with tool calls after the fact — the whole point of observe mode.

## Decision

In `observe` mode, each side-effectful candidate appends a log-only `action-policy/candidate` session event with payload exactly `{ toolName, callId, effectSource }`:

- `effectSource` is the closed vocabulary `'declared'` (the tool declares `effects: 'side-effectful'`) or `'undeclared'` (the `treatUndeclaredAsSideEffectful` classification caught it) — the two governance facts an observe census reads. - `callId` keys the candidate back to its owning `tool/call`/`tool/result` events, so the payload carries no arguments, commands, paths, justifications, or credentials; the durable log never duplicates tool input or secrets. - The event is `ignorable: true`, so a reader that does not know the type can skip it; `Session.append` gained the typed `LogEventIntent` option for exactly this — the first producer of the envelope marker the session-log versioning note reserved. - Read-only calls append nothing, `enforce` mode never appends the candidate, and an agent-less execution (no session) appends nothing; all of these keep prior behavior byte-for-byte.

## Alternatives considered

**Log candidates through `logger.warn` only.** Rejected: the process-local channel is not replayable, queryable, or durable across resume.

**Record the full arguments on the event.** Rejected: arguments already live on the correlated `tool/call` event; duplicating them in the log doubles tool input and would carry commands, paths, and credentials into a purely informational record.

**Append the event in `enforce` mode as well.** Rejected: enforce already produces the audit trail through the approval seam (`approval/asked`/ `approval/decided`); a second candidate record would double-count denied calls in the census.

## Consequences

Observe mode produces a durable, replayable census of ungoverned candidates that observability and reporting layers can fold per tool and per `effectSource`, without touching execution semantics or model history. The `Session.append` surface now supports the ignorable marker for log-only producers, closing the gap the session-log versioning note deferred.

## Testing

Focused contract tests pin the exact payload keys (and their absence of secret arguments), both `effectSource` values, the `ignorable` envelope marker, and the append-nothing rules for read-only calls, enforce mode, and agent-less executions.
