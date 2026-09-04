# Agent Note：P-BUDGET 移植（provider 字节上限、summarizer 独立额度、MCP 来源边界）

Status: implemented

[English](2026-09-03-p-budget-port.md) | 中文

## 问题

candidate 对到达 provider 的内容没有任何规范边界：LLM runtime 会分发任何组装好的信封，summarizer 会重放任意重放区域，MCP bridge 会注册服务器列出的每一个工具，元数据与分页均无界。已验证 PR6 的不变量——provider 分发前的精确 UTF-8 字节上限、独立的 summarizer 额度、有界 MCP 元数据——全部缺失。

## 决策

在 candidate 自己的 seam 上移植这些不变量，复用其现有结构：

- **最终请求字节上限**——`LlmRuntime.streamWithRegistration` 用 `measureRequestBytes`（对 JSON 信封做 `TextEncoder` 计量，绝不用 `string.length`）测量精确的模型面向信封（`messages` + 渲染后的 `system` + 工具 schema），在任何 waterfall 监听器或适配器分发之前以 `PromptBudgetError`（`PROMPT_BUDGET_EXCEEDED`）拒绝。上限为固定的 4 MiB 产品常量；token estimate 保持 advisory 且 provider 无关（不重新引入 estimate 上限）。
- **summarizer 独立额度**——`summarizeWithLlm` 携带自己的硬额度（`summarizationMaxBytes`，默认 8 MiB，config/policy/override 与其余 summarization 字段同管线），在 `ctx.llm.stream` 之前以 `COMPACTION_BUDGET_EXCEEDED` 拒绝，使恢复永远不能重新分发一个无界的辅助请求。
- **MCP 来源边界**——逐工具 description（4096）与序列化 schema（64 KiB）UTF-8 上限排除超限工具并保留兄弟工具，加上 `maxSyncPages`（50）、`maxToolsPerServer`（2000）、`syncTimeoutMs`（30s）上限约束聚合放大。MCP 元数据保持 catalog-only；本 candidate 不存在 effects 权威，P-AUTHZ 管线也从不读取它。
- **有界恢复**——candidate 的 overflow-recovery 流程已满足该不变量（`agent/request-error` 监听器、`maxOverflowRetries` 默认 1、按 agent 计数并在 assistant/message 与 idle 时重置、超界后响亮失败）；原样保留并用终态测试钉住。

## 后果

- 新增永久套件：runtime 字节边界（ASCII 精确边界、多字节 emoji、超限工具、分发前拒绝）、summarizer 额度边界（二分搜索精确字节边缘）与拒绝码、MCP 排除/边界/数量/页面上限、以及持续 overflow 终态循环测试。
- 反事实 RED 并 md5 恢复：A（关闭 runtime 检查）破坏四个 budget 测试；B（关闭 summarizer 检查）破坏两个；C（关闭恢复边界）破坏终态测试；D（关闭 MCP 边界）破坏排除测试。
- `PromptBudgetError`/`measureRequestBytes` 从 LLM 包导出；cordis API catalog 保持 byte-current（无公开服务方法变更）。

## 备选方案

- 对最终 HTTP body 做 provider-aware 字节计量：否决——harness 的规范 seam 是模型面向信封；适配器可能附加非内容的传输框架，而已验证参照计价的正是信封边界。
- 就地截断超限 MCP 元数据：否决——对不可信内容做静默变更；排除保留兄弟工具并记录数量。
- 重新引入 advisory token-estimate 上限：否决——已验证语义保持 estimate 仅 advisory；只有字节上限是规范的。
