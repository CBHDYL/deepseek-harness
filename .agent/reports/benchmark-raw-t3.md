# BENCHMARK RAW RESULTS — T3（architecture-sensitive: narrowed encoding union）

gold_truth: tool-fs 的 'base64' 调用点未同步（编译错风险；且 fsio hunk 实为 no-op——任务集构造瑕疵被所有 reviewer 独立发现）
run_time: 2026-09-05

| arm | verdict | evidence_complete | 关键行为 |
|---|---|---|---|
| F (strong-Pro) | UNCERTAIN | false | 检出 no-op hunk + tool-fs 缺失 + union 收窄 12→3 值 |
| C (Flash×2) | scout=UNCERTAIN / strong=UNCERTAIN | false | 双双正确要求证据；grep 验证 artifact 在真实仓库不存在 |
| B (single-Pro) | UNCERTAIN | false | 正确；指出 Node BufferEncoding 含 12 值 |
| A (single-Flash) | UNCERTAIN | false | 正确；evidence 为空字符串（findings evidence 缺失——schema 允许空串） |
| D (Flash→Pro) | UNCERTAIN | false | 正确；strong 复核一致 |
| E (Flash+claude) | scout=UNCERTAIN / strong=**FAIL** | false | **claude 检出 blocker**（no-op hunk + alias 不对称 'utf8' vs 'utf-16le'） |

## 关键观察

1. **全部 6 arms 正确拒判 PASS**——evidence-incomplete 型任务，无 arm 猜测（0 false PASS）。
2. **reviewer 自主做了真实验证**：F/C/A/D/E 的 reviewer 声称 grep 仓库、核对 @types/node buffer.d.ts、甚至 node 运行时探针（Buffer.isEncoding）——高质量行为，非空泛评论。
3. **claude 连续 3 任务表现突出**（T2 检出 TS18048、T3 检出 blocker）——cross-provider 增量价值累积证据。
4. **任务集构造瑕疵被所有 arm 发现**：fsio no-op hunk 意外成为检错目标，证明 reviewer 精细度，但也意味着 T3 的 gold truth 计分需降权（artifact 本身有缺陷）。
5. evidence_complete=false 在全部 arm 一致——MISSING_EVIDENCE trigger 在复杂任务高频。

## 完整 finding 证据

会话 workflow 输出（T3 batch）保留全文。
