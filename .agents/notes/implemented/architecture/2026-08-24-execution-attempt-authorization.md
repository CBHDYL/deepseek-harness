# Agent Note: Execution-attempt authorization over minted sandbox authority

Status: implemented

English | [中文](2026-08-24-execution-attempt-authorization.zh.md)

## Problem

PR-1 made sandbox authority provenance-checked, but a minted authority is not an authorization: the approval guard keyed its grant by the caller-reusable `callId`, so one approval could leak to a different tool, argument set, or session; a short-circuiting pre-execute listener could skip the ask entirely; the guard asked approval outside the scheduler's single ask point, so its asks carried no execution signal (cancellation hung the turn and teardown); and two approval paths produced contradictory audits (asked twice, or allowed-but-denied).

## Decision

Authorization is owned by the registry's execution lifecycle. Each registry-created execution carries a frozen identity record (WeakMap provenance by the execution object) and a private state machine `prepared → authorized → dispatching → terminal`. The dispatch boundary performs the synchronous, atomic transition into `dispatching` and atomically TAKES the one-shot grant in the same statement; a captured prepared execution, a second `scheduler.dispatch`, a concurrent dispatch, or a `tools/execute` wrapper invoking `next()` twice all fail closed (`DUPLICATE_TOOL_DISPATCH`) — the body continuation is one-shot, so one allowed-once approval can produce at most one actual dispatch.

`ApprovalService` keeps grants in a WeakMap keyed by the exact execution object: only the scheduler's ask (which carries `authorizationSubject`) mints a grant; `take(subject)` spends it atomically; `revoke(subject)` deletes it at the attempt's terminal transition (executed, denied, cancelled). A cancelled attempt in the allowed → minted → cancel-before-take window revokes its grant, so no live grant can outlive the execution lifecycle or be reused by a retry or another attempt. Correlation-only asks (sandbox escalation) mint no grant.

The durable `OperationId` is audit correlation only, never a runtime security capability: per-session counters seed from the loaded log high-water mark (restart/HMR-safe within one session log), caller-supplied ids are only honored when previously minted for that session and claim exactly once, and enforcement reads the frozen identity record, so a mutated live `operationId` cannot move a grant. The digest computation is stack-safe (iterative serialization).

Mandatory security recommendations register on `tools.policy()`, a registry-owned collection that evaluates EVERY policy for every attempt — no listener can short-circuit another — and aggregates deny > ask > allow before the single scheduler approval point. `tools/pre-execute` remains the behavioral waterfall and merges with the collected policy decision; `tools.guard()` is the final monotonic deny fence verifying the exact execution's grant. `approval/request` stays first-claim-wins.

Sandbox escalation joins the same attempt's approval semantics: the escalating tool body passes the attempt's operation id, args digest, and the requested sandbox dimension, and when the single execution approval already named exactly that dimension the body reuses it instead of asking a second human question. PR-1's maxMode ceiling, owner minting, and backend provenance checks are unchanged.

`parent` remains provenance only. The base bundle still ships `action-policy-guard.mode: observe`: the mechanism is implemented but default enforcement is NOT enabled (the Design Review rollout gate stands); the ledger states this explicitly.

## Verification

`core/tools/tests/execution-lifecycle.spec.ts` pins the verification-review probes permanently: a captured prepared execution cannot dispatch twice; concurrent dispatch runs the body once; a `tools/execute` wrapper invoking `next()` twice dispatches once; an allowed attempt takes its grant exactly once and the grant dies at dispatch; cancellation in the allowed → minted → cancel-before-take window revokes the grant; a mutated live operation id cannot move another attempt onto a grant; a never-minted caller-supplied id is replaced; a minted id claims exactly once; a fresh ToolRuntime seeds from the session log (restart/HMR collision guard); an agent-bearing direct execute logs tool/call + tool/result on one operation id. `action-policy-guard/tests/authorization.spec.ts` pins: a consumed grant cannot authorize a second attempt reusing the same call id; a short-circuiting allow cannot hide the mandatory approval ask NOR a mandatory policy denial; a hook-style ask yields exactly one approval; two askers yield one question; deny beats ask regardless of order; the asked → decided → tool/call → tool/result chain joins on one operation id; the sandbox escalation dimension merges into the single execution approval (no second human question); a minted sandbox authority without an operation grant cannot authorize execution under enforce; a cancelled attempt cannot be revived by a late answer. `user-approval/tests` pin atomic take, revocation, no grant on rejected/cancelled/correlation-only decisions. `session/tests/repair.spec.ts` pins operation-id pairing under a reused call id and the legacy call-id fallback. The tools invariant companion now enforces operation-id uniqueness per session log and exactly one terminal disposition per allowed-once. `acp/tests/enforce-cancel.spec.ts` pins the E24 regression. Session fixtures were refreshed for the new correlation fields (escalation approval rows now carry operationId/argsDigest/sandboxMode); the SDK persistent-tools fixture is hand-patched and marked UNVERIFIED_UNTIL_PTY_RERUN.

## Alternatives considered

- **Grant keyed by `callId` plus an args digest** — rejected: the caller-reusable id remains spoofable, and the digest would become a replay-prevention mechanism, which is explicitly not its role.
- **Rewriting the Cordis waterfall into a collection protocol** — rejected: with delegate-and-merge listeners plus the grant-verified monotonic fence, deny > ask > allow holds without changing waterfall semantics; short-circuiting third-party listeners degrade to fail-closed denial instead of authorization.
- **Second approval channel for the guard** — rejected: the design requires exactly one ask point; the guard is a decision source plus a fence.

## Consequences

`operationId` is optional in the event schemas (legacy and crash-repair rows predate it); the A6 relation is enforced by the tools invariant companion over the live event stream. A crash between the taken grant and the dispatched body cannot reuse the grant (repair synthesizes a `tool/result` with the copied operation id instead of re-running). Partially-trusted in-process code that can mint sandbox authorities still cannot execute a side effect without an approval grant for its own attempt under enforce mode; malicious code remains out of scope. Base-bundle enforcement stays `observe` until the Design Review rollout gate completes — the mechanism, not the default, is what PR-2 ships.
