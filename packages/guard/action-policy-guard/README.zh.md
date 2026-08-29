# @deepseek-ai/dsh-action-policy-guard

[English](README.md) | 中文

中央强制动作策略拦截器。审批/沙箱治理此前只覆盖"工具体内自愿请求审批"的
调用——不请求审批就执行敏感动作的工具完全绕过策略。本守卫把决策移到
`tools/pre-execute`：声明 `effects` 非 `read-only` 的工具（未声明默认视为
有副作用）每次调用都经审批接缝把关。

`observe` 模式（默认）只记录未受治理的调用，不改变行为；`enforce` 模式
拒绝任何未获一次性授权的副作用调用（无审批服务时 fail-closed）。

## 配置

```yaml
- id: action-policy-guard
  name: '@deepseek-ai/dsh-action-policy-guard'
  config:
    mode: observe                    # observe | enforce
    treatUndeclaredAsSideEffectful: true
```

## 工具声明

```ts
ctx.tools.register(defineTool({
  name: 'send-email',
  description: 'Send an email',
  parameters: { to: { type: 'string' } },
  output: { schema: { type: 'string' }, render: () => [] },
  effects: 'side-effectful',        // 或 'read-only'
  execute: async () => 'sent',
}))
```
