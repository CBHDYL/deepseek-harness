---
description: "The model-facing browser tool for smoke-level Web verification: how deployments enable, configure, and observe the per-session headless-Chromium page verification the model drives."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

With `dsh-tool-browser`, the model drives one headless Chromium page per agent session for smoke-level Web verification and interaction through the `browser` tool: `goto` a page (optionally with a viewport and asserting visible text), `read_text` (bounded), `click`, `fill`, `screenshot` into a confined directory (also registered as a durable attachment when the attachment service is mounted), `close`, and `list`. Every result carries exactly one outcome class — `PASS`, `PRODUCT_FAILURE`, `INFRA_FAILURE`, `POLICY_FAILURE` — so consumers can tell the product failing from the browser failing from a policy denial. The plugin is opt-in: no shipped preset enables it, and the session owns its page (closed on session disposal or plugin unload).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Choose this package when the model should verify a Web UI at smoke level: load a page and check visible text or capture a screenshot. It is not a general browser-automation platform, a judge, or a repair authority — it only produces verification evidence.

### Minimal configuration

Load the tool runtime and this package; a headless Chromium is resolved at first use from `DSH_BROWSER_EXECUTABLE`, the Playwright caches, or system browsers.

```yaml
- name: '@deepseek-ai/dsh-tool-browser'
```

| Field | Default | Meaning |
|---|---|---|
| `screenshotDir` | OS temp dir `dsh-browser` | Bounded screenshot output directory (created `0o700`) |
| `gotoTimeoutMs` | `30000` | `goto` navigation timeout |
| `actionTimeoutMs` | `10000` | Screenshot/read operation timeout |
| `maxTextChars` | `8000` | Cap on visible text returned by one call |

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/index.ts` owns the tool schema, the four-class outcome classification, and the opt-in plugin wiring. `click`/`fill` are browser-level operations: a missing selector is INFRA_FAILURE, never PRODUCT_FAILURE (only `expect_text` defines a product expectation). Screenshots register through `ctx.attachments` when mounted. `src/manager.ts` owns the per-session lazy Chromium lifecycle (one page per session, closure on session disposal, plugin unload, `close`, or a policy-denied final target). `src/policy.ts` owns the deterministic policy: http(s)-only targets including the final post-redirect URL, credential rejection, single-file-name screenshot confinement, navigation-error classification, executable resolution, and cooperative deadlines. Security denials are structured `POLICY_FAILURE` results, never thrown tool errors, and never product failures.

Every classified result is also durable evidence: the tool appends one `browser/verify` event (action, outcome, url, title, truncation metadata, screenshot path, reason — never page text) to the owning session, and the `browserVerify` projection folds the latest record of the current turn. Consumers read the session log or the projection; there is no evidence store and no judge.

No `./invariant` companion is published: the package owns no relation whose independent observations can diverge; the projection registration's disposal contract is proven by the HMR-safety test in `tests/projection.spec.ts` instead.

<a id="model-experience"></a>
## Model Experience

### Successful goto / read_text

#### What the model sees

`goto` renders `PASS — loaded "<title>" at <url>` plus the bounded visible text when `expect_text` was given. `read_text` renders `PASS` plus the bounded text (a `truncated`/`text_length` pair reports the cap). `screenshot` renders the saved path; `close` renders `PASS — page closed`; `list` renders the page URL or `no live page`.

#### Token effect

Visible text is bounded by `maxTextChars`; only the returned result adds tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Verification and policy outcomes

#### What the model sees

`PRODUCT_FAILURE: expected text "<text>" not found on the page` (with the bounded page text as evidence). `INFRA_FAILURE: <reason>` covers launch failures, timeouts, and transport errors. `POLICY_FAILURE: <reason>` covers disallowed schemes, credentials, unsafe redirects, and unsafe screenshot names.

#### Token effect

Only the returned result adds tokens; policy denials never attach page content.

#### KV Cache effect

Append-only; the failure follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument and caller errors

#### What the model sees

An agent-less call fails with `Error: browser: the tool requires an agent session to own the page lifecycle`; `goto` without `url` and empty `expect_text` fail as argument errors before any browser use.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is incomplete or needs deployment cooperation. They are current package constraints.

- **Screenshot attachments are optional** — the durable attachment reference appears only when a deployment mounts the attachment service (`ctx.attachments`); without it, screenshots remain bounded files only.
- **No snapshot scenario yet** — the plugin is opt-in and composes no shipped preset, so no canonical recorded session can show it; the snapshot scenario lands with the change that first enables it in a shipped preset.
- **`POLICY_FAILURE` after a completed navigation can only close the page** — a redirect into a disallowed scheme is detected after navigation; the page is closed and its content never returned, but the browser did load it once.
- **No evidence-store integration** — screenshots are bounded files only; the evidence-chain integration is the next plan step.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

The launcher and executable-resolver seams on `BrowserManager` exist for browser-free failure-path coverage; treat them as module seams, not runtime configuration. The `v8 ignore` comments cover only race-only or defensive branches, each with a stated reason.
</details>
