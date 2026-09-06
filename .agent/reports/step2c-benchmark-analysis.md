# STEP 2c — BENCHMARK ANALYSIS（validity → scoring → frontier → policy）

> raw evidence IMMUTABLE；本轮只改 scoring interpretation / validity / weight。
> packages/ delta = 0。
> run: 2026-09-05。数据源：benchmark-raw-t{1..7}.md + workflow 会话输出 + ~/.dsh/dsh-usage/usage-ledger.json（2026-09-05）+ 确定性 repo 验证。

## 1. TASK VALIDITY AUDIT

| task | original intent | observed flaw | flaw affects arm comparison? | flaw affects absolute scoring? | classification | weight | reason |
|---|---|---|---|---|---|---|---|
| T1 | simple-bug off-by-one | 无 | — | — | VALID | 1.0 | 6/6 一致正确 |
| T2 | 2 defects | gold#1（trim）解释歧义：按字面 requirement 满足 | 否（各 arm 同受影响） | 是（gold#1 不可计 miss） | VALID_WITH_LIMITATION | 0.6 | 只对 gold#2（TS18048，tsc 实证真实缺陷）计 verdict/detection；gold#1 不计 |
| T3 | architecture-sensitive（跨包未同步） | fsio hunk 实为 no-op（构造瑕疵）；真实缺陷所在调用点在 artifact 外 | 否 | 是（原类别不可测） | RECLASSIFIED | 0.5（单独维度） | 实际测到的是 uncertainty calibration / evidence discipline：6/6 拒绝 PASS；claude FAIL 有真实 ground（no-op hunk），defensible |
| T4 | test-gap | 无（claude 方向性争议是 beyond-gold 观点，非 flaw） | 否 | 否 | VALID | 1.0 | 6/6 FAIL 正确 |
| T5 | security-defect | introduced vs documented/pre-existing attribution 歧义 | 否 | 是（attribution 维度降权） | VALID_WITH_LIMITATION | 0.5（双维度：GAP_RECOGNITION 0.7 + ATTRIBUTION 0.3） | 缺口识别 6/6；attribution 无唯一正解，不计 FN |
| T6 | false-positive trap（gold=PASS） | gold truth 被确定性 repo 证据推翻：diff 真实挂 lint gate | 否 | 是（原 gold 作废） | RECLASSIFIED → REPO-GATE SENSITIVITY | 0.75（单独维度，新 gold=FAIL） | .oxlintrc.json typescript/no-unnecessary-condition:error 覆盖 packages/*/*/src + types.ts:136 inputTokens required |
| T7 | long-context 跨文件一致性 | 无；gold = minimum truth，额外 finding 需验证 | 否 | 否 | VALID | 1.0 | 6/6 FAIL 正确；额外 finding 已验证 3 项（见 §2） |

**T7 额外 finding 验证**（source evidence 已核对）：
- VALID EXTRA：`core/session/src/index.ts:108-111` validateSessionHeader 拒非 number createdAt（producer 自相矛盾）✓
- VALID EXTRA：`session-persistence/src/coordinator.ts:692` Number.isSafeInteger 硬拒 ✓
- VALID EXTRA：`acp/acp/src/index.ts:491` 第三个数值消费点 ✓
- UNVERIFIED（plausible）：SESSION_FORMAT_VERSION 政策原文行号、subagent list-children.ts:286、session-query corpus.ts:317（未逐行核对，不计入 gold 外计分）

## 2. SCORING

### 2a. VERDICT-LEVEL（unweighted，7 tasks）

| arm | T1 | T2 | T3 | T4 | T5 | T6 | T7 | correct |
|---|---|---|---|---|---|---|---|---|
| A single-Flash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **7/7** |
| D Flash→Pro | ✓ | ✓(wrong reason) | ✓ | ✓ | ✓(retry) | ✓ | ✓ | **7/7*** |
| E Flash+claude | ✓ | ✓ | ✓ | ✓ | ✗(attrib) | ✓ | ✓ | **6/7** |
| B single-Pro | ✓ | ✗ | ✓ | ✓ | ✗(attrib) | ✓ | ✓ | 5/7 |
| C Flash×2 | ✓ | ✗ | ✓ | ✓ | ✗(attrib) | ✓ | ✓ | 5/7 |
| F strong-Pro | ✓ | ✗ | ✓ | ✓ | ✗(attrib) | ✓ | ✓ | 5/7 |

*D：T2 的 FAIL verdict 基于歧义项 gold#1 而非真实缺陷；T5 需 crash-retry。

### 2b. DEFECT-DETECTION（gold 逐项）

- T2 gold#2（TS18048）检出：A（flash warning 级）、E（claude blocker，tsc 实证）＝ 2/6。B/C/D/F 漏检。
- T5 缺口识别：6/6（所有 arm 的 findings 均承认缺口存在）；attribution FAIL：A、D（review 层）＝ 2/6。
- T6 root-cause 深度：仅 D-strong 命中确切 lint gate（citation 已验证）＝ 1/6；其余 5 家以 dead-code/约定论证（同为有效 FAIL 依据，深度较浅）。

### 2c. VALIDITY-ADJUSTED（weights: T1 1.0, T2 0.6, T3 0.5, T4 1.0, T5 0.5(0.7/0.3), T6 0.75, T7 1.0；总分 5.35）

| arm | weighted correct | ratio | 排名层 |
|---|---|---|---|
| A | 5.35 | 1.00 | TIER-1 |
| D | 5.25 | 0.981 | TIER-1（operational 扣分另计） |
| E | 5.20 | 0.972 | TIER-1 |
| B / C / F | 4.60 | 0.860 | TIER-2 |

**UNWEIGHTED vs ADJUSTED 差异披露**：排名不变（A > D ≈ E > B=C=F）；差异在于 D 的 T2「verdict 对但 reason 错」与 T5 重试依赖在 adjusted 中显式，且 T2 gold#1 歧义不再计 miss。n=7 下 1 个任务翻转 ≈ 14pp——只做 tier 结论，不做精确排名。

## 3. ARM PROFILES

| 维度 | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Reliability（检测） | 7/7 | 5/7 | 5/7 | 5-6/7 | 6/7 | 5/7 |
| Evidence quality | MEDIUM（T3 空 evidence） | HIGH | MEDIUM | HIGH（T6 决定性 gate citation） | HIGH（claude tsc 实证） | HIGH |
| FP behavior | 无 FP | 无 | 无 | 无 | 无（T4 方向性观点 = beyond-gold 非 FP） | 无 |
| Uncertainty calibration | ✓（T3） | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cost（est，day-level 均价×确定调用数） | 0.042/obs（最低） | 0.137/obs | 0.042/obs | 0.116/obs | 0.042 flash + 1 claude/obs（claude 未计价） | 0.080/obs |
| Median latency（n=5 tasks，T2/T3 未持久化） | 274.5s | 214.9s | 168.5s | 301.5s（serial） | 170.8s（parallel） | 90.4s（最快） |
| Operational | 0 失败 | 0 失败 | 0 失败 | **1/7 arm 崩溃（flash+pro 双 null）→retry 恢复** | **1/7 claude null →retry 恢复** | 0 失败 |
| Signal | STRONG（cheap+同模 strong 拓扑） | DIRECTIONAL | DIRECTIONAL | DIRECTIONAL | DIRECTIONAL（corrective diversity 1 例） | DIRECTIONAL |

Cost 口径：per-obs = 每 task 估算成本。per-call 均价取自 usage-ledger 2026-09-05 全量日数据（flash ≈0.0210、pro ≈0.0801、claude 未计价）——含非 benchmark 活动，**granularity = estimated（day-level per-model × deterministic call count）**。真实货币成本仅 flash/pro 有 ledger 价。

## 4. TOPOLOGY-SPECIFIC FINDINGS

### 4a. Same-model replication（Arm C）— Q2
- 7/7 任务中**零次**第二个 fresh Flash 提供第一个未发现的正确 finding（T2 零增量、其余 5 次双方一致）。
- Shared misses：T2（双双漏 TS18048）、T5（双双 PASS）＝ correlated error 证据。
- **结论：same-model fresh replication 无增量可靠性，存在相关错误。Q2 = NO。**

### 4b. Cross-provider（Arm E）— Q3/Q6
- Unique correct finding：T2 claude 唯一 blocker（tsc 实证）；T3 claude 唯一检出 no-op hunk（真实构造瑕疵）。
- Corrective disagreement：1（T2）；Harmful disagreement：0；Shared error：T5 attribution（1）。
- Operational：1/7 claude null，retry 100% 恢复；parallel 拓扑下 E 中位延迟 ≈ C（170.8s vs 168.5s）＝ diversity 无延迟溢价。
- **结论：corrective diversity 证据 = 1 例（DIRECTIONAL），零有害分歧，值得保留在高风险档。Q3 = YES（directional）。Q6 = YES for HIGH/CRITICAL（含强制 retry）。**

### 4c. Cheap-first escalation（Arm D）— Q4
- escalation rate 7/7（defect-dense 任务集下 verdict=FAIL 总是触发）；strong_call_rate 7/7。
- Reversal 分类：CORRECTIVE 0 / HARMFUL 1（T5-attempt2 pro 复核将 FAIL 反转为 PASS——attribution 歧义，判 NEUTRAL-AMBIGUOUS）/ NEUTRAL-AMBIGUOUS 1。
- Corrective ENRICHMENT（同意但强模型补决定性证据）：T6（lint gate）＝ 1。
- 成本：D 0.116/obs vs B 0.137/obs（-15%），但 D 中位延迟 +86s、1 次崩溃。D vs F：0.116 vs 0.080，可靠性近似 → **F dominates D on reliability/cost**（本数据集）。
- **结论：savings 无法在 defect-dense 集体现（100% escalation）；escalation 有 1 次决定性增值（T6）与 1 次 ambiguous 反转。Q4 = INSUFFICIENT DATA for savings；机制保留但 strong 必须 cross-provider。**

### 4d. Escalation reversals 全表（cheap→strong verdict 变化）
- HARMFUL_REVERSAL：T2-A（flash strong 复核将正确的 TS18048 FAIL 反转为 PASS）——**同模 strong 复核会擦除正确 finding**。
- NEUTRAL/AMBIGUOUS：T2-D、T5-D。
- CORRECTIVE_REVERSAL：0。
- 政策含义：strong verdict 不得覆盖 cheap verdict；disagreement 必须路由到 evidence/deterministic gate，绝不 majority-vote（与 authority boundary 一致）。

### 4e. Deterministic gates = 真正的安全网
- T2 TS18048 → tsc 必挂；T6 lint → oxlint 必挂；T7 → tsc + validator 必挂。机械类缺陷的最终防线是 gate 而非 reviewer。
- Reviewer 层不可替代的价值只在 gate 不可达类：T4 test-gap（coverage gate 可达，但语义 gap 需 review）、T5 authorization（gate 完全不可达，唯一依赖 review，而检出率 1-2/6——**本 benchmark 最危险的一格**）。

## 5. OPERATIONAL RELIABILITY

- 首试 agent null：3/≈79 calls（D-T5 flash+pro、E-T5 claude；其中 D 属 runner 解引用崩溃）≈ 3.8%。
- Retry recovery：2/2 arms 1 次重试恢复（100%）；final completion 42/42 arm-observations。
- claude first-attempt 可用率 6/7（85.7%）→ HIGH/CRITICAL 用 claude 必须内建 retry。
- Benchmark infra 缺陷（不计模型可靠性）：runner args 形状错误 3 次——T5 首批烧掉 10 agent calls（结果 unrecoverable，est 成本 ≈0.4-0.5）；T6/T7 两次 0 成本。raw 报告已记。

## 6. FRONTIER

```
RELIABILITY × COST:        A（0.042, 7/7）为唯一 frontier；E 邻近（claude 未计价）。
                           C 被 A 同价支配；B 被 F/D 支配；F 被 A 支配（更贵且 5/7）。
RELIABILITY × LATENCY:     E（170s parallel, 6/7）与 F（90s, 5/7）在 frontier；
                           A（274s, 7/7）以 latency 换 reliability。
RELIABILITY × OPERATIONAL: A（单 provider、零失败）frontier；
                           E 引入 provider 依赖 + 1 retry；D 引入 serial + 崩溃风险。
```

## 7. Q1–Q7

| Q | ANSWER | SIGNAL | EVIDENCE |
|---|---|---|---|
| Q1 single cheap sufficient for LOW? | YES（仅 gate 可覆盖的机械/简单类） | STRONG | T1/T6/T7 机械缺陷 cheap 或 gate 全覆盖；但 T5 类（authorization）gate 不可达且 cheap 检出 1/6 |
| Q2 same-model replication worth cost? | NO | STRONG | 零增量 + 2 shared misses（T2/T5） |
| Q3 cross-provider corrective diversity? | YES | DIRECTIONAL | T2 claude 唯一检出；0 harmful disagreements |
| Q4 cheap-first ≈ strong reliability with lower cost? | INSUFFICIENT DATA（savings）；机制保留 | INSUFFICIENT | 100% escalation；1 决定性增值 vs 1 ambiguous 反转 |
| Q5 which classes bypass cheap-first? | SECURITY_SENSITIVE、cross-package multi-defect、repo-gate 敏感类 | DIRECTIONAL | T5（检出 1-2/6）、T2（2/6）、T6（root-cause 1/6） |
| Q6 provider diversity worth complexity? | YES for HIGH/CRITICAL（+强制 retry） | DIRECTIONAL | T2 增值；1/7 null；claude 成本未计价 |
| Q7 effort/maxTokens now justified? | KEEP_DEFERRED | INSUFFICIENT | 无预算控制对比数据；深度证据（D-strong T6）不改变 verdict 级可靠性 |

## 8. RISK POLICY CANDIDATE（evidence-driven，可推翻 prototype）

```
LOW      = 1 cheap fresh reviewer + 强制 deterministic gate（test/typecheck/lint）
           → FAIL 只路由到 gate 复跑，不做模型 escalation（T2-A 证明同模复核有害）
MEDIUM   = 1 cheap fresh reviewer → escalation triggers → strong CROSS-PROVIDER reviewer
           （同模 escalation 零增量+有害反转；cross-provider 有 T2 增值）
HIGH     = parallel：cheap scout + strong cross-provider（fresh）——E 拓扑
           （parallel 无延迟溢价；T2 增值证据）
CRITICAL = HIGH 拓扑 + 强制 gate + 权威门（M6/human）；单 strong reviewer 不足（F 漏 2/7）
           ——PROVISIONAL（无 2-diverse-strong 专用数据）
risk 输入 = 显式 metadata；无输入 default=MEDIUM（不变）
```

## 9. FREEZE GATE

```
ENOUGH EVIDENCE TO FREEZE = PARTIAL
  FROZEN:      LOW / MEDIUM / HIGH 拓扑（conservative default）
  PROVISIONAL: CRITICAL（缺 2-diverse-strong 观测）
  NOT BLOCKED: T5 类（authorization）必须显式 SECURITY_SENSITIVE → HIGH/CRITICAL，
               不得落入 LOW/MEDIUM 默认档——这是本次 benchmark 最危险的单一格。
```

## 10. LIMITATIONS（永久记录）

1. n=42 arm-observations，4/7 任务有限制/重分类——所有结论按 tier 而非精确率。
2. T2/T3 的 wall_ms 未持久化进 raw 报告（收集期疏漏），latency 统计 n=5 tasks。
3. T6 原陷阱失效 → **本 benchmark 无有效 false-positive-resistance 数据**。
4. T5 attribution 无唯一正解 → security 档检出率结论是方向性的。
5. claude 成本 ledger 未计价；per-call 成本是日级均价（含非 benchmark 活动）。
6. synthetic 任务集的仓库核对行为（reviewer grep 真实树）是稳定的行为证据，但任务内容本身是构造的。
7. 模型名是 args 占位，无「X 模型最好」结论。
