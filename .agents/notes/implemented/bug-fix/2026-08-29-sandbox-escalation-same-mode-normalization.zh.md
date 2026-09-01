# Agent Note: Sandbox escalation — same-mode normalization and a structured failure code

Status: implemented

[English](2026-08-29-sandbox-escalation-same-mode-normalization.md) | 中文

## Problem

一个运行在"当前已生效模式"下的智能体会反复把该模式当作升级请求提交：只要挂载了受限执行器，工具 schema 就会声明 `sandbox_permissions`/`justification`，于是 `danger-full-access` + `approval=never` 的会话看到一个永远不可能成功的升级旋钮并反复敲击——一次观测中出现 35 次连续调用，全部失败于 "is not strictly wider than this call's current mode"。每次失败都是普通 `Error`，观测与重试层无法分类，只能退回消息匹配。

## Decision

在共享升级编排中做两处协同修改：

- `approveEscalation` 将"请求模式等于调用有效模式"视为幂等：直接返回有效模式且不询问审批通道，调用按当前策略执行。相等性检查以封闭的 `SandboxMode` 词表为守卫，未知模式的相等对仍失败关闭。 - 真正不加宽的请求抛出携带稳定代码 `SANDBOX_ESCALATION_NOT_WIDER` 的 `HarnessError`；工具注册表将其呈现为 `result.error.info.code`，失败指纹与可观测性据此做结构化分类，不再解析文本。

同模式路径适用于所有强制族（bash、pwsh、edit、write），因为它们都经由唯一的 `approveEscalation` 归宿解析。escalation-hider 守卫的默认 `tools` 列表也由 `['bash', 'pwsh']` 扩为 `['bash', 'pwsh', 'edit', 'write']`，使文件系统变更工具同样不再向模型展示"永远无法成功"的旋钮。隐藏仍是外观层：模型即使照旧发出这些字段，也会精确命中执行层定义的幂等或结构化失败。

## Alternatives considered

**保留普通错误，让 schema 枚举阻止同模式请求。** 已否决：schema 枚举是组合级声明的封闭目标词表，而有效模式是每会话事实；枚举无法表达"不比本会话当前模式更宽"。

**归一化任何等于有效模式的请求，包括未知模式。** 已否决：未识别模式字符串必须失败关闭而非被比较接受，否则拼写错误或未来模式会静默执行而非暴露失配。

**把幂等逻辑折叠进每个工具族而非 `approveEscalation`。** 已否决：两个工具族本就汇聚于同一共享序列，跨文件重复门禁的存在正是为了防止它们分叉。

## Consequences

同模式升级重试现在会执行而非失败，消除了观测到的敲击循环；真正不加宽的请求以机器可路由的代码失败，重复检测与可观测性无需解析消息即可消费。更窄但合法的升级行为不变：仍经审批接缝询问，且仅在当次调用以获准模式运行。

## Testing

聚焦契约测试在共享序列以及 bash、fs 两个工具族上钉住幂等（不发起审批询问、盖章当前模式）与结构化代码；hider 套件钉住扩大的默认工具集。
