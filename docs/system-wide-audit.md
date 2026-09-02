# Final Convergence Audit and System Remediation Plan

English | [中文](system-wide-audit.zh.md)

Audit date: 2026-08-24 (round 4, the convergence round)

Method: read-only product code. In an untracked `.audit-tmp/` scaffold, 31 experiments E1–E31 were constructed (19 specs, 75 assertions), all executed through real plugin assembly, a real ACP bridge, real JSON-RPC transport, a real MCP client bridge, and real subprocess runs; repeated runs were consistent. No production code, config, or fixture was modified; no snapshot was refreshed; `--update` / `test:snapshot:record` / `doc-sync` were not run.

---

# Phase 1: Final Convergence Audit

## A. Final audit reconciliation

Round 4 independently re-verified every architecture-affecting conclusion of the previous three rounds. The table below lists only the entries whose design outcome changed.

| Conclusion | Prior rounds | Round 4 | Key evidence | Level |
|---|---|---|---|---|
| Default profile is `observe`; side-effectful tools run as usual | CONFIRMED | **CONFIRMED** | `packages/bundle/base/cordis.patch.yml:415-422`; `action-policy-guard/src/index.ts:89-101`; E18 | L4 |
| callId reuse punches through the `tools.guard()` fence | CONFIRMED | **CONFIRMED, and precisely bounded by E31** | E1 positive and negative cases; E31 proves the **normal pipeline path** still asks per call for duplicate callIds — the hole only exists on the pre-execute short-circuit path | L4 |
| Two contradictory approval semantics (deny after approval / two asks per call) | CONFIRMED | **CONFIRMED** | E16 (prepended `ask` → human already approved yet the fence still denies); E17 (guard registered first → two `approval/asked` events) | L3 |
| Cancellation does not terminate guard approval | CONFIRMED | **UPGRADED: it blocks teardown** | E9 turn hangs; **E24 new**: after ACP `session/cancel` the prompt never settles and `dispose()` does not finish within 3s (`AUDIT-E24 disposal: hung`), while the core ask path E23 disposes normally | L3 |
| ACP approval cancellation not propagated | UNPROVEN | **RESOLVED: core path correct, guard path fatal** | E23 core ask: prompt settles `cancelled`, tool does not run, the client permission request stays pending (one orphan prompt, acceptable); E24 guard path: the whole chain hangs | L3 |
| Direct `ctx.fs`/`ctx.shell` callers choose the final authority | CONFIRMED | **CONFIRMED** | E7 (self-selected `danger-full-access` writes out of bounds and succeeds; widening only `workspaceRoot` also succeeds; omitting the policy **ignores session narrowing** and falls back to the deployment default); E15 (`ctx.shell.resolve()` is isomorphic) | L3 |
| MCP has no effects | CONFIRMED | **REFRAMED: not a bug, the correct trust posture** | **E28 new**: a server forging `effects: 'read-only'` and `annotations.readOnlyHint` is fully ignored; **E29 new**: MCP tools under enforce-default are indeed gated and can be denied | L3 |
| MCP input schema / description unbounded | Uncovered | **NEW / CONFIRMED** | E28: a malformed `type` is registered verbatim into the model-visible schema; a 500 KB description has no length cap (tool count is capped by `maxToolsPerServer`) | L3 |
| Mid-log JSONL corruption silently truncated | CONFIRMED | **UPGRADED: corruption is disguised as a normal interrupted turn** | **E27 new**: reload after corruption — `load()` synthesizes closers over the truncated prefix and the log closes normally with `turn/end {reason:{kind:'interrupted'}}`, **indistinguishable** from a real interruption | L3 |
| No integrity signal on crash recovery | Partial | **CONFIRMED** | E26: torn-tail reload succeeds and the return value carries no `integrity`/`truncated` field; the real `kill -9` e2e (`crash-recovery.e2e.ts`) ran this round and failed only on an attempt-event assertion mismatch — the crash semantics themselves are correct | L3 |
| cwd restored without re-validation | CONFIRMED | **CONFIRMED** | E21 (deleted / symlink retargeted / replaced by a file — all returned verbatim) + E22 (a symlinked cwd becomes a legal sandbox root) | L3 |
| telemetry lost after first-delivery failure | CONFIRMED | **CONFIRMED, documented at-most-once** | E3 four cases; stated explicitly in `session-telemetry/src/coordinator.ts:151-163` | L3 |
| projection overlapping flush loses updates | PARTIALLY | **CONFIRMED, but self-healing** | E10 loses the update and zeroes dirty; E12 cold-read refold repairs; stored seq is honest | L3 |
| compaction request not reconstructable | Overturned | **Overturned, upheld** | E4 field-by-field equal; the residual problem is that reconstruction needs seq-awareness (E5/E6) | L3 |
| request invariant misses provider/effort | Overturned | **Overturned, upheld** | E19: the dispatched request is the expansion of the recorded header and is deepFrozen | L4 |
| subprocess cleanup incomplete | Overturned | **Overturned, upheld** | E20: all five failure classes handled correctly | L3 |
| SDK malformed JSON silently ignored | UNPROVEN | **RESOLVED: confirmed and quantified** | **E25 new**: malformed lines, non-object frames, and unmatched response ids are all silently dropped with no diagnostics; **but** partial frames are correctly buffered and later valid frames do not desync; **a throwing notification handler produces no error frame** (a throwing request handler does) | L3 |
| Missing global prompt budget | UNPROVEN | **RESOLVED: confirmed missing and quantified** | **E30 new**: 50 KB persona + 40 large-description tools + 200 KB user input → a single request of **1,053,485 bytes** sent in full with no aggregate trimming | L3 |
| hooks authority | UNPROVEN | **Classified as a product decision** | `hook-protocol/src/runner.ts` accepts no Agent/Session/policy; the code cannot self-certify the intended semantics | N/A |

## B. Remaining unknowns

The following remain unverified and were judged **not worth verifying before remediation begins**, with reasons:

1. **Transport-layer hostile behavior of a real remote MCP server** (TLS interruption, slow attacks). `syncTimeoutMs`/`maxSyncPages`/`maxToolsPerServer` are already bounded (E28 verified one of them); the remaining risk is operational configuration and does not change the authorization-model design.
2. **Windows crash recovery and sandboxing.** CI has a Windows lane; this round's conclusions are all platform-independent semantic issues (authorization binding, log integrity, event sequence numbers).
3. **Multiple processes concurrently writing one session log.** `session-persistence/src/coordinator.ts` handles it with stale-revision retries; not constructed this round, but it does not affect any of this round's architecture decisions.
4. **OTel export end-to-end.** Telemetry was judged best-effort observability (see E-Target); its export details do not enter the core invariants.
5. **The authority hooks should have**: this is a product decision, not a code finding. A human must decide whether hooks are session-scoped or trusted-host before the code has a correct target.

## C. Audit completeness judgment

- **Audit completeness confidence: high (about 85%)** — the audit covered the five axes of authorization, persistence, derived state, the event model, and trust boundaries; every axis has L3-level experiments, and the 8 new experiments added in round 4 (E23–E31) **overturned none of the existing root causes — they only turned two UNPROVEN items into RESOLVED and reclassified one finding (MCP effects)**. That is a saturation signal.
- **Remaining unknown-risk surface: medium-low.** Concentrated in the platform matrix (Windows), remote transport hostility, and multi-process concurrency — none of which changes this report's target architecture.
- **Evidence saturation level: high.** Round 2 ran 0 experiments, round 3 ran 22, round 4 added 9; the per-experiment new-finding yield dropped from about 40% in round 3 to about 22% this round, and every new finding this round falls **inside an existing known root-cause category** (E24 authorization cancellation, E27 log integrity, E28/E29 trust boundary, E30 resource boundary) — no new category opened.
- **Continue general auditing recommended: no.**
- **Why:** the marginal output of continued free-form auditing is clearly below the remediation benefit. The current five root causes already explain the behavior of all 31 experiments this round; further problems found are very likely the Nth manifestation of the same root cause, and those manifestations disappear together after the root fix. Conversely, the largest remaining uncertainty is **"whether the fixes themselves introduce more complex problems"** — that must be answered through design and implementation, not more auditing.

**GENERAL AUDIT COMPLETE**

## D. Root-cause model

The previous three rounds listed five root causes. This round's review **merges them into four** and names one mis-merge from round 3.

### RC-1 Authorization is not an object but a reusable string key

`ToolExecutionInput.callId` (`packages/core/tools/src/index.ts:326`) is caller-provided and is the sole authorization key (`action-policy-guard/src/index.ts:65,77,128`). It binds no tool name, arguments, session, agent, or scope; it is never consumed and never expires.

All derived failure modes: cross-tool replay (E1), deny after approval (E16), double ask (E17), cancellation not terminating (E9/E24), audit unable to prove execution (E16's log shows `allowed-once` but the tool did not run).

**Round 3's mis-merge**: round 3 grouped "final authority delegated to the caller" (the optional `sandboxPolicy?` parameter) with RC-1. This round holds they **must be split** — their fixes are completely different: RC-1 needs the lifecycle of an authorization object; sandbox authority needs **removing an optional parameter and letting the policy owner compute**. See RC-2.

### RC-2 The final computation of sandbox authority sits with the caller

`FileSystem.writeText(..., sandboxPolicy?)` (`packages/fs/fs/src/index.ts:222-249`) and `ShellExecutor.resolve(request.sandboxPolicy?)` (`packages/shell/bash-sandbox/src/index.ts:84-86`) both take the final policy as an **optional parameter**. Both abuses were demonstrated: explicitly passing a wider policy (E7), and omitting the parameter to receive the deployment default while bypassing session narrowing (E7 case 4, E15).

This is not a manifestation of RC-1: even if authorization becomes a one-shot object, the path stays open as long as `sandboxPolicy` remains an optional parameter.

### RC-3 Missingness and corruption are modeled as "a shorter correct log"

Three places share the same pattern:

- Mid-log JSONL corruption → truncation → `load()` synthesizes closers → presented as a normal interrupted turn (E13/E14/E27).
- telemetry first-delivery failure → the cursor is advanced by later events → the record disappears forever (E3).
- projection overlapping flush → the old value overwrites the new → dirty zeroes → no retry triggered (E10).

**This is the most dangerous one**, because it defeats the invariants: the agent-loop request invariant compares "the derivation of the current log" with "the current request"; when the log shortens, both shorten together and keep passing. **The invariants are blind to consistent missingness.**

### RC-4 The canonical sequence is an over-shared global resource

`session.append()`'s `seq` serves simultaneously: durable truth, model-visible derivation, `sourceEventSeqs` references, the SDK wire, and snapshot expected output. `ignorable: true` (`core/session/src/index.ts:607-609`) only lets **readers that do not know the type** skip it; it does not make the sequence number unoccupied. Therefore adding one pure diagnostic event drifted all 132 fixtures (round 3 NEW-1; this round's crash-recovery e2e hit the same cause again).

### Explicitly downgraded this round (not independent root causes)

- **"Missing global budget"** (the 1 MB request E30 quantified): real, but it is a **capability gap** rather than an architecture defect; fixing it changes no existing semantics.
- **"MCP has no effects"**: E28 proves the current posture is correct — nothing the server says is trusted. The real gap is that the harness never wrote the fact "MCP = always undeclared" into any authoritative artifact.

### Trust model (defined explicitly this round; no longer hand-waved as "same process, therefore trusted")

| Subject | May decide | May not decide | Compliant today |
|---|---|---|---|
| trusted core (`core/*`, `session/*`, `sandbox-policy`) | everything | — | yes |
| trusted in-process plugin (in the bundle, reviewed with the release) | which operation to request, tool implementation | final sandbox mode, whether to skip approval | **no** (E7/E15) |
| partially trusted plugin (third-party mounted from cordis.yml) | same as above | same as above, and must not bypass the fence via pre-execute short-circuit | **no** (E1) |
| MCP server | tool name/description/schema, results | its own effects classification, names outside its namespace, unbounded advertisement | **partial** (effects/names correct; schema and description unbounded) |
| hook process | suggest deny / attach context | privilege escalation, silently passing enforcement | **undefined** (product decision) |
| model-generated tool call | which tool, which arguments, request escalation | its own callId semantics, bypassing approval | **no** (callId is the authorization key, see E1/E31) |
| subagent | operate within its inherited scope | widen its own scope | yes (the delegation policy in `subagent/README.md` is implemented) |
| external ACP/SDK caller | initiate prompts, cancel, answer approvals | decide authority on behalf of the policy owner | yes |

## Phase-1 carryover: second-order problems that only appear after fixes

For each proposed fix, this round actively checked what new problems it would create.

| Proposed fix | Second-order risk | This round's evidence/judgment | Mitigation |
|---|---|---|---|
| operation-bound one-shot authorization token | **Retry semantics broken**: an LLM retrying the same tool call reuses the callId; a one-shot token turns a legitimate retry into a denial | E31 measured: when the model sends the same callId twice, the normal pipeline **already** asks twice — "one authorization per execution" is current fact; the token only needs to align with it | the token binds the execution token (`ToolExecutionToken`, minted by the registry itself, `core/tools/src/index.ts:315-318`), not callId; a new one is minted per `execute()` |
| single approval point (merging core ask and guard) | **After duplicate approvals disappear, the hooks' `ask` semantics have no home** | E16/E17 prove that two coexisting points necessarily produce contradictions | keep `ask` as a **decision**, but only the registry calls approval; the guard no longer calls approval itself |
| policy-owner-computed sandbox authority | **Plugin breakage**: every call site that currently passes a policy must change | `grep` shows the production call sites that pass policies are concentrated in `tool-fs`/`tool-bash`/`tool-str-replace-editor`/terminal — a bounded set | change `sandboxPolicy?` from an optional parameter to a **required, policy-owner-minted, unforgeable value**; the type system exposes every call site at once |
| corruption diagnostics | **All old sessions become "unknown integrity"** → users see many warnings | E27 shows it is currently indistinguishable, and adding a marker does not help **historical logs with no marker** | three-valued integrity state: `intact` / `repaired` / `unknown`; historical logs without per-record checksums are all `unknown`, the UI does not disturb by default, and only `repaired` prompts the user |
| projection sequencing | **Over-engineering risk**: lock/CAS/generation — easy to adopt all three | E12 already proves cold-read self-healing; E10's window exists only inside live sessions | only **single-flight serialization** (one promise chain per session); no CAS or generation tokens |
| event taxonomy split | **Replay incompatibility + migration cost** | `SESSION_FORMAT_VERSION = 0` (`core/session/src/types.ts:56`) and AGENTS.md states "no compatibility promise" | see section K: do not split seq; change how fixtures are generated (an order of magnitude cheaper) |
| global prompt budget | **Silent history truncation → model behavior degradation** | E30's 1 MB request is an extreme construction; real deployments are closer to the limit than over it | only **observability + hard-cap rejection**, no silent trimming; trimming belongs to the existing compaction |

---

# Phase 2: System Remediation & Modernization Plan

## E. Target architecture

### E-1 Authorization: one operation, one authority

Introduce three immutable types, all living in `packages/core/tools` (the natural owner of authorization, since it already owns `ToolExecutionToken` and execution scheduling):

```text
OperationIdentity   minted by ToolRuntime in createExecution()
  token: ToolExecutionToken   // registry-private symbol, callers cannot forge it
  callId: CallId              // kept, used only for correlation and display
  name: string
  argsDigest: string          // sha256(canonical JSON)
  sessionId / agentId / scope
  parentToken?                // nested / Code Mode child dispatch

AuthorizationGrant  issued by ApprovalService, one-shot
  identity: OperationIdentity // valid only on exact match
  outcome: 'allowed-once'
  issuedAt / expiresAt

AuthorityContext     computed by SandboxPolicyService, not constructible by callers
  mode / workspaceRoot / sessionId
  brand: unique symbol        // see below
```

- **Creator**: `ToolRuntime.createExecution()` mints the identity.
- **Issuer**: `ApprovalService.request()` returns a grant (not a bare string).
- **Consumer**: `ToolRuntime.guardReason()` consumes and invalidates it.
- **One-shot**: yes. Removed from the map after consumption.
- **Retry**: each `execute()` mints a new token, so retries naturally re-authorize — consistent with the behavior E31 observed, not new semantics.
- **Nested/subagent**: child dispatches carry `parentToken`; the policy is "if the parent is authorized, children within the same token tree need no ask" — the natural extension of Code Mode's existing `parent` semantics (`core/tools/src/index.ts:337-346`).
- **Args digest**: required. Without it, different arguments under the same name and session (`rm -rf /` vs `ls`) share one authorization.
- **Audit correlation**: the string projection of `OperationIdentity.token` is written as `operationId` into the optional fields of four existing events — `approval/asked`, `approval/decided`, `tool/call`, `tool/result` — **no new event types**, so RC-4's fixture drift is not triggered.

### E-2 Sandbox: intersection, not caller choice

Final policy = **deployment default ∩ session override ∩ tool requirement ∪ approved escalation**, all computed by `SandboxPolicyService.resolve()`.

The three candidate designs are compared in section I. Intersection was chosen over capability tokens or a policy lattice because: there are only three ordered modes today (`read-only < workspace-write < danger-full-access`, see the Config union in `sandbox-policy/src/index.ts`), and a min operation over a total order is the complete answer; a lattice needs a partial order, and there is no partial-order requirement today.

The `sandboxPolicy` parameter changes from `SandboxExecutionPolicy | undefined` to **a branded `ResolvedSandboxAuthority`** (using `Branded<'SandboxAuthority'>` from `dsh-brand`; the repo already has this convention). Callers cannot construct a branded value — they can only obtain one from `ctx.sandboxPolicy.resolve()`. Omission becomes impossible — the parameter becomes required.

**May a direct `ctx.fs` / `ctx.shell` caller pass the final policy: no.** It may pass a **request** ("I want workspace-write") and the policy owner returns the authority. This matches the repo's existing request/spec split (AGENTS.md: `dsh-shell`'s request/spec split is the template).

### E-3 Approval: one call site

- `ToolRuntime.serviceAsk()` (`core/tools/src/index.ts:1700-1740`) is the **only** place that calls `approval.request()`.
- `action-policy-guard` no longer calls approval itself; it degrades into a **pre-execute decider** that returns `{kind:'ask'}` for undeclared/side-effectful tools, and the registry uniformly executes the approval and issues the grant.
- `tools.guard()`'s monotonic fence stays, but checks **whether a grant exists and matches the identity**, instead of `approved.has(callId)`.
- This step eliminates both E16 (deny after approval: issuer and consumer are the same path) and E17 (double ask: only one call site).
- **Lifecycle**: `allowed-once` binds the identity and invalidates on consumption; `rejected` terminates immediately; `cancelled` is triggered by the signal (the registry already passes `exec.signal` correctly, see `core/tools/src/index.ts:1722` and E23); **late responses are naturally discarded**, because `ApprovalService.decide()`'s abort race already does this (`user-approval/src/index.ts:331-343`).
- **Do not introduce** `allowed-session`: there is no product need today, and it would reintroduce a reusable credential.

### E-4 Persistence: truncation must leave a trace

Mid-log JSONL corruption is handled by **truncate-with-diagnostic + integrity marker**, not fail-hard, not quarantine:

- fail-hard would let one bad byte destroy the whole session, conflicting with the goal "caches may be stale but the log must not lie".
- quarantine needs a new storage location and lifecycle — disproportionate complexity.
- The chosen design: `SessionLogScan` gains `integrity: 'intact' | 'repaired' | 'unknown'` and an optional `truncatedAtLine`; `load()` passes it into `SessionSnapshot`; when closers are synthesized, **one additional `session/repaired` durable event is written** recording the truncation position and the number of lost lines.

This new event is the **only** new event type required, with full justification: it is part of recovery semantics, must be durable (otherwise it is lost again after restart), and must be model-visible (the model needs to know its history is incomplete).

**Old-session compatibility**: historical logs without per-record checksums are all `unknown`; this is honest and needs no migration.

### E-5 Derived state: single-flight, not distributed consensus

- **projection cache**: one `Promise` chain per session serializes `flushSoft`. This directly eliminates E10's lost update, at the cost of one line of complexity.
- **Do not do** CAS, generation tokens, or version vectors: E12 already proves cold-read self-healing; the remaining window exists only inside live sessions and is fully closed by single-flight.
- **Stale semantics**: keep "may be stale; the seq says how stale" — the design itself is right (E10 measured the stored seq as honest).

### E-6 telemetry: explicitly best-effort observability

Basis: the comment in `session-telemetry/src/coordinator.ts:151-163` already states at-most-once is an **intentional choice**; E3 proves the implementation matches the documentation.

Therefore: **no** durable queue, no at-least-once, no Kafka. The only change is writing "first-delivery failure is permanent loss" into the Known Limitations of `session-telemetry/README.md` and exposing a failure counter for operations to observe.

**If** telemetry must serve as compliance audit evidence in the future, a durable ledger is introduced then — but that should be a separate audit channel, not an upgrade of observability.

### E-7 Event model: do not split seq

Judgment: `ignorable` events **should continue to occupy the canonical seq**.

Rationale: `sourceEventSeqs` uses seq as references (`core/agent-loop/src/tool-calls.ts:303,328`), `interruptedTurnClosers` infers open state from ordering (`core/session/src/repair.ts`), and persistence uses contiguous seq to detect gaps (`session-persistence-jsonl/src/format.ts:364-373`). Moving diagnostic events out of the canonical sequence would require a **second** reference and gap-detection mechanism for them — a classic "split for uniformity's sake".

The real problem is not the event model; it is **how fixtures record expectations**: expected output pins absolute seqs. The fix lives in the test infrastructure (see section J), an order of magnitude cheaper.

## F. Architectural invariants

The remediated system must satisfy these, and each is machine-checkable:

**AUTHORITY**

- A1 Each side-effectful execution consumes at most one `AuthorizationGrant`, and the grant's `OperationIdentity` matches the execution exactly.
- A2 An `AuthorizationGrant` invalidates after consumption; the same grant cannot authorize a second execution.
- A3 An `AuthorityContext` can only be minted by `SandboxPolicyService`; any caller-provided value is unconstructible at the type level.
- A4 One tool call produces at most one `approval/asked` + `approval/decided` pair.
- A5 After execution cancellation, its approval settles as `cancelled` within bounded time and does not block turn end or fiber disposal.
- A6 After `approval/decided: allowed-once`, the same operation either executes or produces one `tool/result` stating why it did not.

**DURABILITY**

- D1 The snapshot returned by `load()` carries `integrity`; `repaired` necessarily comes with one `session/repaired` event.
- D2 Corruption in the committed region is never presented as a "normal short log".
- D3 After crash/restart, an unknown integrity state must not be marked `intact`.
- D4 The durable log is the only canonical source; cache/projection/telemetry must never become recovery input.

**DERIVED STATE**

- E1 Checkpoint writes for one session are serialized; a later-initiated write is not overwritten by an earlier-initiated one.
- E2 A cache row's carried seq is no higher than the events it actually reflects.
- E3 The cache never acts as recovery authority (already true; the comment in `session-projection-cache/src/index.ts:6-9` is exactly this contract).

**EVENTS**

- V1 New `SessionEventMap` members must update the assembled expected output in the same batch, or use a seq-independent expectation format.
- V2 `ignorable` means precisely "a build that does not know this type may skip it without mis-reconstructing the session" — unrelated to "not occupying a seq".

**VERIFICATION**

- T1 Every A/D/E invariant has at least one adversarial negative test.
- T2 Snapshots prove stable output only; they are not invariant proofs.

## G. Detailed remediation plan / H. Roadmap

### Phase 0 — Baseline restoration

- **Objective**: make assembled evidence trustworthy again.
- **Components**: `examples/*/tests/**/expected/**`, `packages/test-support/acp-snapshot/src/suite.ts`, `packages/test-support/loader-smoke/src/index.ts`, `examples/headless-agent/tests/headless.snapshot.ts`, `packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts`.
- **Changes**: (a) add the attempt event to all 132 fixtures (via `test:snapshot:record`, but **review every diff** and confirm each difference is only the attempt event and seq displacement); (b) change `expect(result.stderr).toBe('')` to a match that tolerates known Node runtime warnings; (c) move the `session-sandbox-root` scenario's workspace parent directory to an in-workspace temp root, eliminating the EPERM.
- **Why**: with a red baseline, no remediation can distinguish new regressions from old drift.
- **Dependencies**: none.
- **Risks**: batch refresh may mask real regressions. **Mitigation**: per-diff review plus a per-file "difference category" list in the PR.
- **Tests**: `pnpm run test:snapshot` all green; `crash-recovery.e2e.ts` all green.
- **Exit criteria**: snapshots and e2e both green, and the review record proves all differences fall into the three known categories.
- **Rollback**: `git revert`; fixtures are pure data.
- **Complexity change**: − (removes a class of permanent noise).

### Phase 1 — Authority correctness

- **Objective**: eliminate RC-1 and RC-2.
- **Components**: `packages/core/tools/src/index.ts` (identity minting, grant consumption, single serviceAsk), `packages/guard/action-policy-guard/src/index.ts` (degrades into a decider), `packages/interaction/user-approval/src/index.ts` (issues grants), `packages/sandbox/sandbox-policy/src/index.ts` (mints authority), `packages/fs/fs/src/index.ts` + `packages/fs/fs-sandbox`, `packages/shell/shell/src/types.ts` + `bash-sandbox` + `pwsh-sandbox`, and every tool layer that passes policies.
- **Changes**: per E-1/E-2/E-3.
- **Why**: one root fix eliminates 6 measured failure modes (E1, E7, E9, E15, E16, E17, E24).
- **Dependencies**: Phase 0 (otherwise the snapshot impact of the changes cannot be read).
- **Risks**: the type changes have a wide blast radius; nested/Code Mode authorization semantics could be wrong.
- **Migration**: making `sandboxPolicy` required is a **compile-time** change; TypeScript enumerates every call site — exactly the application of the repo's "misconfiguration fails loud" principle.
- **Tests**: see the Phase-1 row of section J.
- **Exit criteria**: A1–A6 each have a passing negative test; the reproductions of E1/E7/E9/E15/E16/E17/E24 all flip green.
- **Rollback**: split by package into PRs; each is individually revertible.
- **Complexity change**: + three types, − one duplicated approval path ≈ net flat.

### Phase 2 — Durable recovery correctness

- **Objective**: eliminate the most dangerous branch of RC-3.
- **Components**: `packages/session/session-persistence-jsonl/src/format.ts` (the scan returns integrity), `packages/session/session-persistence/src/coordinator.ts` (propagates integrity, writes `session/repaired`), `packages/core/session/src/types.ts` (the new event), `known-event-types.ts` (generated).
- **Changes**: per E-4.
- **Why**: E27 proves current corruption is disguised as a normal interruption — a textbook "system is self-consistent but history is lost" case.
- **Dependencies**: Phase 0.
- **Risks**: a new event type triggers fixture drift again. **Mitigation**: merge with Phase 0's fixture fixes in the same batch, or adopt section J's seq-independent expectation format.
- **Tests**: four groups — mid-log corruption, torn tail, seq gap, open turn — each asserting `integrity` and `session/repaired`.
- **Exit criteria**: D1–D4 have negative tests; E13/E14/E27 behavior becomes "truncation + explicit marker".
- **Rollback**: `integrity` is a new optional field; the read side stays backward-compatible.
- **Complexity change**: small +.

### Phase 3 — Derived-state and resource semantics

- **Objective**: close the projection lost-update window; provide resource observability.
- **Components**: `packages/session/session-projection-cache/src/index.ts` (single-flight), `packages/session/session-telemetry/README.md` (document at-most-once), one new assembled-request-size observation point.
- **Changes**: per E-5, E-6; the prompt budget does only **observation + hard-cap rejection** (fail loud over the limit, no silent trimming).
- **Why**: E10 has a definite window; E30 quantified that a 1 MB request ships unhindered.
- **Dependencies**: none (can run in parallel with Phase 1/2).
- **Risks**: a hard cap set too low rejects legitimate long sessions. **Mitigation**: the cap is a Config field (AGENTS.md forbids hardcoded tunables), defaulting to a value clearly above real usage.
- **Exit criteria**: E1–E3 invariants have tests; the overlapping-flush experiment no longer loses updates.
- **Complexity change**: near zero (one promise chain).

### Phase 4 — Verification architecture

- **Objective**: turn the long-term-valuable parts of this round's 31 experiments into repo assets.
- **Components**: each package's `tests/`, plus one fault-injection helper under `packages/test-support`.
- **Changes**: see section J.
- **Exit criteria**: every MUST case in section J's matrix exists and runs in CI.

### Phase 5 — Hardening / observability / cleanup

- MCP description/schema bounds; `str_replace_editor` escalation alignment; `effects` enters the `docs/tool-catalog.md` generator; explicit withdrawal of ACP orphan permission requests; SDK malformed-frame counter.
- These are all **low-leverage** changes, done last.

## I. Alternatives and tradeoffs

### Authorization

| Option | complexity | runtime | migration | compatibility risk | reliability gain | Verdict |
|---|---|---|---|---|---|---|
| **A. Identity+Grant (recommended)** | medium: 3 types, 1 consumption point | one sha256 per execution | medium: type changes enumerable | low (same-process API) | high: eliminates 6 failure modes | **adopted** |
| B. keep callId, add args digest to the map key | low | low | low | low | partial: cross-session replay still possible, still not consumed | rejected: treats the symptom |
| C. cryptographically signed capability token | high: key management, clocks, serialization | one signature per call | high | medium | same as A | **rejected**: there is no forgery threat model inside a process boundary; in the [practice of capability-based security](https://raw.githubusercontent.com/OneUptime/blog/refs/heads/master/posts/2026-01-30-capability-based-security/README.md) signatures are used to pass authority **across trust boundaries** — here the registry and approval live in the same process and fiber tree, and a branded symbol is already unforgeable enough |

### Sandbox

| Option | Verdict and rationale |
|---|---|
| **A. Intersection + branded authority (recommended)** | three modes form a total order; min is the complete answer; the branded type makes "omission" impossible at compile time |
| B. Capability token per operation | overlaps E-1's grant responsibility and would produce two credential systems |
| C. Policy DSL / lattice | no partial-order need today, and no second policy dimension. **Explicitly rejected** |

### Log corruption

| Option | Verdict and rationale |
|---|---|
| **A. Truncate + integrity marker + repaired event (recommended)** | keeps availability while eliminating "disguised as normal"; consistent with the [common practice for append-only logs](https://github.com/grailbio/base/blob/master/logio/logio.go#L62) — stop at the corruption point and **report** it rather than silently continuing |
| B. Fail-hard | one bad byte destroys the whole session; unacceptable for an interactive product |
| C. Per-record checksum | stronger, but changes the on-disk format. **Deferred**: `SESSION_FORMAT_VERSION` is still 0 with no compatibility promise, so it remains possible later; A already solves the core "disguised" problem |
| D. Quarantine the corrupt file | needs a new storage location and lifecycle; A suffices |

### Derived state

| Option | Verdict |
|---|---|
| **A. Single-flight serialization (recommended)** | one promise chain closes all known windows |
| B. CAS / generation token | requires introducing compare-writes at the storage layer; gain equals A |
| C. Version vectors / distributed consensus | **explicitly rejected**: single process, single writer, no partitions |

### MCP effects

Keep the status quo (do not trust server declarations). This matches the consensus of the MCP ecosystem: [tool annotations are hints, not a security boundary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/), and [clients must not treat an untrusted server's hints as a basis for trust](https://4sysops.com/archives/mcp-tool-annotations-securing-mcp-servers-against-the-lethal-trifecta/). E28 proves the current implementation already does this. **What remains is only writing this fact into `docs/tool-catalog.md` and `mcp-client/README.md`**, so operators know MCP tools always fall on the "undeclared = requires approval" side (E29 verified).

## J. Verification architecture

| Layer | Proves what | Negative tests that must be added |
|---|---|---|
| unit | component behavior | grant invalidates after consumption; non-matching identity rejected; authority not caller-constructible (type level, via `@ts-expect-error`) |
| integration | cross-component contracts | **callId replay** (E1); **cross-tool replay**; **same callId after args change**; **listener ordering** (E16/E17 both directions); **sandbox authority override** (E7/E15) |
| adversarial | failure semantics | **cancellation** (E9); **late approval** (E23); **double approval** (E17); **MCP metadata deception** (E28); **malformed SDK traffic** (E25) |
| property/invariant | A/D/E invariants | at least one each; the `./invariant` companion checks the A1/A2 event relations |
| fault injection | recovery semantics | **JSONL corruption** four groups (E13/E14/E27); **telemetry first-delivery failure** (E3); **projection race** (E10) |
| restart/replay | cross-process | **kill -9** (reuse `crash-recovery.e2e.ts`'s failpoint mechanism, extended to between flush and put); **symlink cwd replacement** (E21/E22) |
| assembled | the shipped system | the ACP cancellation chain's teardown must quiesce (E24's counterexample) |
| snapshot | stable output | **not** used to prove invariants |
| CI matrix | platform | keep the Windows lane; crash-recovery skips on Windows must be explicitly recorded as a known gap |

**Fixture seq fragility**: expected output should record **relative references** (e.g. `sourceEventSeqs` as "N events before this one", or assertions over the event-type sequence), or the normalizer renumbers seq into a dense sequence. This item belongs to Phase 0/4 — it is the correct fix location for RC-4, **not** a change to the event model.

## K. Migration and compatibility strategy

- **schema/version**: `SESSION_FORMAT_VERSION` stays `0`. `session/repaired` is a new event; old builds refuse to load a log containing it — that is **correct** behavior (AGENTS.md: required-on-read by default), because losing the fact "history is incomplete" causes wrong reconstruction. It must **not** be marked `ignorable`.
- **existing sessions**: no per-record checksums → `integrity: 'unknown'`, no warnings.
- **old snapshots**: Phase 0 re-records them once.
- **plugins**: making `sandboxPolicy` required is a breaking change; the repo is pre-release and AGENTS.md states "prefer the correct foundation over compatibility shims", so **change it directly and update every reference**, no shim.
- **hooks / MCP / ACP / SDK**: wire formats unchanged. MCP only gains harness-side bounds.
- **feature flags**: **not needed**. Rationale: these are correctness fixes to same-process APIs, not optional behaviors; a flag would keep two paths coexisting long-term — exactly what caused E16/E17.
- **observe → enforce rollout**: **before Phase 1 completes and passes all of section J's MUST tests, changing the default to enforce is forbidden.** Current enforce is untrustworthy (E1/E16/E17/E24 all occurred in enforce mode); changing the default from observe to enforce would swap an honest "unfortified" for a dishonest "assumed fortified". Post-Phase-1 sequence: (1) stay on observe and watch `action-policy/candidate` event volume; (2) run enforce on a test deployment for one week; (3) change the default to enforce.
- **metrics / canary**: candidate event counts, approval outcome distribution, grant consumption failure counts (must always be 0), the proportion of sessions with `integrity != 'intact'`.

## L. Rollback strategy

- Phase 0: revert the fixture commit.
- Phase 1: split by package into PRs (tools → approval → guard → sandbox-policy → fs/shell → tool layers); any layer is independently revertible; the most dangerous one — the sandbox parameter becoming required — is its own PR.
- Phase 2: `integrity` is a new optional field; the read side ignoring it suffices to roll back; once written, `session/repaired` cannot be rolled back (durable), so that PR merges only after Phase 0 is green.
- Phase 3: single-flight is a purely internal change; revert directly.

## M. Risk-ranked implementation order

| # | Item | Severity | Likelihood | Blast radius | Evidence | Fix leverage | Cost | Regression risk | Arch value | Ranking rationale |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Phase 0 baseline restoration | medium | certain | all verification | L4 | high | low | low | the prerequisite for all remediation; without it nothing downstream is readable |
| 2 | single approval point + grant binding (E-1/E-3) | high | high | all side effects | L4 | **highest** (eliminates 6 failure modes) | medium | medium | root fix |
| 3 | sandbox authority minted by the owner (E-2) | high | medium | all of fs/shell | L3 | high | medium | medium | a second escalation path independent of 2 |
| 4 | log integrity marker (E-4) | high | medium | session history | L3 | high | medium | low | the only change that stops invariants being "blind to missingness" |
| 5 | projection single-flight (E-5) | medium | medium | derived state | L3 | medium | **very low** | very low | near-zero cost, do it on the way |
| 6 | verification system negative tests | medium | — | long-term | — | high | medium | none | prevents regressions of 1–5 |
| 7 | prompt budget observation + hard cap | medium | medium | requests | L3 | medium | low | low | capability gap, not a defect |
| 8 | telemetry limitations documented | low | — | perception | L3 | low | very low | none | eliminates misplaced trust |
| 9 | MCP bounds + effects into the catalog | medium | low | MCP deployments | L3 | medium | low | low | current state already safe; this adds visibility |
| 10 | `str_replace_editor` / SDK counters / ACP orphan withdrawal | low | low | local | L1–L3 | low | low | low | closing items |

## N. DO NOT BUILD / overengineering warnings

- **Do not** build distributed consensus, version vectors, or CRDTs. Single process, single writer, no partitions.
- **Do not** do a full event-sourcing rewrite. The current session log is already an event log; the problems are in authorization and integrity, not the storage paradigm.
- **Do not** build a durable telemetry queue / Kafka. Telemetry is explicitly best-effort observability (E-6).
- **Do not** add cryptographic signatures to authorization. Inside a process boundary a branded symbol is already unforgeable; signatures solve cross-process/network forgery, which does not exist here.
- **Do not** introduce a generic policy DSL. A min operation over three ordered modes is the complete requirement.
- **Do not** add a second guard layer. E16/E17 prove duplicate guard layers manufacture contradictions rather than defense in depth.
- **Do not** split the canonical seq into multiple sequences. RC-4's correct fix is in how fixtures record expectations, not in the event model.
- **Do not** add a compatibility shim for `sandboxPolicy`. Pre-release: change it directly and update every reference.
- **Do not** silently trim prompts. Trimming is compaction's job; the budget layer only observes and rejects.
- **Do not** introduce an MCP effects-trusting mechanism. E28 proves ignoring server declarations is **correct**; trusting them would be the new bug.

## O. Expected end-state

- Every side-effectful execution has an unforgeable, non-replayable, one-shot authorization, and the request/approval/execution trio is mutually verifiable in the log.
- Authority can only be narrowed by the policy owner or (after approval) widened; no caller gains more authority by "passing a wider value" or "passing nothing".
- Log corruption is always visible: recovered sessions are explicitly marked `intact` / `repaired` / `unknown`, and the model knows whether its history is complete.
- Derived state may be stale, but never loses updates and never becomes recovery authority.
- The event model is unchanged, but assembled expected output no longer drifts wholesale from new diagnostic events.
- Every invariant has a negative test that fails.

## P. Production-readiness acceptance criteria

1. `pnpm run test:snapshot`, `pnpm run test`, and `crash-recovery.e2e.ts` are all green, and no stderr oracle depends on the Node version.
2. A1–A6, D1–D4, E1–E3 each have at least one negative test, and each test actually fails when its fix is removed ("prove the test turns red").
3. E1, E7, E9, E10, E13, E14, E15, E16, E17, E21, E24, E27 all flip green.
4. enforce mode runs on a test deployment for one consecutive week with `grant consumption failure count == 0`.
5. Sessions with `integrity != 'intact'` are visible in the UI/SDK.
6. The default stays observe until 1–4 are all satisfied.

---

## If fully implemented: which risks are eliminated and which residual risks are accepted

### Genuinely eliminated

- Cross-tool / cross-session authorization replay (A1/A2 + args digest + one-shot consumption).
- Deny after approval / two asks per call (single approval point).
- Post-cancellation approval hanging and blocking turn and teardown (signal threaded through a single path).
- Callers self-selecting or omitting the sandbox policy to gain authority beyond the session (branded authority + required).
- Mid-log corruption disguised as a normal interruption (integrity + `session/repaired`).
- projection overlapping-flush lost updates (single-flight).
- New diagnostic events wholesale distorting assembled evidence (fixture recording method).

### Residual risks accepted on purpose (design tradeoffs; must be documented)

1. **telemetry first-delivery failure is permanent loss; no cross-process backfill.** Accepted: it is observability, not audit evidence. If audit-grade guarantees are needed later, use a separate durable channel.
2. **`workspace-write` always includes `/tmp` and platform temp directories** (E8/`sandbox/src/roots.ts:52-55`). Accepted: it aligns with the writable set Seatbelt grants; splitting it would drift the fs and shell writable sets. The threat model must state it explicitly: a constant cross-session shared channel.
3. **Unflushed events are lost in a hard crash** (E26). Accepted: per-event fsync cost is disproportionate to interactive latency; `session-checkpoint-policy` already forces flushes at the semantic checkpoints (before requests, before tool side effects) — the two points that need protection most.
4. **Historical sessions' integrity is forever `unknown`.** Accepted: checksums cannot be retroactively generated; honest labeling beats manufactured certainty.
5. **cwd restoration does no realpath identity check** (E21/E22). Accepted: users replacing a project directory with a symlink is a legitimate operation; enforced verification would break normal directory migrations. Mitigation: show the resolved workspaceRoot to the user at session restore, making the replacement visible.
6. **MCP tool schema and description get no semantic validation** (E28). Accepted: MCP's value is accepting unknown servers; the harness only guarantees they fall on the "requires approval" side (E29 verified) and adds length bounds.
7. **SDK malformed frames are silently dropped** (E25). Accepted: JSON-RPC permits ignoring unlinkable frames; add counters rather than disconnecting.
8. **The single-process single-writer assumption.** Accepted: it is today's deployment model. If multi-process writes to one session arrive later, this plan's single-flight must be upgraded to storage-layer CAS — but only then.

---

## Appendix: this round's experiment index

`.audit-tmp/` (untracked, safe to delete): 19 specs, 75 assertions, consistent across repeated runs.

E1/E2/E16/E17/E31 `policy-replay` · E18 `enforce-fleet` · E9 `approval-cancel` · **E23/E24 `acp-cancel`** · E3 `telemetry-fault` · E4/E5/E6 `compaction-reconstruct` · E7/E8/E22 `fs-authority` · E15 `shell-authority` · E10/E11/E12 `projection-race` · E13 `jsonl-corruption` · E14 `jsonl-e2e` · **E26/E27 `kill9`** · **E25 `sdk-wire-fault`** · **E28/E29 `mcp-deception`** · **E30 `prompt-budget`** · E19 `request-invariant` · E20 `subprocess-fault` · E21 `cwd-restore` (bold = added in round 4).

Also executed for real: `packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts` (real SIGKILL), `examples/headless-agent/tests/headless.snapshot.ts`, the `packages/guard/action-policy-guard` + `user-approval` + `session-telemetry` + `session-projection-cache` unit suites (122 tests, all green).
# Remediation Plan Design Review (Round 5: Independent Design Review)

Review date: 2026-08-24. Subject: the remediation plan itself from round 4's *Final Convergence Audit and System Remediation Plan*. Method: the lead review session re-checked the decisive conclusions against the code one by one (`core/tools`, `action-policy-guard`, `user-approval`, `sandbox-policy`, `session-persistence-jsonl`, `session-persistence`, `session-projection-cache`, `dsh-brand`, `hooks-*`, `acp-snapshot/normalize`, `mcp-client`), added runtime probes (late-allow races ×3), and had two isolated independent sub-reviews each deliver an adversarial review (one attacking the architecture design, one attacking the security boundary and migration/rollback). No production code was modified.

## A. Overall verdict

**APPROVE WITH CHANGES**

The direction stands: a single approval point, one-shot execution-attempt-bound grants, sandbox authority minted by the policy owner, explicit recovery-integrity state, projection single-flight, keeping the canonical seq — these correspond one-to-one with the proven failure modes, with no over-design. But implementation cannot start as-is; section L's changes must land first. The two independent sub-reviews agree with this lead review on three critical items: (1) the repair marker's truncate-then-append has a crash window that can recreate the E27 defect verbatim — it must become an atomic replacement; (2) the auditability of the authorization chain (A6) cannot be guaranteed by "consumption means safety" — it needs an execution-attempt state machine + terminal disposition + events carrying the operationId; (3) the TypeScript brand is not a runtime boundary against partially-trusted in-process plugins — the plan must either add a minimal runtime provenance check or openly admit "trusted to compile time".

## B. Root-cause model review

**ROOT-CAUSE MODEL ACCEPTED (with two refinements, not overturned)**

- RC-1 (authorization is a reusable string key, not an object) stands: the `Map<string,true>` keyed by the caller-provided `callId` in `action-policy-guard/src/index.ts:65,77` binds no tool/args/session/agent/scope and is never consumed. E1/E16/E17/E31 corroborate each other. This is a root cause, not a symptom — E31 proves the normal pipeline asks per call for duplicate callIds and only the short-circuit/reuse path punches through the fence, so the disease is in "key selection", not in any single listener.
- RC-2 (final sandbox authority computation sits with the caller) stands, and **is broader than the report stated**: besides the optional parameters of `ctx.fs.writeText(..., sandboxPolicy?)` (`fs/src/index.ts:227`) and `bash-sandbox.resolve` (`bash-sandbox/src/index.ts:84-90`), `SandboxPolicyRequest.mode` (the `resolve` implementation in `sandbox-policy/src/index.ts`) is itself an "unproven mode override" — `resolve({mode:'danger-full-access'})` needs no grant today. Unified statement: **both of the policy owner's entry points (the final policy parameter and the explicit mode override) accept caller-chosen values**.
- RC-3 (missingness/corruption modeled as a shorter legal state) stands: the JSONL scanner records corruption in a private `issue` field without exposing it (`format.ts:352-377`), `load()` synthesizes closers over it (E27), the telemetry cursor skips failed records (E3), and projection zeroes dirty after a lost update (E10). One shared cause.
- RC-4 (the canonical seq is an over-shared global resource) stands, but **the evidence must be corrected**: the lead review found `acp-snapshot/src/normalize.ts:22-24` already strips the top-level `seq`/`seq0`, so snapshot drift is NOT caused by "seq displacement" — it comes from: the new attempt-event rows themselves, event-sequence assertions in fixtures (like `crash-recovery.e2e.ts`'s `events.map(type).toEqual`), and absolute seq references embedded in data such as `sourceEventSeqs`. RC-4's mechanism description (ignorable events still occupy seq; consumers align by seq) still stands, but the claim of "132 fixtures all displaced by seq" is inaccurate — the fix therefore changes too (see G).
- Missed deeper root causes: the lead review and both sub-reviews each checked candidates such as "policy owner separated from enforcement" and "the event model has no explicit commit/cut"; the conclusion is that RC-2/RC-3 already cover them; no fifth root cause is introduced.

## C. Authorization design review

- **`ToolExecutionToken` is the right identity, but the plan must correct two descriptions of it.**
  1) `createExecutionToken()` is `Symbol('dsh.tool.execution')` (`core/tools/src/index.ts:1877-1878`). A Symbol description **does not guarantee uniqueness** (any code can mint another with the same description), and a symbol cannot be serialized. The plan's "the registry-private symbol is unforgeable" is wrong — what is actually unforgeable is **the monotonic counter in the registry closure + WeakMap membership checks**. Redesigned: `operationId = <module-private counter>` (serializable, auditable); the internal `token` stays an opaque handle; enforcement always goes through WeakMap/WeakSet membership checks.
  2) the token does not change through wrapping/forwarding (the registry mints a new token per `execute()`; Code Mode child dispatches carry the ancestor via `parent`), **but a forwarder calling `execute()` again mints a new token — that is the correct semantics (new execution, new authorization), and the plan should state it instead of avoiding it**.
- **args digest: KEEP, but demoted in role.** The lead review's experiment confirms arguments are `snapshotJsonValue` + `deepFreeze`d before the policy pipeline (`core/tools/src/index.ts:1402-1412`), so "arguments changed within one execution" cannot happen; binding the grant by frozen reference suffices against replay. But a frozen reference **cannot enter durable audit** (after reload the object no longer exists — "what was approved = what executed" cannot be proven). So the digest is not an authorization mechanism; it is the **A6 audit binding**: the only canonicalization risk of SHA-256 over `JSON.stringify` is property order, and the harness convention `snapshotJsonValue` preserves order (`detach` does not reorder); store the serialized length beside the digest for cross-checking; bigint/undefined already throw at materialization and never reach the digest. **No** canonical-JSON library needed.
- **Grant lifecycle — the honest answer to "is one-shot consumption enough" is: enough against replay, not enough for A6.** Item by item:
  - replay / duplicate consume / double execution: enough (atomic removal on consume + exact identity match).
  - retry: E31 proves each execute mints a new token and the pipeline re-asks — retries naturally re-authorize, consistent with the status quo; no "retry reuse" design needed.
  - timeout: none (executions have no approval timeout; a hanging answerer is closed by cancellation).
  - cancellation / late approval / concurrent decide: the core service is already correct (this round's experiments ×3: abort@10ms vs allow@50ms → result `cancelled` with exactly one `approval/decided{cancelled}` in the log; the reverse order likewise; no state pollution after abort). **The grant layer must only inherit that semantics, not reinvent it.** What really needs fixing is the guard path not passing `signal` (`action-policy-guard/src/index.ts:116-121`) — E24 proved it hangs the prompt and dispose.
  - approval after operation disposal: turn closure is a request precondition (`user-approval/src/index.ts:259-265`); the turn does not close before the execution settles, so after the signal fix this scenario is unreachable.
  - operation failure before body / partial body then retry: **this is the gap the plan does not cover**. Consuming the grant only guarantees "executes at most once", not "the audit can see the terminal state". Every execution attempt must maintain a terminal disposition: `executed` (normal or error `tool/result` both count) or `not-executed(reason)` (denied/cancelled/disposed), and when the body may have already produced side effects before failing, the authorization must not be auto-reused — a retry needs a new authorization (an idempotent-tool exception is a product decision, not a default).
- **allowed-once binding level: the execution attempt, not the tool call, not the side-effect operation.** Rationale: the tool call (callId) is proven reusable by E1/E31; the side-effect operation is model semantics whose internal idempotency/retry boundary the harness cannot observe. The attempt corresponds one-to-one with the registry-minted token — the only level with a factual boundary. The sub-review agrees.
- **parentToken: KEEP as provenance; forbid automatic authorization inheritance.** Today `parent` only marks Code Mode child dispatch (`core/tools/src/index.ts:341-346`). "Parent authorized → the subtree needs no ask" would extend authorization into unauthorized dimensions (children could use parameters outside the parent's scope) — a new escalation surface. If the product truly needs the subtree to skip the ask, a bounded inheritance (same root, same tool, same args-digest explicit renewal) must be designed separately — **DEFER this round**.
- **The minimal event change for audit correlation (A6)**: `operationId` is written into the four existing events `approval/asked`, `approval/decided`, `tool/call`, `tool/result` (the plan already proposed this, but it must be upgraded from "optional field" to a **required correlation field** on decided/tool-call/tool-result); invariant: each `allowed-once` decided must correspond to exactly one terminal `tool/result` carrying the same operationId (including `not-executed`). Then A6 stays verifiable after restart, and callId is display-only.

## D. Single approval point review

- `ToolRuntime.serviceAsk()` (`core/tools/src/index.ts:1700-1740`) as the only `approval.request()` call site is correct, and it already passes `signal` correctly and implements fail-closed (no approval service → deny, no agent → deny, `unavailable` → deny). The guard degrading into a pre-execute decider returning `{kind:'ask'}` suffices; E16/E17's contradictions disappear.
- **But the plan must specify the decision semantics — a waterfall is "first non-next() return wins", not a merge.** The recommended precise semantics (three layers):
  1. `tools/pre-execute` waterfall: **collecting** decision — every security-relevant listener must delegate (`next()`), each returns an `allow/ask/deny` suggestion; aggregation rule **deny > ask > allow** (deny carries the aggregated reason). This adds one "collect" requirement over "first returner wins" but removes registration order as a security property.
  2. `approval/request` waterfall: keep the status quo (first-claim-wins, with rogue returns normalized by the service; `user-approval/src/index.ts:304-343` already implements it). **ask fires only once** — invoked uniformly by the registry after collection.
  3. `tools.guard()` monotonic fence: runs as the **last layer** before grant consumption, deny-only, checking the exact grant/identity.
  - Ordering conclusion: deny (any source) > ask (once) > allow (no deny in the waterfall and the fence passes). Cancellation is the independent terminal state `cancelled`, settling immediately — not an ordinary deny.
  - If the waterfall is not to become collecting, the alternative is: keep first-wins but force the guard fence to be unconditional-prepend — **not recommended**, because prepend depends on registration order and E16 proves hook bridges naturally produce prepend listeners. Collect semantics is the only order-independent option.
- escalation and ask: the `sandbox_permissions` escalation request inside a tool body goes through the same `approval.request()`, but must carry the **specific dimension** (mode/root) it wants to escalate; decided records it, and the policy owner issues a bounded authority based on it (see section E) — today `SandboxPolicyRequest.mode` has no such proof.

## E. Sandbox Authority review

- **The formula itself is flawed and must become a bounded union:** in `deployment default ∩ session override ∩ tool requirement ∪ approved escalation`: "tool requirement" does not exist in the code (`SandboxPolicyRequest` has only session + mode; tools declare no requirement) — an input the plan invented, so **REMOVE that term** unless a trusted tool-owned request is defined first with full consumer tests. The unbounded `∪ approved escalation` lets one approval raise the mode above the deployment cap (today `resolve({mode})` is exactly that: the explicit mode wins unconditionally) — change to: **escalation must name the specific dimension and cap** (`approvedAuthority: {mode?: 'danger-full-access', roots?: [...], reason}`), `effective = meet(deploymentCeiling, sessionPolicy, escalation) ∩ deny-by-default for the other dimensions`; whether the deployment is a hard cap (i.e. forbidding danger-full-access) is a product decision, not a code decision — the default recommendation is a `maxMode` config field, keeping today's semantics by default (can escalate to danger). Session restriction must not be bypassable by approval: approval may only widen within the dimensions it explicitly requested; all other dimensions meet.
- **workspaceRoot is part of the authority, not just the mode.** `resolve` today returns root together with mode; the branded authority should encapsulate `{mode, workspaceRoot, sessionId}` wholesale and deep-freeze it; root must keep the semantics "the canonicalization of session.header.cwd" and show the resolved result at restore (carrying forward round 4's E21/E22 mitigation).
- **After dimensions expand, the total-order min fails: admit it and plan the evolution.** Today the three-valued mode is a total order (min semantics correct). When network/env/mount dimensions arrive later, min is no longer the right operator; the authority should evolve into a **per-dimension meet + deny-by-default** capability set rather than stacking a single mode field. The branded authority type conveniently keeps that evolution inside the type. **This round does not build the capability set** — that would be over-design.
- **The branded type is compile-time only: runtime forgery is feasible, so a minimal provenance check is required.** `dsh-brand` is a pure type tool (`packages/util/brand/src/index.ts`, `Branded<string>`, erased at runtime). A same-process plugin can construct `{mode:'danger-full-access', workspaceRoot:'/…'}` and pass it straight to `ctx.fs`. The plan's claim "C cannot choose the final mode" is a **false boundary**. Minimal fix: `SandboxPolicyService` records minted authorities in a WeakSet; each enforcing backend in fs/shell does one membership check at its entry (O(1), one `if`). This blocks construction forgery from B/C but not D (D can monkey-patch or use legitimate capabilities directly). At the same time, AGENTS.md's trust rule must be respected: typed same-process boundaries get no runtime validation for values the static interface requires — but authority is an **explicit security boundary**, in the same class as parser/wire/durable boundaries, so the membership check is boundary validation, not a patch on the type system. If there is no product need to defend against C, then delete the "C cannot choose the final mode" promise and state "plugins are trusted to compile time" — one or the other; this round executes the former.
- Final form of the revised formula:

```text
effective = { mode: meet(deploymentCeiling, sessionPolicy.mode, escalation?.mode ?? sessionPolicy.mode), workspaceRoot: session.header.cwd ?? deployment root }
```

where escalation takes effect only when `approval/decided` records the authorization of that dimension and the authority was minted by the owner; a direct `ctx.fs`/`ctx.shell` caller may only submit a **request** (what it wants), never an authority.

## F. Durable recovery review

- **Implementing "truncate + diagnostic event" verbatim would recreate E27. It must become an atomic replacement.** The sub-review's falsification argument stands, and the lead review's re-check confirms it: in the JSONL backend `commitRepair` is two steps (first `repair(truncateTo)` then `appendLines(closers)`, `session-persistence-jsonl/src/index.ts:436-450`); a crash between the two steps → the log ends at a clean boundary → the next load sees no torn tail → treated as a complete log with synthesized closers → "corruption disguised as a normal interrupted turn" reproduces verbatim. The lead review's original idea of "append-before-truncate" is **also rejected**: a marker appended at EOF sits after the torn tail, and truncating to tornStart deletes it too — the sub-review is right on this point.
- **Chosen design (after comparing A/B/C/D): A' = atomic replacement + persistent integrity metadata.**
  - JSONL backend: `commitRepair` changes to building the complete "legal prefix + recovered events + closers + session/repaired event" content → write a temp file → fsync → atomic `rename` → directory fsync. This is the standard repair practice for append-only logs (isomorphic to Redis AOF rewrite and WAL checkpoint: rebuild a legal snapshot after corruption and publish it atomically); no new storage abstraction needed.
  - `session/repaired` is an **independent diagnostic event** (recording cut, lostLines, reason), **not** merged into `interruptedTurnClosers` (an ordinary interrupted describes an open turn; corruption is a different matter; merging would keep the E27 defect).
  - the snapshot carries `integrity: 'intact' | 'repaired' | 'unknown'` (B as a read-side projection), but the **canonical lives inside the log/replacement transaction**; the projection is not authoritative.
  - reject fail-hard (D): one bad byte destroying the whole session is unacceptable.
  - reject sidecar (C): a multi-file consistency protocol + identity/version binding is more complex than the atomic-replacement gain.
  - **idempotency**: atomic replacement is naturally idempotent (repeated execution produces the same content); `session/repaired` is generated once per "this load detected unrepaired damage".
  - **semantics of intact**: without checksums, `intact = scan complete, no seq gap, no torn tail, no known corruption` (parse-consistent, not bit-perfect). Honest statement: silent in-line bit flips are undetectable; such logs can only be `unknown`, or per-record checksums must be introduced (DEFER until format evolution).
  - **should the read path mutate**: today `load()` already modifies the log through `commitRepair` (near `coordinator.ts:945`); the fix introduces no new mutation, only makes its commit atomic; load's read-only-ness is guaranteed by the `readFrom`/inspect paths.
  - **model-visible**: `session/repaired` is a durable diagnostic event that enters model history through the existing surface projection (the model needs to know "history is incomplete" — a task-relevant fact, not an implementation detail); no separate notice event.
- **Version compatibility: in the same PR as `session/repaired`, bump `SESSION_FORMAT_VERSION` from 0 to 1.** Per the version-mechanism comment in `types.ts` (new logs that old runtimes cannot process with complete semantics must be version-rejected) and AGENTS.md's pre-release stance; `ignorable: true` would let old builds silently reconstruct truncated history — explicitly against the fix's goal. Section L's "integrity is an optional field; read-side ignore can roll back" is **wrong** and must be rewritten (see H/I).

## G. Projection / resource review

- **single-flight is necessary but not sufficient.** Three sub-problems, all measured/statically confirmed:
  1. E10 overlapping writes: serialization closes it — correct.
  2. a permanently rejected promise chain: tail reset (the `.then` hangs on an already-settled chain; after failure the chain resets to resolved) — must be written into the implementation requirements (referencing `coordinator.serialize()`'s same "errors must not poison the chain" pattern).
  3. **dispose lifecycle race: single-flight does not close it; three supplementary requirements are needed.** Status-quo evidence: the `session/disposed` listener fire-and-forgets `flushSoft` then **synchronously** `markClean` + `dirty.delete` (`session-projection-cache/src/index.ts:234-238`) — on failure the retry bookkeeping is already erased; `write()` only checks `ctx.sessions.get(id)===session` before `flush`, and during the `flush` await the session may detach, after which it **unconditionally** `put`s (lines 147-161) — publishing a row of a retired lifecycle into the store. Fix: the per-session queue covers **all** write paths (timer, count, turn/end, detach, cold write-back, public `write()`); detach is enqueued as a queue task and awaited/drained; before `put`, re-check the session's lifecycle generation/identity (not in the registry, or generation mismatch → skip the put, let the authoritative snapshot from persistence retirement drain take over); dirty cleanup happens only after the task settles. Cancellation: `write()` takes no signal parameter — keep "write to the end or leave a retry budget on failure" (no mid-way cancellation). Memory: one promise per session, no leak surface.
- **Prompt budget: the report's "hard rejection" would deadlock against compaction's preconditions; it must become a layered design.**
  - The attack stands: if assembly hard-rejects an over-limit request while compaction needs one model request to compress history, an over-limit session can never self-heal (every request rejected, the compactor never gets its chance). E30's 1MB request proves no aggregate constraint exists.
  - Layered: ① **at ingest/sync time**, byte bounds for untrusted sources (MCP description/schema — this round's E28 proved a 500KB description flows to the model unbounded; that is an entry problem, not an aggregate problem); ② compaction runs inside a reserved allowance (the compaction request itself consumes budget); ③ the final assembly does provider-aware token estimation + byte cap and rejects **only when compaction can no longer reduce**, and the rejection message itself must be deliverable (not routed through the over-limit path recursively).
  - Abandon the "unified token budget": UTF-8 bytes cannot predict tokens; a unified budget would both kill legitimate requests and miss real ones. Three small constraints are cheaper and more honest than one big system.
  - **Recorded adoption deviation (PR-6 F2 remediation, option B)**: the "provider-aware token estimation" in ③ landed as a **provider-agnostic advisory fixed-density heuristic** (chars/4, no provider input participates in pricing). Rationale: the repo has no per-provider tokenizer data; inventing provider coefficients means fabricating unverified tunables; the byte cap (UTF-8, `maxRequestBytes`) is the normative hard enforcement, and `maxEstimateTokens` only triggers the opt-in heuristic early. Implementation, design, documentation, and tests are aligned to this contract.

## H. Event / fixture review

- canonical seq continues to include ignorable events: **agreed to keep** (seq is the carrier of references and gap detection; splitting would create a second reference system).
- But the planned "fix the normalizer" direction must be corrected: the normalizer **already** strips the top-level `seq`/`seq0` (`acp-snapshot/src/normalize.ts:22-24`). The real drift sources are new event rows, event-sequence assertions, and data-embedded seqs like `sourceEventSeqs`. Layered strategy:
  1. **volatile identifiers** (`seq`, `time`, `id`, `createdAt`): keep scrubbing (status quo).
  2. **data-embedded references** (`sourceEventSeqs`): the relation is real semantics, **do not scrub globally**; pin absolute seqs in dedicated unit tests (e.g. "a tool/result references its tool/call's seq"), and assert structure-level or accept re-recording for that field in assembled snapshots.
  3. **event sequences themselves**: fixture assertions change to type sequences + key adjacency relations; no absolute-seq pinning.
  4. absolute seq is pinned dead in exactly one place: the dedicated tool-result reference test.
- "Do SDK/replay consumers depend on absolute seq": the wire projection carries seq, but consumers consume event streams; absolute seq is not a public contract (pre-release, no external consumers) — not pinning it is right. The `SESSION_FORMAT_VERSION` bump (see F) is the real public-contract change.

## I. Migration / rollback review

- The dependency order stands overall, with three corrections (see M's PR sequence):
  - **Phase 0 must go first** (attempt events into fixtures + stderr oracle + EPERM root directory), otherwise no change is readable — agreed.
  - **Phase 1 splits into two PRs**: sandbox authority (resolve/escalate API + required-parameter migration) and the authorization grant (operationId + consumption + single approval point + guard signal) are independent with different call surfaces; merging them makes a giant diff. Sandbox first, then grant (sandbox is a pure API migration with a small risk surface; grant changes the execution state machine).
  - **Phase 2 is one atomic PR**: the `session/repaired` declaration + generated `known-event-types` + `SESSION_FORMAT_VERSION=1` + atomic-replacement commitRepair + coordinator propagating integrity + refusal tests + fixtures. Any split creates a "writer produced but reader/version undeclared" intermediate state (sub-review agrees).
  - **Test assets first**: rounds 3/4's E1/E7/E9/E13/E14/E16/E17/E21/E24/E27 are made permanent negative tests inside their fix PRs (red then green, landing in the same PR); no separate "all-red tests" PR — that conflicts with the repo's green gate.
- **rollback correction**: section L's "Phase 2 rollbackable; integrity is an optional field the read side ignores" **does not hold** — `session/repaired` is required-on-read; old builds refuse the whole log via `assertEventsSupported` (`coordinator.ts:1052-1065`). The rollback semantics is "version refusal", not "silent ignore": this matches AGENTS.md (no compatibility promise; explicit refusal beats silent misreading), but it must be written into the rollout docs: **after a new build repairs any session, rolling back to an old build refuses that session** (diagnosable, unrecoverable) — do not execute repairs inside a deployment window. The most dangerous rollback scenario (sub-review agrees): rolling back after a new build repaired a corrupt JSONL and persisted `session/repaired` — the old binary either refuses the session (if the version bump is chosen) or silently reconstructs truncated history (if ignorable is mistakenly chosen).
- `sandboxPolicy` becoming required: all in-repo call sites are already enumerated (tool-fs write/edit/apply-patch, tool-str-replace-editor, tool-bash, tool-pwsh, bash/pwsh-local, bash/pwsh-sandbox, terminal-bash, fs-sandbox forwarding; hook-protocol has no production call site). Compile-time enumeration only covers in-repo TS callers; `ctx.fs`/`ctx.shell` are public same-process APIs, and out-of-repo plugins cannot be enumerated — documentation + the WeakSet provenance check (section E) backstop it. This is a pre-release-permitted breaking change (AGENTS.md: a correct foundation beats shims), but the breaking notice must be written into that PR's README.
- Live-session deployment: all changes are in-process API/type/recovery paths; wire formats are unchanged (SDK) — deployment only needs a process restart, no persistent data migration. `SESSION_FORMAT_VERSION=1` is a refusal boundary, not a migrator.

## J. Security-boundary review

Stated by attacker class (the lead review and both sub-reviews agree):

| Attacker | Status quo | After the planned changes | Conclusion |
|---|---|---|---|
| A accidental misuse | type system | branded authority + required parameter | blocked (compile time) |
| B buggy TS plugin | type system + review | same + WeakSet membership check | blocked |
| C partially-trusted in-process plugin | review/compile discipline only; can construct a forged policy object and call `ctx.fs` directly (`dsh-brand` erases at runtime; `fs/src/index.ts:217-228` accepts the optional parameter) | WeakSet minting check (one O(1) membership test at each enforcing backend entry) | **with the check, construction forgery is blocked**; calls to trusted service paths are not. Honest boundary: blocks the "forged authority object" class |
| D malicious in-process plugin | none | none | **not blockable** (can monkey-patch or use legitimate capabilities directly). Needs process isolation or a syscall-level sandbox (the `native/` Landlock runner is the existing direction), **outside this plan's scope, and must not be implied-blocked by type-system language** |

- The statement that must be written into the plan: "The TypeScript brand is a compile-time tool; this Harness's runtime defenses against same-process plugins are the WeakSet minting check (C's construction forgery) and process-level sandboxing (D). There is no false boundary."
- branded symbol / private token / monkey patching / JS plugins: as section C states, tokens stop "guessing", membership checks stop "forging", and neither stops "holding or rewriting".
- Citation basis: the repo trust rule (AGENTS.md "Trust TypeScript at typed same-process boundaries…validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries") limits runtime validation to explicit boundaries; authority is an explicit security boundary, and the membership check does not violate that rule — it is exactly the boundary-class validation the rule admits.

## K. Overengineering review

Item by item, answer "delete it — which proven failure mode reappears":

| Abstraction | Verdict | Failure mode that reappears if deleted |
|---|---|---|
| OperationIdentity | **KEEP (simplify fields)** | E1 cross-tool replay, E16/E17 double approval, A6 audit chain break |
| AuthorizationGrant | **KEEP** | E1 authorization reuse |
| AuthorityContext / branded authority | **KEEP (narrow to mode+root+sessionId; drop "tool requirement")** | E7/E15 caller-chosen authority |
| parentToken | **KEEP as provenance; REMOVE automatic authorization inheritance** | Code Mode correlation; inheritance is an unproven new escalation surface |
| argsDigest | **KEEP as audit binding; not for replay prevention** | A6 unprovable across restarts |
| session/repaired event | **KEEP, but as part of the atomic-replacement transaction** | E27 corruption disguised as a normal interruption |
| three-valued integrity | **KEEP** | D1/D3 inexpressible |
| unified prompt budget | **REMOVE → source byte bounds + compaction reserve + terminal estimation rejection** | none (the unified budget solves no proven problem and creates a deadlock state) |
| fault-injection framework | **DEFER (as a test helper, not a runtime abstraction)** | none (vitest + the existing failpoint mechanism suffice) |

## L. Required changes before implementation

1. **L1 (critical)** JSONL `commitRepair` becomes atomic replacement (temp + fsync + rename + directory fsync); `session/repaired` publishes as an independent diagnostic event with the transaction; the three-valued `integrity` derives directly from the scan result (intact/unknown hold without checksums; repaired is marked only by the replacement transaction). The sub-review agrees.
2. **L2 (critical)** execution-attempt state machine: operationId written into asked/decided/tool-call/tool-result (required on decided and tool/result); each allowed-once must have exactly one terminal disposition (including not-executed); grant consumption and disposition writing are coupled. The guard's `approval.request` must pass `exec.signal` (fixes E24).
3. **L3 (high)** single approval point + collecting decision semantics: pre-execute collects (deny > ask > allow), asks once, the guard's monotonic fence runs before consumption. State explicitly that registration order is no longer a security property.
4. **L4 (high)** the sandbox formula drops "tool requirement"; escalation becomes per-dimension bounded (meet + deny-by-default); `SandboxPolicyRequest.mode`'s unproven override becomes proof-of-issuance-required; the authority is deep-frozen and includes root; fs/shell backend entries get the WeakSet minting check; the threat-model document is rewritten per J's table.
5. **L5 (high)** projection: single-flight covers all write paths + tail reset + detach enqueued and awaited + lifecycle re-check before put + dirty cleanup only after settle.
6. **L6 (high)** migration/rollback: `SESSION_FORMAT_VERSION` 0→1 in the same PR as `session/repaired`, the generated registry, refusal tests, and fixtures; rewrite section L (rollback = version refusal, not silent ignore); rollout docs state "after a repair, old builds cannot read that session".
7. **L7 (medium)** prompt budget becomes layered (source bounds + compaction reserve + terminal provider-aware estimation + deliverable rejection); MCP description/schema get bounds at sync. (Per the adoption deviation recorded in section G, the "provider-aware estimation" lands as an advisory provider-agnostic heuristic; the byte cap is the normative enforcement.)
8. **L8 (medium)** fixture strategy per section H's layers; no big normalizer rework.

## M. Recommended implementation / PR sequence

1. **PR-0** Baseline restoration: attempt events into fixtures, stderr oracle excludes known Node warnings, EPERM root directory moved into the workspace. Exit: `test:snapshot` all green.
2. **PR-1** Sandbox authority: resolve/escalate API split, deep-frozen authority + WeakSet minting check + required-parameter migration in fs/shell (all in-repo call sites). Tests first (red then green): E7/E15 made permanent; forged-object construction rejected by the membership check.
3. **PR-2** Authorization: operationId + grant consumption + state-machine disposition + guard signal + collecting pre-execute + single approval point. Tests first: E1/E16/E17/E24 + the three late-allow cases made permanent.
4. **PR-3 (atomic)** Durability: `session/repaired` + generated `known-event-types` + `SESSION_FORMAT_VERSION=1` + JSONL atomic replacement + coordinator propagating integrity + refusal tests + new fixtures. Tests first: E13/E14/E27 flip to "truncation + explicit repaired".
5. **PR-4** Projection single-flight + lifecycle race fixes. Tests first: E10 + dispose-mid-flush injection.
6. **PR-5** Verification assets: all 31 experiments landed as negative tests per the layered matrix.
7. **PR-6** prompt/MCP source bounds + telemetry limitations documented + effects catalog generation.

Dependencies: PR-0 → {PR-1, PR-2} (parallel) → PR-3 → {PR-4, PR-6}; PR-5 lands with or right after its fix PR. PR-3 is the only atomic PR.

## N. Design decisions that are still product decisions

1. Whether the deployment is a hard sandbox cap (whether escalation to danger-full-access is forbidden).
2. hooks' authority semantics (session-scoped vs trusted-host) — decides whether hook decisions join the deny/ask aggregation.
3. Whether C (partially-trusted plugins) enters the threat model — if not, delete the related promises and skip the WeakSet.
4. The model-visible form of `session/repaired` (raw event vs surface summary text).
5. The concrete byte-cap values for MCP description/schema.
6. Whether auto-retry of idempotent tools after failure skips the second approval.

## O. Residual risks after implementation

- Malicious in-process plugins (D): uncontrolled; needs process/system-level isolation; outside this plan; must be labeled honestly.
- In-line silent bit flips: undetectable without per-record checksums; labeled as a known limitation (future format evolution).
- `/tmp` and platform temp directories are the constant shared channel of workspace-write; stated in the threat model.
- Unflushed events lost in a hard crash (checkpoint-policy already covers the two critical points); no per-event fsync introduced.
- cwd symlink retargeting: keep path-based semantics; show the resolved result at restore (no forced realpath identity).
- Historical sessions' integrity is forever `unknown` (evidence cannot be retroactively generated).
- telemetry at-most-once (best-effort observability, not an audit ledger).
- SDK malformed frames silently dropped (JSON-RPC permits ignoring unlinkable frames; add counters).

## P. Final answer

**Yes — after section L's 8 requirements are implemented, this remediation plan is safe and mature enough to begin.**

Rationale: (1) all four root causes stand after this round's independent re-check (the two refinements do not change the root-cause structure), and there is no deeper cause that would overturn the design; (2) all three critical defects (non-atomic repair transaction, unverifiable A6, false brand boundary) are located to concrete mechanisms and files, and their fixes are convergent (atomic replacement, state machine, WeakSet) — no new systems introduced; (3) every new mechanism required (atomic replacement, collect aggregation, membership check, single-flight) has an isomorphic precedent in the repo (coordinator serialize, user-approval race semantics, repair closers, Landlock) — no external tech stack needed; (4) the overengineering list survived the "delete it — which failure mode reappears" interrogation one by one; only the unified prompt budget was deleted and the fault-injection framework deferred; every kept item is backed by a proven failure mode. Executing in the PR-0 → PR-3 sequence, each step has clear exit criteria and an honest rollback boundary (version refusal) — work can begin.

## Appendix: this round's review evidence index

- Runtime probes (`.audit-tmp/approval-late-race.spec.ts`, 3 cases all passed): abort@10ms/allow@50ms → `cancelled` + exactly one `approval/decided{cancelled}`; reverse order → `allowed-once`; no state pollution after abort.
- Static re-checks: `normalize.ts:22-24` (seq already scrubbed), two-step non-atomic `commitRepair` (`session-persistence-jsonl/src/index.ts:436-450`), `Branded` pure-type (`packages/util/brand/src/index.ts`), the `assertEventsSupported` refusal path (`coordinator.ts:1052-1065`), the unproven `SandboxPolicyRequest.mode` override, arguments frozen before the policy pipeline (`core/tools/src/index.ts:1402-1412`), all in-repo sandboxPolicy call sites (tool-fs/tool-str-replace-editor/tool-bash/tool-pwsh/*-local/*-sandbox/terminal-bash; hook-protocol has no production call site).
- Independent sub-reviews ×2 (architecture-design attack; security-boundary and migration-rollback attack), each agreeing with the lead review on L1/L2/L4; the sub-reviews' key falsifications (append-before-truncate ineffective, the A6 double gap, C-class forgery feasible) are absorbed into this review.
