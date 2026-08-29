# @deepseek-ai/dsh-escalation-hider

English | [中文](README.zh.md)

A guard plugin that removes sandbox-escalation parameters from the
model-visible tool schema when escalation cannot succeed for the session. It
is not a model-facing tool and never touches execution semantics: the tool
registry validates only advertised keys, so a model that emits the fields
anyway still fails exactly as before (fail-closed).

## Why

`bash`/`pwsh` advertise `sandbox_permissions` and `justification` whenever a
confining executor is mounted — without knowing the session's per-session
sandbox mode or approval policy. An agent running at `danger-full-access`
under `never` is therefore shown an escalation knob that can never succeed,
and the observed failure mode is the model hammering it: 35 consecutive calls
all failing with `sandbox escalation to "danger-full-access" is not strictly
wider than this call's current "danger-full-access" mode`.

## What it does

At `system-prompt/assemble` time, when the calling session's effective mode is
at or above `hideAtOrAboveMode` (default `danger-full-access`), or its
approval policy is `never` (default hidden), the guard strips
`sandbox_permissions`/`justification` from every tool whose name matches the
`tools` wildcard patterns (default `['bash', 'pwsh']`). Tools outside the
patterns, and tools without the parameters, pass through untouched.

## Config

```yaml
- id: escalation-hider
  name: '@deepseek-ai/dsh-escalation-hider'
  config:
    hideAtOrAboveMode: danger-full-access
    hideWhenApprovalNever: true
    tools: [bash, pwsh]
```

Misconfiguration fails loud at plugin load.
