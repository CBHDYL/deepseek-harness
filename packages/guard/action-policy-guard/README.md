# @deepseek-ai/dsh-action-policy-guard

English | [中文](README.zh.md)

A central mandatory action-policy interceptor. Approval/sandbox governance only covers calls that OPT IN by requesting approval inside the tool body; a tool that performs a sensitive action without requesting approval bypasses the policy entirely. This guard moves the decision to `tools/pre-execute`: tools whose declared `effects` is not `read-only` (undeclared tools count as side-effectful by default) are gated through the approval seam for every call.

`observe` mode (default) logs ungoverned calls without changing behavior; `enforce` mode denies any side-effectful call whose approval is not granted once (fail-closed when no approval service is composed).

## Durable observation

In `observe` mode, each side-effectful candidate appends a log-only `action-policy/candidate` session event whose payload is exactly `{ toolName, callId, effectSource }` — no arguments, commands, paths, justifications, or credentials, so the census never duplicates tool input or secrets in the durable log. `effectSource` is `declared` when the tool declares `effects: 'side-effectful'`, or `undeclared` when the guard's `treatUndeclaredAsSideEffectful` classification caught it. Read-only tools append nothing, and `enforce` mode never appends this event. The event is marked `ignorable: true` so older readers can skip it when they do not know the type.

## Config

```yaml
- id: action-policy-guard
  name: '@deepseek-ai/dsh-action-policy-guard'
  config:
    mode: observe                    # observe | enforce
    treatUndeclaredAsSideEffectful: true
```

## Tool declaration

```ts ignore-check
ctx.tools.register(defineTool({
  name: 'send-email',
  description: 'Send an email',
  parameters: { to: { type: 'string' } },
  output: { schema: { type: 'string' }, render: () => [] },
  effects: 'side-effectful',        // or 'read-only'
  execute: async () => 'sent',
}))
```

## Model Experience

### Denied side-effectful call (enforce mode)

#### What the model sees

In `enforce` mode a side-effectful call without a granted approval fails with one of the deny texts below and the tool body never runs. `observe` mode adds nothing model-visible.

##### Deny texts

```markdown
action-policy: tool "<name>" is side-effectful but no approval service is composed
action-policy: tool "<name>" requires approval but the call has no agent
action-policy: tool "<name>" approval <outcome>
```

#### Token effect

Conditional error text is visible for that call and retained in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Undeclared tools default to side-effectful** — the `treatUndeclaredAsSideEffectful` heuristic can classify a genuinely read-only tool as a candidate; declare `effects: 'read-only'` to exempt it. - **The observe census is denormalized** — candidate events carry no arguments by design; correlating a candidate with its call requires joining on `callId`. - **enforce needs an approval channel** — without a composed approval service every side-effectful call denies fail-closed, which can be stricter than intended for unattended deployments.
