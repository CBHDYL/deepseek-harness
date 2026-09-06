# STEP 2 — 6×7 MULTI-MODEL RELIABILITY/COST BENCHMARK PROTOCOL

> Production runtime delta = 0。复用 STEP 1 prototype 脚本（`.agent/step1-review-policy-prototype.md`），
> 6 arms 的差异全部在 args 层表达。目标 = reliability/cost frontier，不是找最强组合。

## 1. Arms 定义（映射到 prototype 分支，脚本不变）

| Arm | 语义 | workflow args |
|---|---|---|
| A | single-Flash | `{ risk:'MEDIUM', providers:{cheap:{deepseek-official, deepseek-v4-flash}, strong:{deepseek-official, deepseek-v4-flash}}, task }` |
| B | single-Pro | `{ risk:'MEDIUM', providers:{cheap:{deepseek-official, deepseek-v4-pro}, strong:{deepseek-official, deepseek-v4-pro}}, task }` |
| C | Flash×2 fresh | `{ risk:'HIGH', providers:{cheap:{deepseek-official, deepseek-v4-flash}, strong:{deepseek-official, deepseek-v4-flash}}, task }`（HIGH 分支 = 两个并行 fresh reviewer） |
| D | Flash×2→disagree→Pro | `{ risk:'MEDIUM', providers:{cheap:{deepseek-official, deepseek-v4-flash}, strong:{deepseek-official, deepseek-v4-pro}}, task }` |
| E | Flash + cross-provider | `{ risk:'HIGH', providers:{cheap:{deepseek-official, deepseek-v4-flash}, strong:{<claude 或 codex>}}, task }` |
| F | strong-fresh reviewer | `{ risk:'CRITICAL', providers:{strong:{deepseek-official, deepseek-v4-pro 或 claude/codex}}, task }` |

## 2. 任务集（7 个 synthetic task，全部带 gold truth）

每个 task = `{ context, artifact（diff/代码片段）, gold_truth:[{kind, location, severity}], trap: boolean }`。

| # | 类型 | 构造要点 | gold truth |
|---|---|---|---|
| T1 | simple-bug | 单文件 20 行 diff 含 1 个 off-by-one | 1 bug（正确位置） |
| T2 | medium-implementation | 100 行 feature 含 2 个缺陷（1 逻辑 + 1 边界） | 2 bugs |
| T3 | architecture-sensitive | 跨 3 包接口签名变更，1 个调用点未同步 | 1 broken caller |
| T4 | test-gap | 已实现功能 + 测试，缺 1 个关键失败路径覆盖 | 1 gap |
| T5 | security-defect | 权限校验缺失（如缺少 owner 检查） | 1 security issue |
| T6 | false-positive-trap | 看起来像 bug（如「未处理 null」）但调用链保证非 null | **0 bugs（正确判定 = PASS）** |
| T7 | long-context | 5 文件变更含 1 个跨文件一致性断裂（A 改了语义 B 还按旧语义用） | 1 cross-file issue |

## 3. Metrics（12 个）

```
correct_detection   — gold truth 检出数（T6 反转为「未误报」）
miss_rate           — gold truth 未检出
false_positive      — 报告了不存在的缺陷
false_negative      — 漏报
agreement_rate      — 多 reviewer verdict 一致率（A/B 单 reviewer 记 N/A）
escalation_rate     — ESCALATED 占比
strong_call_rate    — strong reviewer 被调用占比
input_tokens / output_tokens / cache_read — 从 session usage 事件
wall_time           — workflow 生命周期事件
est_cost            — tokens × 目录价
evidence_quality    — 手工 3 档（finding 是否带具体 evidence 引用）
```

## 4. 运行协议

- 42 个组合 = 42 次 workflow run（每 run 一个 task 一个 arm）。
- 每次 run 记录：arm/task/verdict/escalated/reason + 12 metrics（workflow log + session events）。
- T6 的计分反转：PASS = 正确，报缺陷 = false positive。

## 5. 环境可用性（已核实 2026-09-05）

| Provider | 状态 |
|---|---|
| deepseek-official（flash/pro/vision） | ✅ 可用（全局 settings 已配 pro，describe-image 已配 vision） |
| claude（claude-opus-5） | ⚠️ allowedModels 已配；需 provider 包安装 + key 运行时确认 |
| codex（gpt-5.6-sol） | ⚠️ 同上（subagent-codex 默认 disabled，需启用） |
| openai-codex（gpt-5.6-sol，pi-ai） | ⚠️ settings 已配 apiKeyEnv:OPENAI_CODEX_API_KEY；key 运行时确认 |

**执行顺序建议**：先跑 DeepSeek-only arms（A/B/C/D/F-pro）共 35 组合；E 和 F-cross 在 provider 配置就绪后补跑。

## 6. 冻结标准（Step 3 的输入）

frontier 分析产出后，只有在以下情况才「freeze Multi-Model Execution Policy」：
- 至少一个 arm 在可靠性/成本 frontier 上显著优于 single-Flash baseline；
- 数据足以回答「哪档 risk 值得多少 reviewer topology」。

数据不足 → 不 freeze，保持 prototype + default=MEDIUM 单 cheap reviewer。

## 7. 硬约束

- 不修改 prototype 脚本的 authority boundary（脚本无 activation/promotion 调用）。
- 不新增任何 abstraction（checkpoint NON-GOALS 12 项仍有效）。
- 模型名只是 args 占位，结果不得被解读为「X 模型最好」的永久结论。
- 数据保存在 .agent/reports/ 下；不进 production 代码。
