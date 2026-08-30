# @deepseek-ai/dsh-action-policy-guard

[English](README.md) | 中文

中央强制动作策略拦截器。审批/沙箱治理此前只覆盖"工具体内自愿请求审批"的
调用——不请求审批就执行敏感动作的工具完全绕过策略。本守卫把决策移到
`tools/pre-execute`：声明 `effects` 非 `read-only` 的工具（未声明默认视为
有副作用）每次调用都经审批接缝把关。

`observe` 模式（默认）只记录未受治理的调用，不改变行为；`enforce` 模式
拒绝任何未获一次性授权的副作用调用（无审批服务时 fail-closed）。

## 持久化观测

在 `observe` 模式下，每个副作用候选调用都会追加一条仅记录（log-only）的
`action-policy/candidate` 会话事件，其 payload 恰好为
`{ toolName, callId, effectSource }`——不包含参数、命令、路径、
justification 或凭据，因此该统计不会在持久日志中复制工具输入或密钥。
`effectSource` 为 `declared`（工具声明了 `effects: 'side-effectful'`）或
`undeclared`（由守卫的 `treatUndeclaredAsSideEffectful` 分类捕获）。只读
工具不追加任何事件，`enforce` 模式也从不追加该事件。事件标记为
`ignorable: true`，使不认识该类型的旧读取器可以安全跳过。

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
  effects: 'side-effectful',        // or 'read-only'
  execute: async () => 'sent',
}))
```
