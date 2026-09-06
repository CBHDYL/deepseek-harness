# BENCHMARK RAW RESULTS — T1（simple-bug: bounded-buffer off-by-one）

gold_truth: 1 off-by-one（`>` 应为 `>=`，容量 8 → 稳态 9）
run_time: 2026-09-05

| arm | ok | verdict | escalated | strong/scout verdict | findings | confidence | evidence_complete | wall_ms | correct? |
|---|---|---|---|---|---|---|---|---|---|
| C | ✓ | — | null | scout=FAIL strong=FAIL | 2/3 | HIGH | true | 26076 | ✓（scout+strong 均检出） |
| A | ✓ | FAIL | TEST_FAILURE(FAIL 复核) | strong=FAIL | 1 | HIGH | true | 34659 | ✓ |
| F | ✓ | FAIL | REAL_DEFECT(escalation_reason 非枚举) | — | 1 | HIGH | true | 32760 | ✓ |
| D | ✓ | FAIL | TEST_FAILURE(FAIL 复核) | strong=FAIL | 1 | HIGH | true | 33910 | ✓ |
| B | ✓ | FAIL | TEST_FAILURE(FAIL 复核) | strong=FAIL | 1 | HIGH | true | 37001 | ✓ |
| E | ✓ | — | null | scout=FAIL strong=FAIL(claude) | 2/3 | HIGH | true | 16347 | ✓ |

## 观察（分析阶段使用）

1. **全部 6 arms 检出**：T1 是简单任务，所有 topology 都正确（0 miss）。
2. **A/B/D 的 escalated 行为**：prototype MEDIUM 分支内建「verdict=FAIL → strong 复核」，reason 标签记 'TEST_FAILURE' 是 alias，实际语义 = FAIL_REVIEW（非 benchmark trigger）。该行为在冻结的 prototype 中一致存在，数据可比。
3. **F 的 escalation_reason 异常**：CRITICAL 分支的 reviewer 返回了自然语言 reason（非 7 枚举），暴露出 schema 的 escalation_reason 无 enum 约束——分析阶段记录，不中断。
4. **claude（E strong）与 flash 结论一致**：cross-provider 在简单任务上与 cheap 模型完全一致。

## 完整 finding 证据

各 arm 的 finding claim/evidence 全文见会话 workflow 输出（T1 batch），关键证据链一致：`8 > 8 = false → push → length 9 → 稳态 capacity+1`。
