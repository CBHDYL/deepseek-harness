# @deepseek-ai/dsh-escalation-hider

English | [中文](README.zh.md)

A guard plugin that removes sandbox-escalation parameters from the model-visible tool schema when escalation cannot succeed for the session. It is not a model-facing tool and never touches execution semantics: the tool registry validates only advertised keys, so a model that emits the fields anyway still fails exactly as before (fail-closed).

## Why

`bash`/`pwsh` advertise `sandbox_permissions` and `justification` whenever a confining executor is mounted — without knowing the session's per-session sandbox mode or approval policy. An agent running at `danger-full-access` under `never` is therefore shown an escalation knob that can never succeed, and the observed failure mode is the model hammering it: 35 consecutive calls all failing with `sandbox escalation to "danger-full-access" is not strictly wider than this call's current "danger-full-access" mode`.

## What it does

At `system-prompt/assemble` time, when the calling session's effective mode is at or above `hideAtOrAboveMode` (default `danger-full-access`), or its approval policy is `never` (default hidden), the guard strips `sandbox_permissions`/`justification` from every tool whose name matches the `tools` wildcard patterns (default `['bash', 'pwsh', 'edit', 'write']`). Tools outside the patterns, and tools without the parameters, pass through untouched.

## Config

```yaml
- id: escalation-hider
  name: '@deepseek-ai/dsh-escalation-hider'
  config:
    hideAtOrAboveMode: danger-full-access
    hideWhenApprovalNever: true
    tools: [bash, pwsh, edit, write]
```

Misconfiguration fails loud at plugin load.

## Model Experience

### Hidden escalation fields

#### What the model sees

When the session's effective sandbox mode is at or above `hideAtOrAboveMode`, or its approval policy is `never`, `sandbox_permissions`/`justification` are absent from the schemas of matching tools. No other text changes; denial and escalation guidance still come from the tools themselves.

#### Token effect

The removed parameters slightly shrink the assembled schema; no per-call error text is added.

#### KV Cache effect

The schema prefix changes only when the session's mode or policy crosses the hiding threshold, which invalidates cache entries that reused the previous schema prefix.

## Known Limitations and Deferred Work

- **Schema hiding is cosmetic, not enforcement** — a model that emits the fields anyway still reaches the tool's fail-closed execution path; execution remains the authoritative boundary. - **Pattern-based tool matching** — only names matching the `tools` wildcard patterns are stripped; a future escalation-capable tool family must be added to the default list. - **Hiding follows standing policy, not the resolved call** — the decision uses the session's mode and approval policy at assembly time, not the per-call policy the tool later resolves.
