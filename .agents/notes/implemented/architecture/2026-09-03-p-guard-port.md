# Agent Note: P-GUARD port (central action-policy interception on the candidate seams)

Status: implemented

English | [中文](2026-09-03-p-guard-port.zh.md)

## Problem

M4 established that the candidate lacked the action-policy guard entirely: no central policy interception existed, sensitive tool bodies were gated only when they volunteered an approval request, the base bundle composed no guard row, and the packed candidate therefore missed a critical capability (R2 candidate-absent) with real profile compatibility failures.

## Decision

Ported the verified guard's semantics onto the candidate's own seams, not its source:

- **Central interception** — a `tools/pre-execute` listener installed under `ctx.inject(['tools'])` folds with the scheduler under deny > ask > allow, so every execution in the ToolRuntime authority domain passes one policy seam regardless of listener order.
- **Shipped classification** — `ToolDefinition.effects` (`'read-only' | 'side-effectful'`), declared only by shipping definitions. fs write/edit, bash, and pwsh ship `side-effectful`; fs read/read-image ship `read-only`; everything undeclared (including MCP tools, whose metadata never populates the field) is gated by the `treatUndeclaredAsSideEffectful` default. MCP/self-declared effects remain untrusted.
- **observe/enforce** — `observe` (default, the base bundle's mode) logs the minimal `action-policy/candidate` event and delegates; `enforce` fails closed (no approval service or no agent ⇒ deny) or returns `ask`, which flows into P-AUTHZ's single approval point. The guard never mints grants, never asks twice, and never authorizes — P-AUTHZ remains the sole execution authority.
- **Bundle integration** — the base bundle composes the row (observe mode) and declares the package in its dependencies, so `verify-cordis-config` resolves it and the packed candidate carries the capability (R2's existing seven-name critical list closes).

## Consequences

- New package `@deepseek-ai/dsh-action-policy-guard` with the ported observe/enforce suites (18 permanent tests including the execution-attempt authorization contract); the base bundle spec pins the composition row and the dependency declaration.
- Counterfactuals RED and md5-restored: A (interceptor removed) breaks the observe/enforce denial tests; B (ask short-circuited into allow) breaks seven authorization tests; C (a second approval question fired beside the fold) breaks eight single-approval tests; D (bundle row removed) breaks the composition test.
- The audit-chain test asserts asked→call→result join on the operation id and pairs decided by the approval id (operationId on `approval/decided` stays a deferred P2).

## Alternatives considered

- A second policy DSL or a guard-owned approval service: rejected — the candidate's `tools/pre-execute` fold and P-AUTHZ's single ask are the authoritative seams; the guard only classifies and delegates.
- Emitting effects from MCP `tool.execution` metadata: rejected — bridge-transported metadata is never a trust authority.
