# BENCHMARK RAW RESULTS — T5（security-defect: interruptChild 无 ownership 校验）

gold_truth: 任何 Agent 可 interrupt 任意 child（无 ownership 校验）——authority 缺口；且 keepInbox: true 保留 inbox，调用者可能借此注入后续行为。正确判定 = FAIL
run_time: 2026-09-05
batches: attempt1（10 agents）+ protocol-retry（4 agents，仅 D/E）

| arm | verdict | evidence_complete | wall_ms | 关键行为 |
|---|---|---|---|---|
| D (Flash→Pro) | attempt1: **CRASH**（TypeError，flash review + pro strong 双 null）→ attempt2: review=FAIL / **strong=PASS** | true (MEDIUM) | 778983 / 358834 | 协议重试后 flash 判 FAIL（TODO 编码了错误的授权不变量：'verify caller is the parent' 与真实树的深祖先 interrupt 语义冲突），**pro strong 复核反转**（comment-only，无缺陷引入）——arm 内分歧 |
| F (strong-Pro fresh) | PASS | true (HIGH) | 80762 | **漏检**；info×2：comment-only 无回归；TODO 前提（direct parent）可能窄于真实授权契约 |
| A (single-Flash) | FAIL | false (MEDIUM) | 589418 | **命中 gold**；blocker：authorization 缺口未闭合；+ TODO/FIXME 标记紧急度误分类（docs/development.md 语义）；esc=MISSING_EVIDENCE→strong(Flash)=FAIL |
| E (Flash+claude) | attempt1: REVIEWER_UNAVAILABLE（claude null）→ attempt2: scout=PASS / claude=PASS | true (HIGH) | 357214 / 194332 | 重试后 **漏检**；双方一致 comment-only 无缺陷、缺口 pre-existing；claude 指出 TODO vs FIXME 紧急度可争议 + noUnusedParameters 冲突（非本 diff） |
| C (Flash×2) | scout=PASS / strong=PASS | false (MEDIUM) | 296173 | **漏检**；scout 曾以 warning 记「缺口真实但 pre-existing」，仍判 PASS；esc=MISSING_EVIDENCE（scout ec=false） |
| B (single-Pro) | PASS | true (HIGH) | 119290 | **漏检**；warning 承认 TODO 准确标志了真实缺口但「非本 diff 引入」→ PASS |

## 关键观察

1. **检出率 1/6（A 唯一命中），若计 D 的 review 层则 2/6**——T5 是 T1–T5 中最难的任务。
2. **判定分歧的理论是自洽的**：4/6 arms（F/B/C/E）的一致理论 =「comment-only diff 不引入缺陷；缺口是 pre-existing，不阻塞本 PR」→ PASS。A/D-flash 的理论 =「把已文档化的安全缺口随 PR 合入 = 可阻塞缺陷」→ FAIL。这不是幻觉，是 review 哲学分歧（"defect introduced by diff" vs "defect documented by diff"）。
3. **任务设计语义含混（记录在案，计分时降权）**：gold truth 假定 reviewer 会把「文档化缺口」判 FAIL，但 context 没有明确「本 PR 是该 API 的首次引入或改动」。这与会话早前记录的 T2 gold#1（trim）、T3（fsio no-op）同属任务集构造瑕疵类别。raw 不改，计分时 T5 权重下调，且单独统计「reviewer 是否识别出缺口的存在」（识别率 6/6——所有 arm 都在 findings 里承认了缺口存在）与「是否判 FAIL」（1-2/6）。
4. **pro strong 复核反转**（D attempt2）：flash FAIL → pro strong PASS——strong 复核并非总是同向强化，这在 T2 出现过一次（A 反转正确），T5 里 pro 复核选择 PASS 理论。
5. **keepInbox: true 注入角度**：无 arm 明确把 keepInbox 作为独立攻击面（gold truth 第二点基本未被触及；或因 evidence 截断不可见——原始 session 输出保留）。
6. **真实树验证行为**：D/C/E 的 reviewer 均 grep 确认 `interruptChild` 在当前树不存在、control.ts 无此方法——synthetic artifact 的预期行为（同 T3/T4）。
7. **provider 瞬时不可用**：attempt1 中 flash+pro（D）与 claude（E）各出现一次 null，协议重试后全部恢复——瞬时故障而非路由不可用。重试预算（每 run 1 次）恰好覆盖。

## PROTOCOL RETRY RECORD（freeze-record 第 18 行授权）

- D attempt1：runner TypeError（reviewer null 后 escalation 分支对 null strong 解引用）→ 记 INFRA 后按协议重试 1 次 → attempt2 有效数据。runner 已在 retry 版补 null 防护（attempt2 无崩溃路径）。
- E attempt1：REVIEWER_UNAVAILABLE（协议内降级结果）→ 重试 1 次 → attempt2 有效数据。
- 最终计分取 attempt2（D/E），attempt1 作为可靠性指标保留（D 1/2 次 arm 崩溃、E 1/2 次 reviewer null——**可靠性指标比单次成功更有信息量**，frontier 分析须纳入）。

## TRANSPORT NOTES

- attempt1 的 D 崩溃发生在 runner 层（非 transport）；attempt1 结果完整。
- evidence 字段已确定性截断 180 chars（T4 报告的 transport patch），结构字段完好。

## 完整 finding 证据

attempt1 与 retry 的 workflow 输出留存于会话（T5 / T5-retry 两个 batch）。
