# BENCHMARK RAW RESULTS — T2（medium-implementation: session title updater）

gold_truth: ①空标题 guard 未 trim（空格绕过——**解释有争议**）；②`session?.header` 后 `session` 未收窄 → TS18048 编译错（**真实缺陷**）
run_time: 2026-09-05

| arm | verdict | escalated | strong/scout | TS18048 检出? | 备注 |
|---|---|---|---|---|---|
| B (single-Pro) | PASS | null | — | ✗ | MEDIUM conf，只提 trim warning |
| E (Flash+claude) | scout=PASS / strong=FAIL | MISSING_EVIDENCE | **claude 检出 blocker** | **✓（claude，tsc 实测验证）** | claude 声称跑 tsc 复现 TS18048 |
| A (single-Flash) | FAIL | MISSING_EVIDENCE | strong=**PASS（反转！）** | ✓（flash warning）→ strong 复核判 PASS | **strong 复核反而漏检** |
| C (Flash×2) | scout=PASS / strong=PASS | MISSING_EVIDENCE | — | ✗ 双双漏检 | same-model 复制零增量 |
| F (strong-Pro) | PASS | null | — | ✗ | 未检出 |
| D (Flash→Pro) | FAIL | MISSING_EVIDENCE | strong=PASS | ✗（检出的是 trim 争议项） | 未检出 TS18048 |

## 关键观察（frontier 数据）

1. **真实缺陷（TS18048）检出率 2/6 arms**——中等难度任务开始区分 topology。
2. **claude（cross-provider）是唯一 blocker 级检出 + 实证验证的 arm**——cross-provider 在困难任务上提供显著增量价值。
3. **same-model 复制（C）零增量**：两个 flash fresh 实例结论一致（都 PASS 漏检），与 T1 表现不同。
4. **strong 复核可能反转正确判断**：A 的 flash 检出 TS18048 → strong flash 复核判 PASS。escalation 不保证质量单调。
5. **gold truth ①（trim）有解释争议**：多个 reviewer 正确指出「按字面 requirement（empty=length 0）满足」——任务集 gold truth ① 的措辞缺陷，分析阶段降权，不作为 miss 计分。
6. **MISSING_EVIDENCE trigger 高频触发**：evidence_complete=false 在复杂任务普遍（reviewer 因看不到 Session 类型定义而自标 incomplete）——该 trigger 语义需要分析阶段审视。

## 完整 finding 证据

会话 workflow 输出（T2 batch）保留全文；关键证据：E-claude 的 TS18048 复现声明（tsc 6.0.3 --strict）、A/D 的 header-optional 讨论。
