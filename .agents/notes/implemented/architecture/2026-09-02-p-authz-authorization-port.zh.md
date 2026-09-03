# Agent Note：P-AUTHZ 授权端口（操作身份、grant、权威快照）

Status: implemented

[English](2026-09-02-p-authz-authorization-port.md) | 中文

## 问题

候选执行链围绕同一个可变 `ToolExecution` 对象做批准与派发：`serviceAsk` 实时读取 `exec.name`/`exec.callId`，派发体实时读取 `exec.name`/`exec.arguments`，而 `allowed-once` 批准结果只是一个游离字符串——没有绑定到它所授权的执行，没有消费点，没有任何机制阻止重放或阻止 wrapper 在批准与派发之间替换名称或参数。同时没有持久的会话级操作身份，无法把持久 `tool/call` 行与跨重载的执行关联起来。

## 决策

在候选 scheduler/execution seam 上恢复，不 cherry-pick：

- **操作身份** —— registry 上的 `mintOperationId(agent)`：会话级 `op_<n>` 计数器，从已加载日志的 `tool/call` 行高水位播种（容忍数组式/stub/无会话形态），无 agent 用 `op_x<n>`。agent loop 在追加 `tool/call` 行之前铸造身份，并经 `ToolExecutionInput` 传入；`tool/call`、`tool/result` 行与 `approval/asked` 均携带该身份。
- **权威快照** —— `createExecution` 把 `{operationId, name, callId, arguments}`（arguments 即同一份 deep-frozen 无损值）冻结进私有 `WeakMap`。派发阶段读取（`serviceAsk` 身份、grant 绑定、`dispatchToolBody` 解析与 body 参数、`createSuccessResult` render/presentationMeta、`normalizeDispatchResult`、post-execute 值替换）一律读快照，不读活执行对象。
- **精确一次性 grant** —— `allowed-once` 时 registry 铸造绑定快照的 grant（operationId、工具名、callId、SHA-256 参数摘要）并标记该执行 grant-required。`dispatchScheduledExecution` 在派发起始消费它——先于 wrapper 与 body——并删除；重放或二次派发找不到 grant 即 fail-closed。
- **失败语义** —— body 已运行后 `tools/execute` wrapper 抛错仍产出错误结果（fail-loud），绝不伪装成"未执行"；loop 继续引用已记录的 `tool/call` 行。

## 后果

- 新增永久套件 `packages/core/tools/tests/operation-grant.spec.ts`（9 例）：合法 allow、ask→approve 单次询问、ask→deny、经 scheduler 通道的重放 fail-closed、wrapper 参数/名称替换惰性、派发后 wrapper 失败 fail-loud、高水位播种、无 agent 计数器。
- 反事实 RED 并 md5 恢复：CF-A（派发回读活 exec 字段）→ 两个替换测试 RED；CF-B（禁用 grant 检查）→ 重放测试 RED。
- 回归：tools 399/399；tools+agent-loop+user-approval+sandbox 家族 1221/1221；P-SANDBOX 93/93；typecheck 0；oxlint 0。
- 遗留（与已验证不变量一致）：升级仍是独立的、经 PR-1 验证的 body 审批，在 gate ask 之后决定——两个独立风险域，不是合并成一次询问。

## 备选方案

- 把 gate ask 与 sandbox 升级合并为一次审批：否决——已验证不变量将它们保持为独立风险域（动作策略 vs sandbox 维度放宽）。
- 把 grant 作为字符串盖章在执行上：否决——任何字符串都可复制；以执行身份为键的 `WeakMap` 是唯一不可复制的绑定。
