# BENCHMARK RAW RESULTS — T4（test-gap: sandbox 降级守卫缺失败路径测试）

gold_truth: 新增「禁止降级」守卫，测试只加了升级用例——守卫 throw 路径零覆盖；且未测 current 不存在（首次设置）时 currentSandboxMode 返回 undefined 的边界
run_time: 2026-09-05
batch: 11 agents

| arm | verdict | evidence_complete | wall_ms | 关键行为 |
|---|---|---|---|---|
| A (single-Flash) | FAIL | false | 331559 | 正确；3 findings（测试缺口/既有降级语义冲突/首调 undefined）；esc=MISSING_EVIDENCE→strong(Pro)=FAIL |
| D (Flash→Pro) | FAIL | true (MEDIUM) | 301506 | 正确；5 findings；esc=TEST_FAILURE(verdict=FAIL 协议触发)→strong(Pro)=FAIL，strong 补 blocker：未测+TS2345（undefined 传 indexOf 在 strict 下不过编译） |
| C (Flash×2) | scout=FAIL / strong=FAIL | true (HIGH) | 250750 | 正确；scout 3 + strong 5 findings；esc=富文本理由（缺测试+破坏 policy.spec.ts:236-241/265-267+permission-presets 收紧路径+ladder 不在模块作用域） |
| B (single-Pro) | FAIL | true (HIGH) | 549652 | 正确；5 findings + strong 3；esc=富文本理由（4 包测试全红+TS2345+缺覆盖）；最慢 arm |
| E (Flash+claude) | scout=FAIL / strong=FAIL | true (HIGH) | 313451 | 正确；scout 5 + strong 5 findings；esc=claude 提出**方向性争议**：守卫拒绝收紧（read-only）却允许放宽（danger-full-access），与安全直觉相反——超出 gold truth 的解释性发现 |
| F (strong-Pro fresh) | FAIL | （transport 截断） | 251601 | 正确；首 finding 即 blocker「新 throw 零测试覆盖」；F 协议无 escalation |

## 关键观察

1. **6/6 arms 全部 FAIL = 全部命中 gold truth**（0 漏检）。T4 是 T1–T4 中检出率最高的任务。
2. **检出内容分层**（超出 gold truth 的为 reviewer 自主发现）：
   - gold truth 本体（测试缺口 + 首调 undefined 边界）：6/6 全检出；
   - 真实仓库符号核对：多 arm 发现 `SANDBOX_MODE_LADDER` 是 index.ts 模块私有、`tests/session-mode.spec.ts` 不存在、`currentSandboxMode` 无定义——reviewer 对真实树做了验证（synthetic artifact 预期行为，非计分错误，记入证据质量）；
   - 爆炸半径：policy.spec.ts:236-241/265-267、terminal-bash fence(index.spec.ts:614-630)、permission-presets apply()、subagent inheritance.spec.ts:144-146 的既有降级流会被守卫打断——4+ arms 独立检出；
   - TS2345：`SANDBOX_MODE_LADDER.indexOf(current)` 在 current: SandboxMode|undefined 下 strict 不过编译——B/D/C 检出。
3. **E (claude) 的方向性争议**：claude 主张「拒绝收紧却允许放宽与安全直觉相反」——这是 T4 中唯一的 reviewer 间意见分歧（其他 arm 按 context 语义接受「downgrade=向更严模式」）。对 gold truth 无影响（判定仍 FAIL），但提示 cross-provider arm 会引入**语义视角多样性**，可能产出超出任务设计者的解释。
4. **evidence_complete 分歧**：A=false（MISSING_EVIDENCE 触发 escalation）vs 其余=true——single-Flash 在测试缺口任务上证据收集自评不足。
5. **latency 极差大**：B(549.7s) vs C(250.8s)/F(251.6s)——同任务同模型强度下 2.2× 差异，说明 wall_ms 噪声大，frontier 分析须用中位数而非单点。

## TRANSPORT ISSUE（记录在案）

- workflow 工具对大 return value 施加截断：F arm 的 findings evidence 字符串被截断（4062 chars 丢失），**F 的 confidence / evidence_complete / strong_called 结构性字段随之丢失**。
- 修复决定（mini decision delta，仅 transport 层，review 管线不变）：T5–T7 的 batch runner 在 return 前对每个 finding 的 evidence 字段确定性截断到 180 chars（`evidence.slice(0,180)+'…'`）。理由：结构计分字段（verdict/confidence/evidence_complete/wall_ms/escalated）全部保留，牺牲的仅是 finding 证据长文——与 harness 任意点截断相比是确定性、无损于计分的。
- DATE=2026-09-05 / OLD=runner 原样 return 全量 findings / NEW=return 前确定性截断 evidence 至 180 chars / EVIDENCE=F arm 结构字段丢失 / REASON=harness return-value cap 不可控，确定性收缩优于随机截断。

## 完整 finding 证据

会话 workflow 输出（T4 batch）已留存于 harness spill 文件：
`/var/folders/n0/br8621fj6g3c6hyx_556qs2h0000gn/T/dsh-spill-vka3KW/session-874cacab12f9/6c6b32840cb6-workflow.txt`（T4 完整版，含 F 前半）。
