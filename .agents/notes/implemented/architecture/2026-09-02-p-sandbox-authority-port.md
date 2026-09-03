# Agent Note: P-SANDBOX authority port (deployment ceiling + minted provenance)

Status: implemented

English | [中文](2026-09-02-p-sandbox-authority-port.zh.md)

## Problem

The candidate upstream sandbox policy resolves a plain `SandboxExecutionPolicy` object per call, and the enforcing filesystem/shell backends trust whatever object a caller stamps. A caller-constructed policy — spread clone, JSON round-trip, or plain literal claiming `danger-full-access` — carried full authority, and no deployment ceiling existed above session overrides, tool requests, or approved escalations.

## Decision

The invariant is restored on the candidate seams, not cherry-picked:

- `packages/sandbox/sandbox-policy` — `Config.maxMode` (default `danger-full-access`; schema-validated). Every `resolve()` result is capped at `min(requested, maxMode)`, then `deepFreeze`d and registered in a private minted `WeakSet`; `isMinted(policy)` is the only provenance. Resolved policies are the single authority shape.
- `packages/fs/fs-sandbox` — `checkedTarget` accepts only minted policies; a forged one re-resolves to the deployment default (≤ maxMode).
- `packages/shell/bash-sandbox` / `pwsh-sandbox` — `resolve()` stamps only a minted caller policy; `run()` re-checks at consumption, so a policy swapped in after resolve also re-resolves to the deployment default.
- `packages/fs/tool-fs` / `tool-bash` / `tool-pwsh` — escalation no longer assembles `{...policy, mode: approved}`; the approved mode is re-minted through the owner (`sandboxPolicy.resolve({ session, mode })`), so the result is capped and provenance-preserving.

Upstream tests that encoded the obsolete caller-supplied semantics were updated to mint through the owner (escalation intent unchanged). New permanent tests: `sandbox-policy/tests/authority.spec.ts` (minted/forged/spread/JSON/cap/remint/schema) plus forged-and-minted enforcement cases in the fs and bash suites; pwsh enforcement mirrors bash by construction (pwsh-gated on this host).

## Consequences

- Counterfactuals RED and restored (md5-verified): `isMinted` always-true → 6 forgery tests fail; maxMode cap removed → 3 ceiling tests fail.
- Regression: sandbox family + tool-fs/tool-bash/tool-pwsh suites green (482 passed / 7 platform-skips); typecheck 0; oxlint 0.
- Residual, unchanged from the verified invariant: a forged policy under a session-narrowed default resolves to the deployment default, not the session mode — direct capability callers are not session-narrowed by the policy owner; the tool layer owns session narrowing.

## Alternatives considered

- Rejecting forged policies outright instead of re-resolving the deployment default: rejected — the verified fallback semantics keep forged inputs inert rather than turning a missing-stamp bug into a hard failure surface.
- Stamping provenance in a copied field: rejected — any field is copiable; WeakSet membership is the only non-reproducible provenance.
