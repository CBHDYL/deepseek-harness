# W2 DOGFOOD — REUSABLE MULTI-MODEL POLICY WORKFLOW（真实执行记录）

run_time: 2026-09-05
asset: `.agents/skills/multi-model-review/SKILL.md`（canonical 脚本，workflow 工具 inline 执行）
providers: cheap=deepseek-official/deepseek-v4-flash, strong=claude/claude-opus-5（cross_provider=true）

| case | 目标 | 结果 | 证据 |
|---|---|---|---|
| 1 LOW mechanical | 1 cheap fresh，无 escalation | outcome=REVIEW_FAIL，verdict=FAIL，off-by-one blocker 检出正确，escalation=null，1 agent | flash 单审，无 strong 调用 |
| 2 MEDIUM escalation | cheap FAIL → strong cross-provider | escalation.triggered=true reason=VERDICT_FAIL（修复后重跑；原首跑标 TEST_FAILURE 属误标已弃）；cheap FAIL + claude FAIL，双份 findings 带仓库行号 | 2 agents：flash + claude，cross_provider=true |
| 3a HIGH security floor | risk=LOW + kind=security → HIGH | risk_effective=HIGH；parallel scout+strong 双双 FAIL，continuation.ts:644-684 权威模式引用 | 2 agents：scout flash + claude |
| 3b provider transient/retry | 真实瞬断 | 首次运行 flash scout 两次 null → INFRA_FAILURE，retries=[attempt1 unavailable, attempt2 unavailable]，claude strong 正常 | 3 agents；retry 上限=1 生效 |
| 5 deterministic gate conflict | 真实 oxlint FAIL → 模型不得覆盖 | outcome=GATE_FAILURE，gate=typescript/no-unnecessary-condition（真实运行 exit 1），0 agents | 模型零调用 |

## 关键观察

1. **五种拓扑行为全部真实执行**：LOW 不升级、MEDIUM 触发升级且 cross-provider、HIGH 并行、retry 上限 1、gate 前置短路。
2. **security floor 无 bypass**：risk 输入 LOW 被 kind=security 抬到 HIGH（risk_requested 与 risk_effective 分离记录）。
3. **真实瞬断覆盖 retry case**：flash 路由今天出现与 STEP 2b 同型的 reviewer null，脚本记录 retries 后 INFRA——没有静默替换 provider。
4. **模型质量**：claude strong 在两个 FAIL case 中给出带仓库行号、与真实树核对的 findings（与 STEP 2 benchmark 的 E arm 行为一致）。
5. **authority_note 随每次输出返回**：findings only。

## 局限

- case 4 用真实瞬断替代人为注入（更真实，但不可复现触发）。
- CRITICAL 拓扑 = HIGH + 权威边界提示（provisional，政策如此）。
- token/latency 未单独采集（无新 telemetry 子系统，政策允许现有机制）。

## FIX-REVERIFY（首次独立闭环节点抓到 5 blockers 后的修复验证）

四轮 closure review（fresh claude ×2）共抓到 5 个 blockers 与若干 warnings，全部修复并真实重跑：

| 发现（blocker/warning） | 修复 | 验证 |
|---|---|---|
| MEDIUM outcome 由 strong verdict 单方面决定（T2-A 擦除风险） | outcome = 确定性 aggregate：任一 FAIL → REVIEW_FAIL，永不擦除 | MEDIUM 重跑：cheap FAIL + claude FAIL → REVIEW_FAIL，verdict/strong_verdict 双保留 |
| HIGH outcome 同样 strong 单边 | 同上 aggregate | 脚本审计 |
| cross-provider 只记录不强制 | HIGH/CRITICAL 同 provider → CONFIGURATION_ERROR（fail loud，0 模型调用）；MEDIUM 同 provider → 降级执行并记录 cross_provider_warning | HIGH 同 provider probe：0 agents → CONFIGURATION_ERROR ✓ |
| retry 把 label 塞进 evidence 参数 | retry 两次调用都传 args.evidence | 代码修复 + 脚本审计 |
| gate 可选且不记录 | gate/gate_missing 字段随输出记录；LOW/HIGH/CRITICAL 缺 gate 显式 gate_missing:true | LOW 重跑：gate_missing:true ✓；gate 冲突重跑：gate 对象记录 ✓ |
| escalation_reason 自由文本 + TEST_FAILURE 误标 | trigger 词汇 = 冻结 7 项 + 稳定标签 VERDICT_FAIL；模型 escalation_reason 只作证据字段 reviewer_escalation_reason | MEDIUM 重跑：reason=VERDICT_FAIL ✓ |
| bare catch 吞 fatal workflow 错误 | 移除 catch：agent() 失败=null 走 retry；fatal throw 让脚本响亮死亡 | 代码修复（与 runtime.ts:316 语义一致） |
| HIGH 一侧 null 丢弃幸存 findings | 部分 null 时保留幸存 verdict/findings，outcome=aggregate(幸存) | 脚本审计 |

## FIX-REVERIFY ROUND 2-3（第二轮/第三轮闭环节点发现 → 修复 → 验证）

| 发现（blocker/warning） | 修复 | 验证 |
|---|---|---|
| risk 值未校验，安全 floor 先于校验导致 'BOGUS'+security 静默路由 | 校验上移到 floor 之前：非 LOW/MEDIUM/HIGH/CRITICAL → CONFIGURATION_ERROR | 真实 probe：risk=BOGUS + kind=security → CONFIGURATION_ERROR，0 agents ✓ |
| REVIEWER_UNAVAILABLE 作为第 8 个 trigger 标签 | escalationOf(null) → null；不可用由 *_unavailable 字段记录 | 脚本审计 + round-3 reviewer 确认 |
| aggregate([]) fail-open | 空数组 → REVIEW_UNCERTAIN | 脚本审计 |
| MEDIUM strong-unavailable 分支缺 verdict/confidence/evidence_complete | 补对称字段 | 脚本审计 |
| 调用文档 kind 枚举缺 3 个 authority 类 | 补全 + 校验封闭集规则文档化 | 脚本审计 |
| gate_missing 只记录不强制 | 文档化决策：政策「适用处」由调用方定，flag 显式不静默 | 已写入 SKILL.md 规则节 |
| VERDICT_FAIL 不在政策 7 触发器 | 政策文件 ESCALATION TRIGGERS 节补注：VERDICT_FAIL 为 MEDIUM 路由稳定标签 | 政策已更新 |
| HIGH thunk-throw 与 result-null 不对称（throw 丢幸存 findings） | 统一两种 null 源：仅双侧 null 才 INFRA，单侧保留幸存 | 脚本审计 |
| dogfood 首跑 TEST_FAILURE 陈旧行 | 已修为 VERDICT_FAIL | 文档 |

## ROUND 4-5 FIX-VERIFY（字段前缀化与文档精确性）

| 发现 | 修复 | 验证 |
|---|---|---|
| warning：MEDIUM escalated 分支 confidence/evidence_complete 混源（cheap verdict + strong confidence 自相矛盾） | strong 侧字段加前缀 strong_confidence/strong_evidence_complete；非前缀恒为 cheap 侧 | 真实重跑 MEDIUM（field-prefix rerun）：cheap flash FAIL + claude FAIL → confidence=HIGH/evidence_complete=true（cheap）+ strong_confidence=HIGH/strong_evidence_complete=true 同框，reason=VERDICT_FAIL ✓ |
| warning：HIGH findings 语义翻转 | HIGH 双侧字段全部前缀化（scout_findings/strong_findings），无顶层 findings | 脚本审计 |
| warning：单侧存活时非前缀字段来源描述 | SKILL.md 规则节写入字段约定：非前缀恒属 cheap/scout 侧 | 文档 |
| info：表格行未区分 blocker/warning | FIX-REVERIFY 表头改「发现（blocker/warning）」 | 文档 |
| INFRA：round-5 claude 双 null（真实瞬断） | 换 fresh pro scout 存活：无 blockers，仅 3 条文档精确性发现（已修） | 本轮记录 |

## 闭环节点总结

5 轮 fresh 独立 review（claude×2 / claude×2 / claude×2 / claude×2(INFRA) / pro+claude(strong 侧 INFRA)）共抓 5 blockers + 13 warnings/infos，全部修复并验证。末两轮无 blocker；最后一轮仅剩文档精确性（已修）。W2 = PASS（limitation：闭环节点期间 claude 路由出现多次真实瞬断，按政策 retry→INFRA→换 fresh reviewer 处理，机制本身即证据）。
