# PLAN-CHECKPOINT — Canonical Plan Continuity Record

> 用途：跨会话/压缩/换模型后的计划连续性 authority。
> 不是 production reality 的 authority——与真实代码冲突时以真实 evidence 为准并记录 decision delta。
> 只保存当前真理；详细 evidence 留在 .agent/reports/、审计输出、测试里。

## PLAN STATUS

```
POST-AUDIT FINAL PLAN = READY_WITH_DEFERRED_ITEMS
```

## CURRENT DIRECTION

- Multi-model = existing workflow/subagent primitives；policy/workflow，NOT runtime subsystem
- Risk-aware policy replaces fixed role/model mapping
- Independent review prefers fresh context + provider/model diversity where justified
- Same-model replicas ≠ independent
- Multi-model outputs findings/evidence，never authority
- Browser verification = 唯一当前 justified 的新 production capability（继承 fork tool-browser contract）
- Archify = existing capability；preview = product policy（默认关），非缺失
- effort/maxTokens = DEFER pending benchmark
- automatic destructive repair = BLOCKED

## IMPLEMENTATION ORDER

1. zero-code multi-model review policy prototype（STEP 1）
2. 6 arms × 7 tasks reliability/cost benchmark
3. freeze Multi-Model Execution Policy from benchmark evidence
4. browser verification MVP
5. browser evidence integration
6. reconsider effort/maxTokens only if benchmark/runtime evidence justifies

## NON-GOALS（DO NOT REINTRODUCE WITHOUT NEW EVIDENCE）

MultiModelOrchestrator / RoleOrchestrator / ModelRouter / AgentGraph / ReviewDecision /
JudgeResult / BrowserVerificationPort（redundant parallel abstraction）/ BrowserEvidenceStore /
VisualRouter / ArchifyRuntime / LearningEngine / fixed three-model review /
automatic destructive repair loop

重新引入必须提供：NEW VERIFIED EVIDENCE + UNSATISFIED INVARIANT +
WHY EXISTING PRIMITIVES CANNOT CARRY IT。否则 DO NOT ADD。

## EXECUTION STATE

```
LAST COMPLETED STEP = W1–W4 可用能力闭环（FINAL FRESH RE-VERIFICATION = PASS，15 findings 全答 20 攻击问）
CURRENT STEP        = CLOSED
NEXT STEP           = NONE（FUTURE CHANGES = EVIDENCE-TRIGGERED）
POLICY ARTIFACT     = .agent/MULTI-MODEL-EXECUTION-POLICY.md（canonical）
W2 资产             = .agents/skills/multi-model-review/SKILL.md（canonical 脚本，5 轮独立 review 收敛）
W3 产物             = .agent/artifacts/archify/{multi-model-policy,browser,frontier}.html（deliver + visual-check 全视口 PASS）
W4 记录             = .agent/reports/w4-visual-dogfood.md（TP 1 / FP 1 / UNCERTAIN 1 / 诚实 PASS 1）
RAW REPORTS         = .agent/reports/benchmark-raw-t{1..7}.md（IMMUTABLE）
```

## ACTIVATED WORKSTREAMS（2026-09-05 用户批准方向，暂未实施）

```
W1 视觉/浏览器   = DONE：click/fill/viewport + screenshot 持久 attachment + UI 缩略图预览
                 （tool.call.screenshot slot 复用 MessageImages，assembled e2e 实证）
W2 多模型落地   = DONE：multi-model-review 技能 + canonical 脚本（security floor/gate 前置/
                 aggregate 不擦 FAIL/cross-provider 强制/retry≤1）+ 真实 dogfood 5 case
W3 Archify      = DONE：三张真实产物（政策路由/浏览器架构/frontier）+ visual-check 全视口 PASS
                 + vision 模型实证渲染；PR 强制带图规则未启用（推荐：architecture/
                 跨包生命周期/authority-证据流/复杂拓扑类变更值得；typo/孤立修复不值得）
W4 视觉验证     = DONE_WITH_LIMITATIONS：真实截图→真实 vision 路由→结构化 findings；
                 TP/FP/UNCERTAIN 纪律 + 确定性证据优先实证；limitation = vision 输出
                 冗长致截断（describe_image 自由文本通道无 schema 约束）
```

## DECISION DELTAS

```
1. DATE=2026-09-05 / OLD=T6 gold=PASS（陷阱）/ NEW=REPO-GATE SENSITIVITY，gold=FAIL /
   EVIDENCE=.oxlintrc.json no-unnecessary-condition:error + types.ts:136 / REASON=确定性验证
2. DATE=2026-09-05 / OLD=prototype CRITICAL=单 strong fresh / NEW=CRITICAL=HIGH 拓扑+gate+权威门 /
   EVIDENCE=F 单 pro 漏 T2/T5（2/7）/ REASON=单 strong reviewer 可靠性不足
3. DATE=2026-09-05 / OLD=prototype MEDIUM escalation 可为同模 strong / NEW=escalation 强制
   cross-provider / EVIDENCE=T2-A 同模 strong 擦除正确 finding；C 零增量；E 唯一检出 T2 /
   REASON=同模复核有害或冗余，cross-provider 有 corrective 证据
4. DATE=2026-09-05 / checkpoint 前版「runner args 缺陷 3 次（0 成本）」修正 / NEW=T5 首批
   烧掉 10 agent calls（结果 unrecoverable），T6/T7 两次 0 成本 / EVIDENCE=materializeResult
   在脚本执行后失败 / REASON=成本账目精确化
5. DATE=2026-09-05 / OLD=click/fill = DEFER（无 DOM 变更需求）/ NEW=UN-DEFER，随 W1 实施 /
   EVIDENCE=用户明确需求「更好的操控浏览器」/ REASON=新证据解除 defer；
   实施时同步 Agent Note 与 README（Known Limitations 条目更新）
6. DATE=2026-09-05 / OLD=Archify「已有能力，preview 默认关，不动」/ NEW=激活使用（W3）/
   EVIDENCE=用户明确要求「工程化技能包运用上」/ REASON=需求即证据；流程化规则待另行拍板
7. DATE=2026-09-05 / OLD=多模型政策 = 文档约定，执行靠调用方 / NEW=W2 封装为可复用
   workflow 脚本（仍零 runtime）/ EVIDENCE=用户「善用 harness 既有功能」/
   REASON=政策落地成可用工具，不改变权威边界与非目标
```

## FROZEN POLICY

```
FROZEN      = LOW / MEDIUM / HIGH（细节见 MULTI-MODEL-EXECUTION-POLICY.md）
PROVISIONAL = CRITICAL
effort/maxTokens = KEEP_DEFERRED
```

## BROWSER MVP FACTS（Step 4+5 产出）

```
package        = packages/web/tool-browser（opt-in，无发布预设启用）
actions        = goto（expect_text 断言）/ read_text（maxTextChars 有界+truncated）/ screenshot / close / list
taxonomy       = PASS / PRODUCT_FAILURE / INFRA_FAILURE / POLICY_FAILURE（结构化结果，不抛工具错误）
security       = http(s) 含重定向终态 + 凭据拒绝 + 截图名单文件名受限 + 目录 0o700/文件 0o600
lifecycle      = session 拥有页面；会话销毁/插件卸载/close/策略拒绝终态 → 关闭
evidence       = 每次尝试一条 browser/verify 事件（紧凑记录，不含页面文本）；
                 browserVerify 投影 = 当前 turn 最新证据（turn/start 清零，持久历史在日志）；
                 消费 = 现有 review/approval/M6 读日志/投影；零新权威、零 store、零 judge
tests          = 110/110（policy/manager/stub 全分类 + 投影/HMR/证据端到端 + 真实 Chromium 冒烟 6 例）
gates          = 100% coverage（含 branches）、oxlint 0 错误、tsc -b host 通过、test:docs 15/15、
                 verify-tool-catalog ✓、verify-agent-note-format ✓
snapshot 场景  = 随首次在发布预设中启用插件的变更落地（Agent Note 已记录）
```

## BENCHMARK LIMITATIONS（进入 Step 3 前必读）

```
n=42，4/7 任务有限制/重分类 → tier 结论非精确率
T2/T3 wall_ms 未持久化 → latency n=5
T6 陷阱失效 → 无 false-positive-resistance 数据
T5 attribution 无唯一正解 → security 检出率是方向性的
claude 成本未计价；per-call 成本 = 日级均价（含非 benchmark）
```

## 废弃文档标记

.agent/ 下以下文件是早期被多轮审计推翻的旧计划，非权威，勿引用为当前计划：
EXECUTIVE_SUMMARY.md / PERSONALIZATION_STRATEGY.md / TECHNICAL_ASSESSMENT.md /
IMPLEMENTATION_CHECKLIST.md / README_PLAN.md / WORKFLOW_SUMMARY.md /
harness-workflow-guide.md / workflow-*.json
