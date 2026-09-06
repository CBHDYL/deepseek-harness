# Agent Note: 把可复用多模型评审工作流做成技能

Status: implemented

[English](2026-09-05-multi-model-review-skill.md) | 中文

## 问题

冻结的多模型执行政策（`.agent/MULTI-MODEL-EXECUTION-POLICY.md`）只是文档：每个消费者都要手写 `agent()` 调用、escalation if/else、重试与拓扑路由——这正是 Step-2 benchmark runner 的形态。政策需要可复用执行资产，同时零 runtime 改动。

## 决策

把冻结政策做成技能（`.agents/skills/multi-model-review/SKILL.md`），其 canonical 脚本跑在现有 `workflow` 工具上。脚本编码：风险路由（LOW/MEDIUM/HIGH/CRITICAL）、确定性安全底线（security/authority 类永不落入 HIGH 以下）、gate 优先（确定性 gate 失败 → 零模型调用返回 GATE_FAILURE）、MEDIUM 升级到 cross-provider strong reviewer（稳定路由标签 VERDICT_FAIL；模型自己的 escalation 文本只是证据）、每个 reviewer 最多重试一次且两次输入证据一致、HIGH/CRITICAL 同 provider 配置 fail loud、以及确定性 outcome 聚合——任何 reviewer 的 PASS 都不能擦除另一个 reviewer 的 FAIL（T2-A 教训）。首次独立闭环节点在第一稿上抓到 5 个政策符合性 blockers（strong verdict 覆盖、cross-provider 未强制、retry 证据损坏、gate 未记录、吞掉 fatal workflow 错误）；全部修复并针对真实路由重新验证后才闭合。

## 备选方案

- **在工作流引擎内做 runtime 强制** — 自动风险分类与拓扑路由需要新 runtime 子系统（RiskEngine/Router 领域），归约审计已删除它们；没有新证据证明应重新引入。
- **只放一个脚本文件** — 人类可消费但 agent 不可用；技能系统是把可复用程序加载进会话的既有机制。

## 后果

- 政策可被任何加载了该技能的 agent 执行，生产 runtime delta 仍为零；provider/model 名保持调用方配置。
- Dogfood 证据（`.agent/reports/w2-dogfood.md`）显示在 deepseek 与 claude 路由上的真实 LOW/MEDIUM/HIGH/gate 冲突/瞬断重试运行。
- `.agent/` 与本技能的 git 跟踪随用户的提交步骤落地；任务禁止 push/merge，因此在其它工作树中冻结的可验证性是已知局限，直到提交。
- CRITICAL 保持 provisional：脚本标记 `authority_required`，但审批跳步本身是现有链的职责。
