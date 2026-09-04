---
description: "中央动作策略拦截器：把有副作用的工具调用统一送进审批接缝把关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-action-policy-guard

[English](README.md) | 中文

## 概述

中央强制动作策略拦截器。审批/沙箱治理此前只覆盖"工具体内自愿请求审批"的调用——不请求审批就执行敏感动作的工具完全绕过策略。本守卫把决策移到 `tools/pre-execute`：声明 `effects` 非 `read-only` 的工具（未声明默认视为有副作用）每次调用都经审批接缝把关。`observe` 模式（默认）只记录未受治理的调用，不改变行为；`enforce` 模式拒绝任何未获一次性授权的副作用调用（无审批服务时 fail-closed）。

## 目录

- [持久化观测](#durable-observation)
- [配置](#config)
- [工具声明](#tool-declaration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="durable-observation"></a>
## 持久化观测

在 `observe` 模式下，每个副作用候选调用都会追加一条仅记录（log-only）的 `action-policy/candidate` 会话事件，其 payload 恰好为 `{ toolName, callId, effectSource }`——不包含参数、命令、路径、 justification 或凭据，因此该统计不会在持久日志中复制工具输入或密钥。 `effectSource` 为 `declared`（工具声明了 `effects: 'side-effectful'`）或 `undeclared`（由守卫的 `treatUndeclaredAsSideEffectful` 分类捕获）。只读 工具不追加任何事件，`enforce` 模式也从不追加该事件。事件标记为 `ignorable: true`，使不认识该类型的旧读取器可以安全跳过。

<a id="config"></a>
## 配置

```yaml
- id: action-policy-guard
  name: '@deepseek-ai/dsh-action-policy-guard'
  config:
    mode: observe                    # observe | enforce
    treatUndeclaredAsSideEffectful: true
```

<a id="tool-declaration"></a>
## 工具声明

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

<a id="model-experience"></a>
## 模型体验

### 被拒绝的副作用调用（enforce 模式）

#### 模型看到的内容

在 `enforce` 模式下，未获一次性授权的副作用调用会以下列拒绝文案之一失败，工具体永远不会执行。`observe` 模式不增加任何模型可见内容。

##### 拒绝文案

```markdown
action-policy: tool "<name>" is side-effectful but no approval service is composed
action-policy: tool "<name>" requires approval but the call has no agent
action-policy: tool "<name>" approval <outcome>
```

#### Token 影响

条件性错误文本对该次调用可见，并保留在历史中直到压缩（compaction）。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **未声明工具默认为有副作用** —— `treatUndeclaredAsSideEffectful` 启发式可能把真正只读的工具也判为候选；声明 `effects: 'read-only'` 即可豁免。 - **observe 统计是反规范化的** —— 候选事件按设计不携带参数；将候选与其调用关联需以 `callId` 连接。 - **enforce 需要审批通道** —— 未组合审批服务时，每个副作用调用都会失败关闭，对无人值守部署可能比预期更严格。

<a id="dev-note"></a>
### 开发备注

`effects` 分类只从工具注册表中的已发布（SHIPPED）`ToolDefinition` 读取，绝不采信 MCP 或其他自声明元数据：MCP 服务器声称 `readOnlyHint`（或任何伪造的 `effects` 字段）都不能降低把关等级，未声明工具一律经 `treatUndeclaredAsSideEffectful` 折叠处理。模型编写的动态 Cordis 工具适用同一规则——宿主运行器在沙箱 `defineTool` 边界剥离包代码声明的任何 `effects`，因此伪造的 `read-only` 永远无法豁免有副作用的动态工具体。该声明由拥有 `execute()` 的同一份已发布代码自证，与插件信任边界一致——针对其他工具的运行时包装替换在分发边界处被守卫拦截（参见修复账本中 PR-2 的权威执行快照工作）。不发布 invariant companion，因为该守卫没有属于自己的可变关系：它所强制执行的每个可观察项（分类、ask/deny 折叠、把关）都由 ToolRuntime 与审批套件在分发接缝处断言。
