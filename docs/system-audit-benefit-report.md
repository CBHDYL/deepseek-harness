# DSH System Audit and Benefit Evaluation (2026-08)

English | [中文](system-audit-benefit-report.zh.md)

Baseline: tag `dsh-v0.1.1-rc.2`; branch `dsh-core-stopgap`. Method: 8 parallel domain audits (core-runtime / providers-llm / tools-shell-sandbox / persistence-jobs-workflow / host-client-web / governance-skills / test-ci-dev / bundles-boot) plus session-log forensics (including the packed-rows corrected version). Principle: benefit first; not breaking functionality is not a hard constraint.

## 1. System understanding (overview)

- **Runtime**: Cordis plugin tree; profile = ordered bundle stacking (base/web-app/headless); no privileged core, everything replaceable. Events split into three domains: session events (durable facts), agent events (in-flight interception), capability events (seams). Waterfall events (agent/pre-step, agent/request, llm/stream, tools/pre-execute/execute/post-execute, system-prompt/assemble, approval/request) delegate through next(). - **Session**: the append-only event log is the single source of truth; model-visible means logged (runtime invariant). JSONL persistence packs consecutive assistant/chunk deltas into lossless packed rows (text/reasoning/tool-call-chunks). - **Tool pipeline**: pre-execute (policy/veto) → monotonic guards → execute → post-execute (replace/enrich context) → tools/result; calls submit in model order, exclusive calls form a barrier. - **Seams** (~50 ctx.* services): sessionPersistence, storage, shell, subprocess, sandbox, fs, terminals, jobs, workflowEngine, subagents, llm, skills, goals, approval, settings, credentials, sessionProjections, typertGateway, etc. - **Governance**: approval fail-closed one-shot grants; plan-mode advisory only, not enforced; hook bridges external policy into waterfalls; goals have CAS and round limits; skills have layering and invocation policy.

## 2. Forensics corrections (important)

- After expanding packed rows: streaming delta text and the final assistant/message match **byte for byte** (SHA-256 8e52c8d3…, 11 occurrences of the title each). The duplication already existed in the vendor-delivered stream, ruling out BlockAssembler/finalization. output-repetition-guard sits on agent/stream-chunk before persistence — the placement is correct. - Incidental finding: packed rows hide the real events from log-based diagnostic tools (grep/session-query/unexpanded reads) — the first forensics pass therefore reached a wrong conclusion. This is a real weakness in the diagnostic toolchain.

## 2.5 Implementation status (as of 2026-08, branch dsh-core-stopgap)

The following P0 items are implemented and verified (red test → green, build:lib passes, oxlint 0 errors):

| P0 item | Commits |
|---|---|
| Repeat-call circuit breaker + failure chain (repeat-tool-reminder vetoAt/failure fingerprint) | dbfb10b88, eb7486e5f |
| Invalid escalation parameter hiding (escalation-hider) | dbfb10b88 |
| Output repetition detection + liveliness abort (output-repetition-guard) | dbfb10b88, 82e686e96 |
| Stream termination syntax enforcement (EOF without finish is a structured error) | 82e686e96 |
| Packed-rows log forensics tool (scripts/expand-session-log.mjs) | 82e686e96 |
| Stop-hook continuation budget (stopContinuationLimit) | 4f78e37f2 |
| Deployment-level goal round ceiling (maxGoalRoundsCeiling) | 4f78e37f2 |
| SSRF protection (web-fetch-http private-network blocking) | 6392a4cb8 |
| Transactional step admission (prepared failure restores claimed input) | 2b8dc1ce4 |
| Patch contract assertion (patch require) | 018097fd7 |
| Tool call/result closure contract (TOOL_OUTCOME_UNKNOWN) | 71a046b3e |
| Request attempt ledger + core retry budget | 4ff49dfc7 |
| Bounded MCP discovery (cursor/page/tool count/timeout) | ed90413e6 |
| Bounded FrameQueue (drop-oldest + counting) | 581c24ec8 |
| Projection cache retry transactionalization (dirtyStats observation) | 6d8ba8fca |
| Typed patch operations ($merge/$unset) | 06135d51e |
| Durable orchestration log (job/start + job/end in session) | dd9b78740 |
| Central mandatory action-policy interceptor (action-policy-guard) | 51dfa5808 |
| Cursor continuation (mux since incremental replay, host side) | fb768e955 |

## 3. Benefit-ranked action list

### P0 (highest benefit, do first)

| Item | Domain | Benefit |
|---|---|---|
| Enforce LLM stream termination syntax (EOF without finish is a protocol error) | llm | Prevents half output being committed as success |
| Transactional step admission (claimed messages retained/restored on assembly failure) | core | Eliminates the highest-impact user-work loss path |
| Central mandatory action-policy interceptor (approval/sandbox covering all side-effectful tools) | governance | Closes the "tools voluntarily call approval" gap |
| Tool call/result closure contract (step/end requires a result or explicit UNKNOWN) | core | Unambiguous logs, reliable continuation/repair |
| Lively output repetition interception (abort on repetition evidence, keep one canonical copy) | host/guard | Cures the recurring duplicate-output incidents |
| SSRF-safe web transport (block loopback/private/metadata/rebinding) | shell | Removes the highest-severity remote attack surface |
| Durable orchestration log (job/workflow lifecycle in session events) | persistence | Crash-recoverable and auditable after the fact |
| Projection cache retry transactionalization (clear dirty state after success) | persistence | Eliminates silently stale checkpoints |
| Strict stream readiness + cursor continuation (session/subscribed since) | host | Eliminates stale UI, incremental replay |
| Bounded queues/flow control (host frameQueue / inbox / liveBuffer) | host | Prevents memory loss on high-throughput streams |
| Stop-hook hard budget + real stop_hook_active | governance | Prevents unbounded Stop-hook loops |
| Deployment-level goal budget (hard cap + token/time/tool budgets) | governance | Prevents runaway autonomous runs |
| Patch contract with required target assertions | bundles | Upgrades/overlays no longer fail silently |
| Typed structural patch operations (merge/set/delete instead of whole-line replace) | bundles | New safety fields no longer erased by old overlays |
| Runtime stream protocol validator (single finish, no post-finish, block lifecycle) | llm | All adapters safe for direct consumers |
| Fail-safe incremental usage (partial failed streams retain billed usage) | llm | Usage stays undistorted |
| Durable pricing/cost ledger | llm | Historical spending reproducible |
| Bounded MCP discovery (cursor dedup, timeout, cancellation) | llm | Prevents bad servers from infinite paging |
| Make the repeat chain truly continuous (success/user intervention resets the failure chain) | guard | Prevents false circuit breaks (fixed this round) |

### P1 (medium-high benefit)

- First-class request attempts (retry durable identity + core budget) - post-execute limit on the failure-fingerprint chain (cannot pre-block failing calls with different args) - Conservative thresholds and explicit result markers for output-repetition enforce mode - escalation-hider switches to the authoritative service (sandboxPolicy.resolve + effective approval policy) - Sandbox beyond file effects (containers/microVM/remote execution + network policy) - Security policy becomes a bundle requirement (timeout/observation/sandbox internalized) - Incremental JSONL indexing/segmented logs (readFrom/query refresh O(tail)) - Default growth domains migrate to SQLite (projection cache etc.) - Durable indexed jobs provider - Provider-aware token calibration - Service-grade user-question timeout/cancellation races - plan-mode real read-only tool profile - Trusted skill source policy (project skills opt-in) - Key replays/scripts keyed by explicit identity - Native Windows becomes a required PR channel / macOS has CI signal - GUI coverage replaced with browser-level - Strict assistant folding invariant (reject deltas after block-end) - Stream integrity metadata (per-step chunk count/bytes/hash/termination reason) - Patch contract: missing target fails instead of warning

### P2 (later)

- Durable file observation cache; transactionalized schedule outbox; spill retention policy - Unified operational telemetry; content-addressed preset generations; versioned profile schema - Split the monolith web roster into capability bundles; key replay scripts keyed by identity - Change-aware pre-push checks

## 4. Key weaknesses found by the audit (for decision reference)

- plan-mode is advice, not a security boundary; approval 'never' only blocks calls that voluntarily request approval - Codex Stop hook can continue unboundedly; hook config failures degrade silently - Project-level skills have no trust tiers and can be shadowed by untrusted repository instructions - goal round limit defaults to 256 and the model can set it itself (tool description allows intent inference) - Invalid settings hot-reload segments silently keep old values; config drift is invisible - Preset generations leak watchers/resources; reload does not reclaim them - patch whole-line replacement + missing target only warns → silent upgrade failure risk - macOS/Windows native CI missing; GUI coverage exempted - web server allows 0.0.0.0 with no TLS/auth - web fetch has no SSRF protection - Sandbox constrains only file effects, not network/process visibility - Dead tools stay registered during MCP disconnect/reconnect - JSON storage global write amplification; JSONL read amplification - job/workflow state is memory-only; lost on crash - packed rows invisible to diagnostic tools (hit by this forensics pass)
