# Agent Note：从编译后的工具 schema 中剥离升级参数

状态：已实施

[English](2026-08-30-escalation-hider-compiled-schema-strip.md) | 中文

## 问题

`escalation-hider` 应在 `system-prompt/assemble` 时从匹配工具上剥离 `sandbox_permissions`/`justification`，但 `stripEscalationParameters` 只过滤 `tool.parameters` 的顶层键。工具注册表通过 `defineTool` 把每个参数规格编译为 JSON Schema（`{ type, properties, required }`），升级字段实际位于 `properties` 内层 —— 顶层过滤零命中，工具原样通过。处于 `danger-full-access` + `never` 的会话因此仍能看到升级旋钮（并持续失败），这正是 hider 要消除的失败模式。包测试使用扁平 `ToolSchema` fixture，与旧过滤形态吻合，缺陷在测试套件中不可见。

## 决策

`stripEscalationParameters` 现在同时处理 `parameters` 对象的两种形态：

- 编译后的 JSON Schema：从 `properties` 内层移除升级字段，并从 `required` 同步删除被剥离的名称。
- 扁平字段映射：照旧移除顶层升级键。

只重建发生变化的工具；未触及的工具保持对象引用不变，不在 `tools` 模式内的工具仍原样通过。组装接线测试改为通过 `defineTool` 注册真实工具并断言组装后的目录，编译形态或接线任一回归都会使测试失败。

## 备选方案

**由 `dsh-tools` 向 hider 提供扁平规格。** 否决：`wireSchemas`/`schemaOf` 有意为所有组装消费者投影编译后 schema，为一个 guard 改变该契约会把 hider 的形态假设扩散到多个包。

**只处理编译形态。** 否决：`stripEscalationParameters` 是导出函数，扁平映射是合法的 `ToolSchema` 形态；两种都处理成本极低，且保持直接组装扁平 schema 的调用方行为不变。

## 影响

`danger-full-access`/`never` 会话现在会从 `bash`/`pwsh`/`edit`/`write`（及任何模式匹配工具）的模型可见 schema 中失去升级字段，恢复 hider 的设计意图。未触及工具的引用语义与模式匹配不变；扁平形态路径行为与之前完全一致。默认模式列表之外的工具（如 `apply_patch`）按设计仍暴露其升级字段。
