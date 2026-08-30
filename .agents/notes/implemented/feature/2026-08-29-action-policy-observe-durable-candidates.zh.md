# Agent Note: Action-policy guard — durable observe-mode candidate events

Status: implemented

[English](2026-08-29-action-policy-observe-durable-candidates.md) | 中文

## Problem

action-policy 守卫的 `observe` 模式只通过 `logger.warn` 报告未受治理的副作用调用——这是进程内通道，不留持久痕迹。部署方无法审计哪些工具未受治理、无法在切换 `enforce` 前测量基线，也无法事后将候选与工具调用关联——而这正是 observe 模式的全部意义。

## Decision

在 `observe` 模式下，每个副作用候选调用追加一条仅记录（log-only）的 `action-policy/candidate` 会话事件，其 payload 恰好为 `{ toolName, callId, effectSource }`：

- `effectSource` 是封闭词表 `'declared'`（工具声明了 `effects: 'side-effectful'`）或 `'undeclared'`（由 `treatUndeclaredAsSideEffectful` 分类捕获）——observe 统计真正要区分的两种治理事实。
- `callId` 将候选关联回其所属的 `tool/call`/`tool/result` 事件，因此 payload 不携带参数、命令、路径、justification 或凭据；持久日志绝不复制工具输入或密钥。
- 事件标记 `ignorable: true`，不认识该类型的读取器可安全跳过；`Session.append` 为此新增了类型化 `LogEventIntent` 选项——这是会话日志版本化 Agent Note 预留的信封标记的第一个生产者。
- 只读调用不追加任何事件，`enforce` 模式从不追加候选事件，无 agent 的执行（无会话）也不追加；这些路径保持原行为逐字节不变。

## Alternatives considered

**仅通过 `logger.warn` 记录候选。** 已否决：进程内通道不可重放、不可查询、跨恢复不持久。

**在事件上记录完整参数。** 已否决：参数已存在于关联的 `tool/call` 事件中；在日志中重复会加倍工具输入，并把命令、路径和凭据带进纯信息性记录。

**在 `enforce` 模式下也追加事件。** 已否决：enforce 已通过审批接缝产生审计轨迹（`approval/asked`/`approval/decided`）；追加第二份候选记录会使统计重复计数被拒绝的调用。

## Consequences

observe 模式产出未治理候选的可重放持久统计，观测与上报层可按工具与 `effectSource` 折叠，而不触碰执行语义或模型历史。`Session.append` 表面现在支持仅记录生产者的 ignorable 标记，补齐了会话日志版本化 Agent Note 暂缓的缺口。

## Testing

聚焦契约测试钉住 payload 的精确键集合（及其不含秘密参数）、两个 `effectSource` 取值、`ignorable` 信封标记，以及只读调用、enforce 模式、无 agent 执行的"不追加"规则。
