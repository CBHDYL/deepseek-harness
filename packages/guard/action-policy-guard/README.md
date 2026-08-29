# @deepseek-ai/dsh-action-policy-guard

English | [中文](README.zh.md)

A central mandatory action-policy interceptor. Approval/sandbox governance
only covers calls that OPT IN by requesting approval inside the tool body; a
tool that performs a sensitive action without requesting approval bypasses the
policy entirely. This guard moves the decision to `tools/pre-execute`: tools
whose declared `effects` is not `read-only` (undeclared tools count as
side-effectful by default) are gated through the approval seam for every call.

`observe` mode (default) logs ungoverned calls without changing behavior;
`enforce` mode denies any side-effectful call whose approval is not granted
once (fail-closed when no approval service is composed).

## Config

```yaml
- id: action-policy-guard
  name: '@deepseek-ai/dsh-action-policy-guard'
  config:
    mode: observe                    # observe | enforce
    treatUndeclaredAsSideEffectful: true
```

## Tool declaration

```ts
ctx.tools.register(defineTool({
  name: 'send-email',
  description: 'Send an email',
  parameters: { to: { type: 'string' } },
  output: { schema: { type: 'string' }, render: () => [] },
  effects: 'side-effectful',        // or 'read-only'
  execute: async () => 'sent',
}))
```
