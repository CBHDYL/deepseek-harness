# BENCHMARK RAW RESULTS — T6（false-positive trap: 防御性 ?? 0 不对称）— GOLD TRUTH 被确定性证据推翻

gold_truth（原设计）: 0 缺陷，正确判定 = PASS（`?? 0` 防御性但无害；不对称不是 bug）
**gold_truth（验证后）: 设计无效——diff 真实违反本仓库 lint gate，正确判定实为 FAIL**
run_time: 2026-09-05
batch: 11 agents

| arm | verdict | evidence_complete | wall_ms | 关键行为 |
|---|---|---|---|---|
| E (Flash+claude) | scout=FAIL / claude=FAIL | true (HIGH) | 170768 | 双方一致：dead code + 不对称；claude 明确写「无运行时回归，缺陷是 dead code/standards 层面」仍判 FAIL；esc=MISSING_EVIDENCE |
| A (single-Flash) | FAIL | true (HIGH) | 196498 | 一致；3 findings（dead code/不对称/无回归但违标准）；strong(Flash)=FAIL；esc=TEST_FAILURE |
| D (Flash→Pro) | FAIL | true (HIGH) | 367153 | **strong(Pro) 出 blocker：`.oxlintrc.json:152-166` `typescript/no-unnecessary-condition: error` 覆盖 packages/*/*/src → lint gate 挂**（citation 经确定性验证为真） |
| F (strong-Pro fresh) | FAIL | true (HIGH) | 90417 | 3 findings 含行为论：旧代码 NaN（loud），新代码静默 0（mask 上游 bug，违 fails-loud 原则） |
| B (single-Pro) | FAIL | true (HIGH) | 214894 | 一致；引用 AGENTS.md typed-boundary 规则原文；esc=TEST_FAILURE |
| C (Flash×2) | scout=FAIL / strong=FAIL | true (MEDIUM) | 78141 | 一致；最快 arm；无 escalation |

## 关键观察

1. **6/6 arms 全部 FAIL**——原设计预期这是 false-positive 陷阱（正确=PASS），实际全军 FAIL。
2. **但 FAIL 是正确判定**：确定性验证证明 T6 diff 在本仓库真实挂 lint gate：
   - `.oxlintrc.json` override 块（files: `packages/*/*/src/**/*.{ts,tsx}` 等）→ `typescript/no-unnecessary-condition: ["error", {...}]`；
   - `packages/llm/llm/src/types.ts:136` → `inputTokens: number`（required，非 nullable）；
   - `p.inputTokens ?? 0` 对非 nullable 字段做空值判断 = 该规则定义的目标模式 → `pnpm run lint` 失败 = 真实 CI gate 缺陷。
3. **陷阱设计无效（task-design flaw #4）**：gold truth 只考虑了「运行时行为无变化」，忽略了本仓库显式的 lint 规则 + AGENTS.md「Trust TypeScript at typed same-process boundaries」+「Prefer symmetry」+「fails loud」三条约定全部指向 FAIL。context 甚至已明示「类型仍是 required」——reviewer 仍一致判 FAIL，且理由全部落在真实仓库约定上，**无一基于幻觉规则**。
4. **T6 从「false-positive 抵抗性」重分类为「仓库 gate 敏感度」任务**：计分时不按原 gold truth（PASS）计错，而按验证后的正确判定（FAIL）计——6/6 正确。D-strong 的 citation（文件/行号/规则名）经独立验证完全准确。
5. **对照价值**：T6 意外验证了「reviewer 会读真实仓库 gate 而非仅看 diff 语义」——与 T3/T4 中 reviewer 对真实树做 grep 验证的行为一致。frontier 分析可保留该结论，但 T6 不再作为陷阱数据点。
6. **行为论多样性**：F 提出「NaN→0 静默化」的 fails-loud 视角；D-strong 提出 lint 视角；A/E 坚持 standards 视角——同一 FAIL 有 3 条独立论证路径。

## DECISION DELTA（确定性证据推翻 gold truth）

- DATE=2026-09-05 / OLD=T6 gold_truth=PASS（0 缺陷）/ NEW=T6 gold_truth=FAIL（lint gate 缺陷），陷阱作废 / EVIDENCE=.oxlintrc.json override 块 + types.ts:136 确定性验证 / REASON=任务设计时只验证运行时语义，未核对仓库 lint 规则；raw 不改，计分按 NEW。
- 同类 task-design flaws 累计：T2 gold#1（trim 歧义）、T3（fsio no-op hunk）、T5（introduced vs documented 歧义）、T6（gold truth 无效）——T1/T4 干净。frontier 分析须按任务降权/重分类执行，并记录「synthetic 任务集构造质量」为本次 benchmark 的系统性局限。

## 完整 finding 证据

workflow 输出（T6 batch）留存于会话；本文件表格为决定性摘要。
