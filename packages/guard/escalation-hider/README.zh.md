# @deepseek-ai/dsh-escalation-hider

[English](README.md) | 中文

一个守卫插件：当会话内的沙箱升级不可能成功时，从模型可见的工具 schema 中移除升级参数。它不是模型可见工具，也不触碰执行语义：工具注册表只校验 已声明的参数，所以模型即使仍发出这些字段，行为也与此前完全一致（失败即关闭）。

## 为什么需要

`bash`/`pwsh` 只要挂载了受限执行器就会声明 `sandbox_permissions` 与 `justification`——并不感知会话当前的沙箱模式或审批策略。运行在 `danger-full-access` + `never` 下的智能体因此看到一个永远不可能成功的升级 旋钮，实测的失败模式正是它反复敲击该旋钮：35 次连续调用全部失败于 `sandbox escalation to "danger-full-access" is not strictly wider than this call's current "danger-full-access" mode`。

## 它做什么

在 `system-prompt/assemble` 时，当调用会话的有效模式达到或超过 `hideAtOrAboveMode`（默认 `danger-full-access`），或其审批策略为 `never` （默认隐藏），该插件从所有名称匹配 `tools` 通配符模式（默认 `['bash', 'pwsh', 'edit', 'write']`）的工具上剥离 `sandbox_permissions`/`justification`。模式外的工具、以及没有这些参数的 工具原样保留。

## 配置

```yaml
- id: escalation-hider
  name: '@deepseek-ai/dsh-escalation-hider'
  config:
    hideAtOrAboveMode: danger-full-access
    hideWhenApprovalNever: true
    tools: [bash, pwsh, edit, write]
```

配置错误在插件加载时立即失败。

## 模型体验

### 隐藏的升级字段

#### 模型看到的内容

当会话的有效沙箱模式达到或超过 `hideAtOrAboveMode`，或其审批策略为 `never` 时，匹配工具的 schema 中不再出现 `sandbox_permissions`/`justification`。其余文本不变；拒绝与升级指引仍由工具自身提供。

#### Token 影响

移除的参数使装配后的 schema 略有缩小；不增加任何逐调用错误文本。

#### KV Cache 影响

仅当会话的模式或策略跨越隐藏阈值时 schema 前缀才变化，这会使复用旧 schema 前缀的缓存条目失效。

## 已知限制与暂缓事项

- **schema 隐藏是外观层而非强制** —— 模型即使照旧发出这些字段，仍会命中工具失败关闭的执行路径；执行层始终是权威边界。 - **基于通配符的工具匹配** —— 只剥离匹配 `tools` 通配符模式的名称；未来新增支持升级的工具族需加入默认列表。 - **隐藏跟随常驻策略而非已解析调用** —— 决定使用装配时会话的模式与审批策略，而非工具稍后解析出的逐调用策略。
