# MULTI-MODEL EXECUTION POLICY（canonical，frozen 2026-09-05）

> 本文件 = 多模型执行政策的唯一 canonical artifact。
> 依据 = `.agent/reports/step2c-benchmark-analysis.md`（STEP 2c = PASS_WITH_LIMITATIONS，freeze gate = PARTIAL）。
> 本政策是 workflow/policy 层决策，不是 runtime subsystem。production runtime delta = 0。

## STATUS

```
FROZEN:      LOW / MEDIUM / HIGH
PROVISIONAL: CRITICAL
effort/maxTokens = KEEP_DEFERRED
```

## SCOPE

- 适用：本仓库内需要「模型 review」的变更/任务的执行拓扑选择。
- 角色（capability，非固定模型名）：`cheap reviewer`（低成本/低延迟）、`strong reviewer`（高能力）、`cross-provider reviewer`（与同 review 单元内另一 reviewer 不同 provider family）、`fresh context`（无前置历史的全新子代理）。
- 具体 provider/model 映射 = 调用方配置。Flash/Pro/Claude/Codex 等名字不是政策的一部分，模型换版不得触发政策修订。
- risk 输入 = 显式 task metadata / workflow 输入；无可靠输入时 default = MEDIUM。

## CORE INVARIANTS

1. Deterministic gates own deterministic/mechanical correctness.
2. Model review produces findings/evidence，never authority.
3. Same-model replication is NOT a default reliability mechanism.
4. Fresh context is preferred for independent review.
5. Provider diversity is used only where semantic independence is materially useful.
6. Escalation must be evidence/trigger-driven，not "always use more models".
7. Security/authorization/authority-sensitive work must not fall through normal LOW/MEDIUM defaults.
8. effort/maxTokens remains deferred.

## RISK ROUTING

```
LOW      = 1 cheap fresh reviewer + mandatory deterministic gate（test/typecheck/lint as applicable）
           gate 失败 → 返回失败/evidence；不得为「重新裁决 gate」而调用模型 escalation。
           仅适用于 correctness 基本由确定性验证覆盖的工作。

MEDIUM   = 1 cheap fresh reviewer → 评估 escalation triggers → 若触发：
           1 strong CROSS-PROVIDER fresh reviewer。
           cheap → same-provider strong 不得作为首选 escalation 路线
          （cross-provider 可用时）。escalation 保持条件触发。

HIGH     = parallel：cheap fresh scout + strong cross-provider fresh reviewer
           + mandatory deterministic gates（适用处）。
           两 reviewer 不投票：产出 findings / evidence / uncertainty，
           由现有确定性 authority 消费。disagreement = 需解决的证据，不是 majority vote。

CRITICAL = PROVISIONAL。当前保守政策：
           HIGH topology + mandatory deterministic gates
           + 现有权威审批/judge 边界（M6 / human，仅限原本已要求的路径）。
           单 strong reviewer 作为 CRITICAL 政策 = 不充分。
           无新证据不得增加 reviewer 数量或共识机制。
```

## ESCALATION TRIGGERS（deterministic，第一版 7 个）

```
REVIEW_DISAGREEMENT   （多 reviewer verdict 不一致）
MISSING_EVIDENCE      （evidence_complete === false）
TEST_FAILURE          （deterministic 验证门失败）
HIGH_BLAST_RADIUS     （cross-package / schema / protocol 变更）
SECURITY_SENSITIVE    （显式标记）
AUTHORITY_CHANGE      （authority/protocol/persistence 变更）
REVIEWER_UNCERTAIN    （verdict === UNCERTAIN 或 confidence === LOW）
```

每次 escalation 记录稳定 reason。MEDIUM 路由对「cheap verdict = FAIL」的升级使用稳定路由标签 `VERDICT_FAIL`（路由规则，非上面 7 个证据触发器之一）；reviewer 自己的 escalation_reason 文本只作为证据字段记录，不作为 trigger。`agent()` 返回 null（reviewer 不可用）由 `*_unavailable` 字段记录，不作为 escalation trigger。

## SECURITY / AUTHORIZATION OVERRIDE

```
SECURITY_SENSITIVE / AUTHORIZATION / SANDBOX AUTHORITY /
PERSISTENCE AUTHORITY / PROMOTION-ACTIVATION AUTHORITY
→ minimum risk = HIGH；CRITICAL 当现有项目权威分类要求时。
不得静默落入 LOW 默认档。
```

标记：DIRECTIONAL but conservative（T5 是 benchmark 最弱类别：gap recognition 6/6，attribution 1-2/6）。

## DETERMINISTIC GATES

```
lint / typecheck / unit-integration tests / schema validation / known protocol checks
不得被模型意见替代。
确定性证据与 reviewer 输出冲突时：deterministic evidence wins
（前提：该检查 applicable 且 trustworthy）。
```

依据：T2（tsc 必挂 TS18048）/ T6（oxlint 必挂 no-unnecessary-condition）/ T7（tsc + validator 必挂）。

## BROWSER EVIDENCE

```
browser 工具（packages/web/tool-browser）的每个分类结果都是持久会话证据：
browser/verify 事件（action/outcome/url/title/truncated/text_length/screenshot_path/reason，
不含页面文本——文本留在 tool/result）。
投影 browserVerify = 当前 turn 最新一条证据（turn/start 清零；持久历史在会话日志）。
Review task 输入可携带 browser 证据（task.evidence 约定）；
reviewer 把它当 findings/evidence 消费，绝不作为 authority，不改变判定链。
无 store、无 judge、无第二套判定系统——消费者直接读会话日志/投影。
```

## FAILURE / RETRY

```
transient provider/transport failure：最多 1 次重试（现有 workflow 语义允许时）。
记录：initial failure / retry reason / retry result。
provider 失败不得静默替换 provider（不静默改变 topology）。
不新建 RetryEngine 或任何 runtime abstraction。
```

## AUTHORITY BOUNDARY（不变）

```
review models → findings/evidence → deterministic 聚合 → 现有 evidence/authority 链（M6 judge）
禁止：majority vote → activation；model confidence → authority；
2 reviewer PASS → authority。
strong verdict 不得覆盖 cheap verdict（T2-A 证据：同模复核可擦除正确 finding）。
```

## NON-GOALS

```
无 MultiModelOrchestrator / RoleOrchestrator / ModelRouter / ConsensusEngine /
EscalationEngine / ReviewRuntime / ReviewDecision authority type。
无 same-model replication 默认路由（primitive 保留，供实验/手动使用）。
无固定模型名政策。
无 effort/maxTokens 扩展。
```

## PROVISIONAL ITEMS

```
CRITICAL topology（缺 2-diverse-strong 专用观测；F 单 pro 漏 2/7 仅证「单 strong 不足」）
false-positive resistance（T6 陷阱失效 → 无有效数据；reclassified 为 repo-gate sensitivity）
security attribution 权重（T5 歧义 → DIRECTIONAL）
```

## EVIDENCE BASIS

```
STEP 2c analysis = PASS_WITH_LIMITATIONS：.agent/reports/step2c-benchmark-analysis.md
raw（IMMUTABLE）：.agent/reports/benchmark-raw-t{1..7}.md
design：.agent/step2-benchmark-protocol.md / .agent/step2-benchmark-tasks.md
原型：.agent/step1-review-policy-prototype.md（被本政策覆盖的差异见 PLAN-CHECKPOINT DECISION DELTAS）
```
