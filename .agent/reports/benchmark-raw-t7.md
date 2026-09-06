# BENCHMARK RAW RESULTS — T7（long-context: createdAt epoch→ISO string 跨文件一致性断裂）

gold_truth: session-persistence-jsonl 的 Number(header.createdAt) 对 ISO string 得 NaN（排序/seq 断裂）；session-title-llm 的 age 比较混用 ISO string 与 epoch number——1 个跨文件一致性问题（两处表现）。正确判定 = FAIL
run_time: 2026-09-05
batch: 11 agents

| arm | verdict | evidence_complete | wall_ms | 关键行为 |
|---|---|---|---|---|
| A (single-Flash) | FAIL | true (HIGH) | 274521 | 正确；6 findings 含 4 blocker：**本仓库自己的 validator（core/session/index.ts:108-111）会拒掉 ISO string 创建**——producer 自相矛盾；coordinator.ts:692 硬拒；format.ts TS2322；SESSION_FORMAT_VERSION 未 bump；+ 第 6 个消费点（session-log-deepseek wireHeader） |
| C (Flash×2) | scout=FAIL / strong=FAIL | true (HIGH) | 168473 | 正确；scout 4 + strong 4 findings；scout 挖出 list-children.ts:286 的 `a.header.createdAt - b.header.createdAt` 算术消费点 |
| E (Flash+claude) | scout=FAIL / claude=FAIL | false (HIGH) | 145005 | 正确；claude 3 blocker 直击两个未改消费点 + 声明「不完整改动」；scout 6 findings 指出 artifact 注释本身不准确（format.ts 无 Number() 调用，是直接类型赋值+数字守卫） |
| B (single-Pro) | FAIL | true (HIGH) | 229479 | 正确；3 findings + strong 3（**strong 用中文写 findings**——评审语言漂移，不影响判定）；esc=富文本理由（给出 Date.parse 修复路径） |
| F (strong-Pro fresh) | FAIL | true (HIGH) | 157153 | 正确；5 findings：两消费点 + coordinator.ts 硬拒 + format-version 未 bump + 路径不存在；给出 TS2362/2365 具体错误码 |
| D (Flash→Pro) | FAIL | false (HIGH) | 241944 | 正确；5 + 4 findings；指出「context 声称只有两个消费文件不可信」，grep 证明消费面更大 |

## 关键观察

1. **6/6 arms 全部 FAIL = 6/6 命中 gold truth**——T7 是 T1–T7 中与 T4 并列检出率最高的任务（T1 6/6、T4 6/6、T7 6/6）。
2. **reviewer 挖出的缺陷层次远超 gold truth**（4 层）：
   - L1 gold truth 本体（两消费点断裂）：6/6 检出；
   - L2 producer 自相矛盾：真实仓库 `validateSessionHeader`（core/session/index.ts:108-111）要求 safe-integer number，ISO string 创建直接 throw——A/E/C 检出（此层揭示 synthetic 任务的 artifact 换到真实仓库会立即自爆）；
   - L3 治理缺口：SESSION_FORMAT_VERSION 未 bump（types.ts:65-87 政策原文被引用）——A/F/D 检出；
   - L4 消费面低估：coordinator.ts:692、session-log-deepseek wireHeader、subagent list-children.ts:286、session-query corpus.ts:317——多 arm 独立 grep 出 artifact 未列出的消费点。
3. **「unchanged」注释被当作缺陷证据而非免责声明**：B/E/F/D 一致认为 diff 自己标注未改 = 记录不完整改动 = 缺陷，而非「不在本 PR 范围」。
4. **artifact 路径不存在被一致发现**（packages/session/session 实为 packages/core/session）——synthetic 任务预期行为，同 T3/T4/T5/T6。
5. **claude 连续性**：T7 中 claude 3 blocker 全部准确，T2–T7 中 claude 无一次判定失误（除 T5 attempt1 不可用）。
6. **评审语言漂移**：B-strong 用中文输出 findings（schema 未约束语言）——不影响结构化判定，但提示 production 政策若需要英文/中文一致输出须在 prompt 或 schema 约束。

## 完整 finding 证据

workflow 输出（T7 batch）留存于会话；本文件表格为决定性摘要。
