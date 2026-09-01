# DeepSeek Harness 个人 fork —— 评估 + 修复 + 工作流 最终总结

> 本文件汇总这次全部工作的**最终状态**，供你 review / 采纳。配套详档：
> - 5维评估：`DSH-评估报告.md`
> - 35 提交增量审计：`DSH-fork-增量-审报告.md`
> - 修复/演进计划（含每项 vitest 数字 + 待确认方案）：`DSH-fork-修复-演进计划.md`

---

## 一、定位（你说的：个人开发 app，无他人使用）
- 因此我按"**不破坏/不卡我日常 + 不弄坏我机器/数据 + 能摸透工作流**"为重排优先级，而非多租户安全审计。

## 二、评估结论（静态 + 实跑）
- **5 维**：可靠 8.7 / 扩展 8.0 / 可用性&成本 7.1 / 性能 6.5 / 安全 4.5（原版 v0.1.2-alpha.1 口径）。
- **实跑**：`pnpm` 修复后，**全量回归 861 文件 / 14650 tests 通过**，39 失败全为 `posix_openpt`（我沙箱 PTY 假象，非回归）；**lockfile 重生成无真实回归**。
- **功能/能力**：约 48+ 模型可见工具 / 52 能力域 / 7 入口 / 6 子代理 provider / 5 沙箱后端。

## 三、已修并验证（全部 fork 真实 vitest）
| 类别 | 项 | vitest |
|---|---|---|
| **P0** | P0-1 SSRF 公网回归+绕过（policy/provider/test） | 49 |
| | P0-2 tool-browser：封 file/data/about + 截图路径穿越 | 3 |
| | P0-3 tool-service：id 穿越 / 进程组杀 / 有界 tail / workdir=会话cwd | 8 |
| **P1** | P1-1 MCP 单请求超时 | 103 |
| | P1-2 流失控终止（maxChunks 预算） | 5 |
| | P1-4 projection-cache 重试预算重置 | 20 |
| | P1-5：审批抛错兜底(P15) + read-family `effects:'read-only'` + guard 用例 | 7 |
| | P1-6：abortStream `keepInbox`(P17) | 11 |
| **P2** | observed-read `-f/-F/-I` flag 修正 | 94 |
| | apply_patch 推断路径穿越校验 | 187 |
| | log-only 事件 `{ignorable:true}`（attempt/job） | 407 |
| | escalation-hider 名单+`apply_patch`(P8) + 部署默认模式(P9) | 15 |
| | tool-browser/service `assertNever` + 删无用导出 | 8+3 |
| | tool-browser tunables 进 Config | 3 |
| | effects read-only 补齐（session-query×5 + lsp） | 148 |
| | 顺手修既有失败断言（read-image.spec.ts 工具清单） | — |

## 四、工作流优化清单（详见计划 §2）
最具杠杆：**给每个项目放 `AGENTS.md`**（自动加载、agent 严格遵守）；验证闭环；subagent/jobs/session 提速；会话回放审查；自用护身（不放真 secret、`file://` 已封）；macOS 别依赖持久终端；Web 包体积；版本锁死；skill 沉淀；tool-browser 做 UI 冒烟；goal/plan 管长目标。

## 五、剩余开放项（需你拍板，我已给方案，不擅自改）
- **P1-3 FrameQueue 丢头信号**：需新增 `session/resync` 帧 + **Web 客户端配合**；我这环境**无法端到端验证 Web 客户端**。→ 方案在计划 §"🔒"。
- **P11 action-policy 单调 guard**：需把"可被覆盖的水瀑布"改成单调拒绝；实现需协调**同步 guard + 异步审批**（CallId 是原始品牌字符串，需 Map + 清理），较复杂；且当前仅在你挂 hooks 桥接后可被绕过（防御纵深非活跃漏洞）。→ 方案在计划 §"🔒"。
- **P13 双重询问**：enforce 下升级工具可能被问两次（低优先）。
- **P2 残留微项**：tool-service tunables、README 三方陈旧同步、apply_patch 大小上限、FrameQueue 环型缓冲、`ownerSessionId` branded id、escalation-hider P7（code-SDK 泄漏）/P10（hint 矛盾）。均在计划 §未修 列明。

## 六、建议
1. **采纳已修的**（P0/P1/P2，都验证过）；这些是价值主体。
2. **P1-3 / P11**：请 review 我给的方案，决定"做"（我做 + 配单测，Web 客户端需你真机验证）或"缓"（记录为已知开放项）。
3. **用起来**：按工作流清单，先给你真实项目放 `AGENTS.md` + 一个 `skill`，然后逐步用。

---

*说明：本次所有修复均为对该 fork 最小聚焦改动，符合仓库约定（Config 校验、`ctx.effect`、JSDoc、加对应单测）；每条在 fork 真实 vitest 下验证通过。*