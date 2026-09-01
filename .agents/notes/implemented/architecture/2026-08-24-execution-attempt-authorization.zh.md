# Agent Note: 执行尝试级授权（凌驾于铸造式沙箱授权之上）

Status: implemented

[English](2026-08-24-execution-attempt-authorization.md) | 中文

## Problem

PR-1 让沙箱授权有了来源检查，但铸造出的授权不是执行授权：审批守卫把授权按调用方可复用的 `callId` 记账，一次批准可能泄漏给另一个工具、参数集或会话；短路返回 allow 的 pre-execute 监听器可以完全跳过询问；守卫在调度器唯一询问点之外自行请求审批，其请求不携带执行信号（取消会挂起 turn 与 teardown）；两套审批路径产生相互矛盾的审计（问了两次，或已允许却被拒）。

## Decision

授权由注册表的执行生命周期持有。每个注册表创建的执行都带有一份冻结的 identity record（以执行对象为键的 WeakMap provenance）和一个私有状态机 `prepared → authorized → dispatching → terminal`。派发边界在同一段同步代码中原子地转入 `dispatching` 并原子地 TAKE 一次性 grant；被捕获的 prepared execution、第二次 `scheduler.dispatch`、并发派发、或 `tools/execute` 包装器调用两次 `next()` 一律 fail closed（`DUPLICATE_TOOL_DISPATCH`）——body continuation 是一次性的，因此一次 allowed-once 批准最多产生一次实际派发。

`ApprovalService` 以执行对象为键在 WeakMap 中保存 grant：只有调度器的询问（携带 `authorizationSubject`）铸造 grant；`take(subject)` 原子地消耗它；`revoke(subject)` 在尝试的终局转移（已执行、被拒、已取消）时删除它。在 allowed → minted → cancel-before-take 窗口内被取消的尝试会撤销自己的 grant，因此任何 live grant 都不能脱离执行生命周期存活，也不能被重试或其他尝试复用。仅作关联的询问（沙箱升级）不铸造 grant。

持久化 `OperationId` 只用于审计关联，绝不是运行时安全能力：per-session 计数器从已加载日志的高水位播种（同一 session log 内 restart/HMR 安全），调用方提供的 id 只有在该 session 先前铸造过且恰好认领一次时被接受，enforcement 读取冻结的 identity record，因此改写活动对象的 `operationId` 无法转移 grant。摘要计算是栈安全的（迭代式序列化）。

强制性安全建议注册在 `tools.policy()` 上——一个由注册表持有的收集器，为每次尝试评估每一个 policy——没有任何监听器可以短路另一个——并在唯一的调度器审批点之前按 deny > ask > allow 聚合。`tools/pre-execute` 仍是行为性水瀑布，并与收集到的 policy 决策合并；`tools.guard()` 是验证该执行 grant 的最后单调 deny 栅栏。`approval/request` 保持 first-claim-wins。

沙箱升级并入同一次尝试的审批语义：升级中的工具 body 传递该尝试的操作 id、参数摘要与请求的沙箱维度；当该次执行审批已经命名了这一维度时，body 复用它而不再向人类问第二次。PR-1 的 maxMode 硬上限、owner 铸造与后端 provenance 检查保持不变。

`parent` 仅表示来源。基础 bundle 仍以 `action-policy-guard.mode: observe` 发布：机制已实现但默认 enforcement 未启用（Design Review 的 rollout 门禁仍然有效）；ledger 明确记录这一点。

## Verification

`core/tools/tests/execution-lifecycle.spec.ts` 把验证评审的探针永久化：被捕获的 prepared execution 不能派发两次；并发派发只运行一次 body；`tools/execute` 包装器调用两次 `next()` 只派发一次；allowed 尝试恰好 take 一次 grant 且 grant 在派发处死亡；allowed → minted → cancel-before-take 窗口内的取消撤销 grant；改写活动 operation id 无法把 grant 挪到另一尝试；从未铸造的调用方 id 被替换；铸造的 id 恰好认领一次；全新 ToolRuntime 从 session log 播种（restart/HMR 防碰撞）；带 agent 的直接执行在同一操作 id 上记录 tool/call + tool/result。`action-policy-guard/tests/authorization.spec.ts` 钉死：已消耗的 grant 无法授权复用同一 callId 的第二次尝试；短路 allow 既不能隐藏强制审批询问也不能隐藏强制 policy deny；hook 式 ask 恰好产生一次审批；两个 asker 只产生一个问题；deny 无视注册顺序胜过 ask；asked → decided → tool/call → tool/result 在同一操作 id 上成链；沙箱升级维度并入单次执行审批（没有第二次人类询问）；enforce 下有铸造式沙箱授权但无操作 grant 不能授权执行；已取消的尝试无法被迟到的回答复活。`user-approval/tests` 钉死原子 take、撤销、rejected/cancelled/仅关联询问不铸造 grant。`session/tests/repair.spec.ts` 钉死复用 callId 时按操作 id 配对与 legacy callId 回退。tools invariant 配套组件现在强制同一 session log 内操作 id 唯一、每个 allowed-once 恰好一个终局 disposition。`acp/tests/enforce-cancel.spec.ts` 钉死 E24 回归。会话 fixture 已因新关联字段刷新（升级审批行现在携带 operationId/argsDigest/sandboxMode）；SDK persistent-tools fixture 为手工补齐并标记 UNVERIFIED_UNTIL_PTY_RERUN。

## Alternatives considered

- **按 `callId` 加参数摘要记账** — 拒绝：调用方可复用的 id 仍可伪造，摘要会变成防重放机制，而这明确不是它的职责。
- **把 Cordis 水瀑布重写为收集协议** — 拒绝：委托合并的监听器加上 grant 验证的单调栅栏，无需改变水瀑布语义即可实现 deny > ask > allow；短路的三方监听器退化为 fail-closed 拒绝而非授权。
- **为守卫建立第二审批通道** — 拒绝：设计要求唯一询问点；守卫是决策源加栅栏。

## Consequences

`operationId` 在事件 schema 中为可选（历史与崩溃修复行早于它）；A6 关系由 tools invariant 配套组件在实时事件流上强制执行。grant 被 take 与 body 派发之间崩溃不会复用 grant（修复路径以复制的操作 id 合成 `tool/result`，而不是重新执行）。enforce 模式下，能够铸造沙箱授权的部分可信进程内代码仍无法在没有自己尝试的 grant 时执行副作用；恶意代码仍不在范围内。基础 bundle 的 enforcement 保持 `observe`，直到 Design Review rollout 门禁完成——PR-2 发布的是机制，不是默认值。
