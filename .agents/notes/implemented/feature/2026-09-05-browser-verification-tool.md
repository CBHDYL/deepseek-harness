# Agent Note: Browser verification tool with four-class outcome taxonomy

Status: implemented

English | [中文](2026-09-05-browser-verification-tool.zh.md)

## Problem

The plan's browser-verification step needed a smoke-level Web verification capability, but the fork-era `tool-browser` package was deleted in the baseline sanitation (c2f62f965) and its contract could not be restored wholesale: the pre-hardening version navigated raw URLs (fixed `file://` read) and wrote unsanitized screenshot paths (path traversal).

## Decision

Rebuild the capability as the opt-in plugin `packages/web/tool-browser` with the historical contract as reference only. Frozen contract: actions `goto`/`read_text`/`click`/`fill`/`screenshot`/`close`/`list` (`click`/`fill` shipped with the usability workstream on explicit user requirement; `goto` takes an optional viewport); every result carries exactly one of `PASS`/`PRODUCT_FAILURE`/`INFRA_FAILURE`/`POLICY_FAILURE`; policy denials are structured results, never thrown tool errors, and `POLICY_FAILURE` is never a product failure. `click`/`fill` define no product expectation, so a missing selector is `INFRA_FAILURE` — only `expect_text` can produce `PRODUCT_FAILURE`. Screenshots land in the bounded directory and, when the optional attachment service is mounted, also register as durable content-addressed attachment references. Security lessons are invariants: http(s)-only targets including the final post-redirect URL, credential rejection, single-file-name screenshot confinement inside a bounded directory, and session-owned lifecycle (page and browser close on session disposal, plugin unload, `close`, or a policy-denied final target). The manager's launcher and executable resolver are constructor seams so every failure path has browser-free coverage; the real-Chromium smoke suite runs against a local fixture server and self-skips without a browser.

## Alternatives considered

- **Restore the historical package** — fastest, but it reintroduces fork residue, its click/fill surface, and a pre-hardening contract; the security fixes would have to be re-applied blindly.
- **Full Playwright capability seam** (Service Definition + provider + consumer) — correct for a multi-provider browser platform, over-built for one headless-Chromium verifier with no second provider in sight.

## Consequences

- The tool is opt-in: no shipped preset composes it, so non-browser sessions are untouched and no canonical recorded-session scenario can show it; the snapshot scenario lands with the change that first enables the plugin in a shipped preset.
- Every classified result is durable evidence: one `browser/verify` event per attempt (compact record, never page text) and a `browserVerify` projection folding the latest record of the current turn; consumers read the session log/projection — no evidence store, no judge.
- Screenshot attachments ride the existing attachment seam (`ctx.attachments`, optional): the durable ref is caller-consumable and UI-loadable via the existing session-authorized image path; without the service, screenshots stay bounded files.
- Full evidence-chain integration stays deferred to later steps; no evidence store, judge, or repair authority exists.
- Coverage stays green on hosts without Chromium because all failure branches run over stubbed seams; `v8 ignore` comments cover only race-only or defensive branches, each with a stated reason.
