# Agent Note: Minted sandbox authorities with a deployment ceiling

Status: implemented

English | [中文](2026-08-24-sandbox-authority-provenance.zh.md)

## Problem

The sandbox policy owner resolved a per-call `SandboxExecutionPolicy`, but the enforcing backends accepted any caller-supplied policy object verbatim: `FileSystem.writeText(..., sandboxPolicy?)` and `ShellExecRequest.sandboxPolicy` carried caller-chosen fields, and omission fell back to the deployment default while ignoring a session's narrowed mode. A partially-trusted in-process plugin could therefore construct `{ mode: 'danger-full-access', workspaceRoot: '/…' }` and execute outside every grant. Separately, nothing capped an approved escalation or session override against the deployment's own policy — a deployment that only ever intended `workspace-write` could still reach `danger-full-access`.

## Decision

`SandboxPolicyService` mints every resolved authority: `resolve()` freezes the returned policy object and records it in a private `WeakSet`; `isMinted(policy)` answers provenance. The enforcing backends (`dsh-fs-sandbox`'s `checkedTarget`; `dsh-bash-sandbox` and `dsh-pwsh-sandbox` at `resolve`, `run`, and `start`) accept only minted authorities and, on a forged object, log a warning and re-resolve from the owner's default — the forged object's declared fields never take effect. Escalation paths in `tool-fs`, `tool-bash`, and `tool-pwsh` mint the approved mode through `sandboxPolicy.resolve({ session, mode })` instead of spreading a constructed object.

The service gains a `maxMode` config: the hard deployment ceiling, default `danger-full-access` (preserving the pre-existing semantics where an approved escalation may reach the widest mode). `resolve()` caps the effective mode — default, session override, or approved escalation — at `maxMode`, and a deployment default wider than its own ceiling fails at load.

The `ResolvedSandboxAuthority` branded type is exported for caller-side compile-time intent, but the runtime boundary is the WeakSet membership check. What this check does NOT claim: the forged fallback is the deployment default, which can be wider than a session's narrowed standing mode; a minted authority can be captured and replayed; `resolve({ session, mode })` stays directly callable up to `maxMode`. Those are the operation-bound grant's (PR-2) closures. It is also not a malicious-code boundary: a plugin that can patch the service or reach an unrestricted capability remains outside the threat model.

## Verification

`sandbox-policy` tests pin the ceiling over approved escalations and session overrides, minted-versus-forged provenance, and the fail-loud default-above-ceiling load error. `fs-sandbox` tests prove a forged per-call policy is ignored and confined by the deployment default while an owner-minted escalation passes the fence, and pin the PR-1/PR-2 boundary semantics (a forged fallback can be wider than a session narrowing). `bash-sandbox` and `pwsh-sandbox` tests pin forged-object rejection at `resolve()` AND the run/start substitution attacks (a policy swapped into a resolved spec re-resolves to the deployment default instead of executing under the forged fields). `tool-pwsh` tests pin that an approved escalation above `maxMode` is capped. Existing per-call escalation tests were converted to mint their policies through the owner. The escalation ACP snapshots (escalation-approved/rejected) remain unchanged because minting adds no persisted fields.

## Alternatives considered

- **Branded type only** — rejected: TypeScript brands erase at runtime, so a compiled JS plugin could construct a structurally identical object; the WeakSet check is the boundary.
- **Cryptographic capability signing** — rejected: over-engineering for a same-process trust boundary; a registry-minted membership check has the same effect without key management.
- **Required authority parameter on the fs/shell service definitions** — deferred: the bare (unconfined) backends legitimately run without a policy service, and the runtime provenance check closes the forged-object path without breaking that composition.

## Consequences

Escalation requests are still approved at the tool layer (`approveEscalation`); `resolve({ session, mode })` remains callable directly, so an in-process caller can mint an escalated authority up to `maxMode` without presenting an approval. With the default `danger-full-access` ceiling this preserves the historical self-service semantics; a deployment that wants approval-authenticated escalation must set `maxMode` to a confined mode or wait for the operation-bound approval grant (remediation PR-2), which closes that path by construction. Forged authorities are rejected everywhere a backend consumes a policy; omitted policies still fall back to the deployment default rather than a session's narrowed mode, which remains a documented gap for session-scoped direct callers until the service definitions require the authority.
