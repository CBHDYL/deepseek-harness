# Remediation 实施需求

[English](remediation-requirements.md) | 中文

Harness remediation 计划的已确认需求。权威执行状态见 [REMEDIATION-IMPLEMENTATION.md](../REMEDIATION-IMPLEMENTATION.md)；规范设计为 `docs/system-wide-audit.md` 中的 Remediation Plan Design Review（该审计文档暂无双语对侧）。

- 目标：按 ledger 定义实施 remediation 计划的 PR-0 至 PR-6，每次会话只做一个 PR，每个 PR 遵循其记录的闭环与退出标准。
- 权威性：Design Review 与早期 remediation plan 冲突时以前者为准。
- 范围纪律：只有当前 PR 的文件会被修改；新发现按 BLOCKING / RELATED-NONBLOCKING / UNRELATED 分类并记录进 ledger。
- 验收：每个 PR 的退出标准，包括 PR-0 的 `pnpm run test:snapshot` 全绿且每个原始失败都有归因。
- ledger 中的产品决策 PD-1 … PD-6 仍未定；受影响代码落地前必须由人工决定。
