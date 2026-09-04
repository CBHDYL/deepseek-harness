# Agent Note: P-BUDGET port (provider byte ceiling, summarizer allowance, MCP source bounds)

Status: implemented

English | [中文](2026-09-03-p-budget-port.zh.md)

## Problem

The candidate had no normative bound on what reaches a provider: the LLM runtime dispatched any assembled envelope, the summarizer replayed arbitrary replayed regions, and the MCP bridge registered every server-listed tool with unbounded metadata and unbounded pagination. The verified PR6 invariants — exact UTF-8 byte ceiling before provider dispatch, an independent summarizer allowance, and bounded MCP metadata — were absent.

## Decision

Ported the invariants onto the candidate's own seams, reusing its existing structures:

- **Final request byte ceiling** — `LlmRuntime.streamWithRegistration` measures the exact model-facing envelope (`messages` + rendered `system` + tool schemas) with `measureRequestBytes` (`TextEncoder` over the JSON envelope, never `string.length`) and refuses with `PromptBudgetError` (`PROMPT_BUDGET_EXCEEDED`) before any waterfall listener or adapter dispatch. The ceiling is the fixed 4 MiB product constant; the token estimate stays advisory and provider-agnostic (no estimate ceiling re-introduced).
- **Summarizer independent allowance** — `summarizeWithLlm` carries its own hard allowance (`summarizationMaxBytes`, default 8 MiB, config/policy/override plumbing like the other summarization fields) and refuses with `COMPACTION_BUDGET_EXCEEDED` before `ctx.llm.stream`, so recovery can never re-dispatch an unbounded auxiliary request.
- **MCP source bounds** — per-tool description (4096) and serialized schema (64 KiB) UTF-8 ceilings exclude the offending tool while keeping siblings, plus `maxSyncPages` (50), `maxToolsPerServer` (2000), and `syncTimeoutMs` (30s) caps that bound aggregate amplification. MCP metadata stays catalog-only; no effects authority exists on this candidate, and the P-AUTHZ pipeline never consults it.
- **Bounded recovery** — the candidate's overflow-recovery flow already satisfied the invariant (`agent/request-error` listener, `maxOverflowRetries` default 1, per-agent counters reset on assistant/message and idle, fail-loud after the bound); preserved unchanged and pinned with a terminal-state test.

## Consequences

- New permanent suites: runtime byte boundary (ASCII exact, multibyte emoji, oversized tools, pre-dispatch refusal), summarizer allowance boundary (binary-searched exact byte edge) and refusal code, MCP exclusion/boundary/count/page caps, and a persistent-overflow terminal-state loop test.
- Counterfactuals RED and md5-restored: A (runtime check off) breaks four budget tests; B (summarizer check off) breaks two; C (recovery bound off) breaks the terminal-state test; D (MCP bounds off) breaks the exclusion tests.
- `PromptBudgetError`/`measureRequestBytes` are exported from the LLM package; the cordis API catalog stayed byte-current (no public service method changed).

## Alternatives considered

- A provider-aware byte accounting of the final HTTP body: rejected — the harness's normative seam is the model-facing envelope; adapters may add transport framing that is not content, and the envelope bound is what the verified reference prices.
- Truncating oversized MCP metadata in place: rejected — silent mutation of untrusted content; exclusion keeps siblings and logs the count.
- Re-introducing an advisory token-estimate ceiling: rejected — the verified semantics keep estimates advisory; only the byte ceiling is normative.
