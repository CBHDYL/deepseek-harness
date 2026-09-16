# Agent Note: Sandbox policy minted authority

Status: implemented

English | [中文](2026-09-16-sandbox-policy-minted-authority.zh.md)
## Problem

An enforcing sandbox backend read the mode from the `SandboxExecutionPolicy` it was handed. That interface is structural, so any consumer can assemble an object satisfying it — for example `{ mode: 'danger-full-access', workspaceRoot: '/tmp' }`. Nothing tied a policy to the service that resolved it, so a caller-constructed object selected the enforcement mode. The tool escalation paths did exactly that (`{ ...standingPolicy, mode: approvedMode }`), and so did the filesystem and shell test doubles.

The service had no deployment ceiling either. `resolve()` returned a session override or an approved escalation mode unchanged, so a deployment could not bound the mode any session reached.

## Decision

This extends the [subprocess sandbox decision](../feature/2026-07-06-sandbox.md), which owns the confinement chain, the escalation path, and per-session modes; those decisions stand. This note adds who may select a mode and the deployment ceiling on it.

`ctx.sandboxPolicy` owns mode selection and issues the only policy objects the enforcing backends accept.

- `Config.maxMode` (default `danger-full-access`, the previously reachable mode) caps every resolution. A deployment whose `mode` exceeds its `maxMode` fails at load.
- `resolve()` deep-freezes its result and records it in a private `WeakSet`; `isMinted(policy)` answers whether this owner produced that exact object.
- The enforcing consumers — the filesystem backend, both shell executors, and the PTC Node runtime — accept a caller-supplied policy only when `isMinted` holds. Otherwise they warn and re-resolve the deployment default, so a forged object narrows rather than widening past it.
- Escalation paths mint through the owner (`resolve({ session, mode: approvedMode })`) instead of spreading the standing policy, so `maxMode` also caps an approved escalation.
- `SandboxPolicyRequest.workspaceRoot` lets a caller that received a mode and a path from another world mint local authority for them, outranking the session cwd. The SSH helper uses it to translate a client-sent policy into its own filesystem: the wire value is an intent, and the local owner issues the authority.
- The shell executors verify the minted set at `resolve`, `run`, and `start`. A check at `resolve` alone leaves the spec mutable between resolution and execution.

## Alternatives considered

**Brand the policy interface.** A branded interface turns every construction site into a compile error and needs no runtime check in same-process consumers, matching the repository rule for opaque cross-boundary values. It cannot cover the SSH helper, which parses a policy from the wire and must mint locally regardless, so that path keeps a runtime check either way. Deferred as a follow-up so this change stays reviewable.

**Check only at the enforcement point.** Fewer call sites, but a forged policy then reaches the mode branch inside `run` before any check runs.

**Reject an unminted policy by throwing.** Fails loud, but a rejected escalation would abort a call the user already approved instead of running it under the standing mode.

## Consequences

A deployment can bound reachable modes with `maxMode`. Consumers that assembled a policy now lose it: every escalation path mints through the owner, and the filesystem, shell, and SSH test doubles were updated to mint. A consumer that still assembles one receives the deployment default and a logged warning, not the mode it asked for.

Coverage: the resolver spec pins capping by an approved override and by a session override, the load-time ceiling failure, the request-root precedence, and that a shallow copy of a minted policy fails `isMinted`. The filesystem, shell, and PTC runtime specs pin that a forged per-call policy is ignored and that an owner-minted escalation applies; the shell specs additionally pin a policy swapped into a spec after `resolve`, and the Seatbelt e2e pins the escalated retry end to end.
