# Agent Note: P-AUTHZ authorization port (operation identity, grant, authority snapshot)

Status: implemented

English | [中文](2026-09-02-p-authz-authorization-port.zh.md)

## Problem

The candidate execution chain approved and dispatched through one mutable `ToolExecution` object: `serviceAsk` read `exec.name`/`exec.callId` live, the dispatch body read `exec.name`/`exec.arguments` live, and an `allowed-once` approval outcome was an unattached string — nothing bound it to the execution it authorized, nothing consumed it, and nothing stopped a replay or a wrapper from substituting name or arguments between approval and dispatch. There was also no durable per-session operation identity to correlate a durable `tool/call` row with its execution across reloads.

## Decision

Restored on the candidate scheduler/execution seams, not cherry-picked:

- **Operation identity** — `mintOperationId(agent)` on the registry: per-session `op_<n>` counter seeded from the loaded log's high-water mark over `tool/call` rows (array-like/stub/session-less tolerant), `op_x<n>` for agentless. The agent loop mints before appending the `tool/call` row and passes the id through `ToolExecutionInput`; `tool/call` and `tool/result` rows and `approval/asked` carry it.
- **Authoritative snapshot** — `createExecution` freezes `{operationId, name, callId, arguments}` (arguments are the same deep-frozen lossless value) into a private `WeakMap`. Dispatch-stage reads (`serviceAsk` identity, grant binding, `dispatchToolBody` resolution + body args, `createSuccessResult` render/presentationMeta, `normalizeDispatchResult`, post-execute value replacement) all read the snapshot, never the live execution.
- **Exact one-shot grant** — on `allowed-once`, the registry mints a grant bound to the snapshot (operationId, tool name, callId, SHA-256 args digest) and marks the execution grant-required. `dispatchScheduledExecution` consumes it at the dispatch start — before wrappers and body — deleting it; a replayed or second dispatch finds no grant and fails closed.
- **Failure semantics** — a throwing `tools/execute` wrapper after the body ran still yields an error result (fail-loud), never a fake not-executed; the loop keeps citing the recorded `tool/call` row.

## Consequences

- New permanent suite `packages/core/tools/tests/operation-grant.spec.ts` (9 cases): legitimate allow, ask→approve single ask, ask→deny, replay fail-closed via the scheduler channel, wrapper args/name substitution inert, post-dispatch wrapper failure fail-loud, high-water seeding, agentless counter.
- Counterfactuals RED and md5-restored: CF-A (dispatch reads live exec fields) → both substitution tests RED; CF-B (grant check disabled) → replay test RED.
- Regression: tools 399/399, tools+agent-loop+user-approval+sandbox family 1221/1221; P-SANDBOX 93/93; typecheck 0; oxlint 0.
- Residual, unchanged from the verified invariant: escalation remains a separate PR-1-verified body approval decided after the gate ask — two distinct risk domains, not one merged question.

## Alternatives considered

- Merging the gate ask and the sandbox escalation into one approval: rejected — the verified invariant keeps them as separate risk domains (action policy vs sandbox-dimension widening).
- Stamping the grant as a string on the execution: rejected — any string is copyable; `WeakMap` keyed by execution identity is the only non-reproducible binding.
