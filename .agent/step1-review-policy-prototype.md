# STEP 1 — RISK-AWARE MULTI-MODEL REVIEW POLICY PROTOTYPE

> Production runtime delta = 0。仅使用现有 workflow `agent(provider, model, schema)` / `parallel` / fresh / fork primitives。
> 这是 benchmark 前的 prototype，不是永久 architecture。脚本里的模型名是「占位配置」，由调用方传入，benchmark 前不固化任何模型优劣结论。

## 1. 最小 RISK 分档（deterministic，不由 reviewer LLM 定）

```
LOW      → 1 cheap fresh reviewer + deterministic validation（现有 test/typecheck/lint 门）
MEDIUM   → 1 cheap fresh reviewer → 无 escalation trigger → finish
                                 → 有 trigger → escalate 到 strong cross-provider reviewer
HIGH     → 1 cheap fresh scout（收证据）+ 1 strong cross-provider reviewer（并行）
CRITICAL → strong fresh reviewer 直接上，无 cheap-only 捷径
```

- risk 输入：显式 task metadata / workflow 输入。无可靠输入时 default = MEDIUM。
- reviewer LLM 不拥有最终 risk authority。

## 2. Escalation triggers（deterministic，第一版只 7 个）

```
REVIEW_DISAGREEMENT   （多 reviewer verdict 不一致）
MISSING_EVIDENCE      （evidence_complete === false）
TEST_FAILURE          （deterministic 验证门失败）
HIGH_BLAST_RADIUS     （cross-package / schema / protocol 变更）
SECURITY_SENSITIVE    （显式标记）
AUTHORITY_CHANGE      （authority/protocol/persistence 变更）
REVIEWER_UNCERTAIN    （verdict === UNCERTAIN 或 confidence === LOW）
```

每次 escalation 记录稳定 reason（如 `REASON = MISSING_EVIDENCE`）。

## 3. Review output（structured，REUSE 语义不新建 schema 名字）

> 注意：workflow `agent()` 的 schema 子集（`assertObjectJsonSchema`）只支持对象级 `required: [...]` 数组，
> 不支持属性级 `required: true`（preflight 实测确认）。以下 schema 已按子集修正。

```js
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence', 'evidence_complete', 'escalation_recommended'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNCERTAIN'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'claim', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['info', 'warning', 'blocker'] },
          claim: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    evidence_complete: { type: 'boolean' },
    escalation_recommended: { type: 'boolean' },
    escalation_reason: { type: 'string' },   // 稳定 reason 词（第 2 节）
  },
}
```

## 4. Independence policy

需要 independent review 时优先：fresh context + 不同 provider/model（where justified）。
记录 provider / model / context topology（供 benchmark 分析）。
区分 MODEL / PROVIDER / CONTEXT / PROMPT / EVIDENCE 五种 diversity——本轮不建 scoring。

## 5. Authority boundary（不变）

```
review models → findings/evidence → deterministic 聚合脚本 → 现有 evidence/authority 链（M6 judge）
```

禁止：2 个 reviewer PASS → authority；majority vote → activation；model confidence → authority。
Model agreement 最多「避免不必要 escalation」，不能 grant authority。

## 6. WORKFLOW SCRIPT（prototype，供 workflow 工具执行）

```javascript
// STEP-1 prototype: RISK-AWARE multi-model review policy
// Production runtime delta = 0. Uses only workflow agent()/parallel primitives.
// args: { risk, task, providers } — 由调用方传入，模型名是占位配置。

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence', 'evidence_complete', 'escalation_recommended'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNCERTAIN'] },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'claim', 'evidence'], properties: {
      severity: { type: 'string', enum: ['info', 'warning', 'blocker'] },
      claim: { type: 'string' },
      evidence: { type: 'string' },
    } } },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    evidence_complete: { type: 'boolean' },
    escalation_recommended: { type: 'boolean' },
    escalation_reason: { type: 'string' },
  },
}

const TRIGGERS = [
  'REVIEW_DISAGREEMENT', 'MISSING_EVIDENCE', 'TEST_FAILURE', 'HIGH_BLAST_RADIUS',
  'SECURITY_SENSITIVE', 'AUTHORITY_CHANGE', 'REVIEWER_UNCERTAIN',
]

function reviewPrompt(task, role) {
  return `You are a ${role} reviewer. Review ONLY the provided artifact/evidence. ` +
    'Do not assume anything beyond the evidence. ' +
    'Return structured findings per schema. Task: ' + JSON.stringify(task)
}

// 从 reviewer 结果提取确定性 trigger
function escalationOf(r) {
  if (r.verdict === 'UNCERTAIN' || r.confidence === 'LOW') return 'REVIEWER_UNCERTAIN'
  if (!r.evidence_complete) return 'MISSING_EVIDENCE'
  if (r.escalation_recommended && r.escalation_reason) return r.escalation_reason
  return null
}

function disagreement(a, b) {
  return a && b && a.verdict !== b.verdict && a.verdict !== 'UNCERTAIN' && b.verdict !== 'UNCERTAIN'
}

// 调用方传入：risk ∈ LOW|MEDIUM|HIGH|CRITICAL；providers: {cheap:{provider,model}, strong:{provider,model}}
// deterministic 验证门（test/typecheck/lint）结果作为 task.testPassed 由调用方预先算好。

const risk = args.risk ?? 'MEDIUM'
const cheap = args.providers?.cheap
const strong = args.providers?.strong

phase('risk-aware-review')

if (risk === 'LOW') {
  const r = await agent(reviewPrompt(args.task, 'reviewer'), { label: 'review-low', phase: 'review', schema: REVIEW_SCHEMA, ...cheap })
  const esc = escalationOf(r)
  log(`LOW review: verdict=${r.verdict} escalated=${esc ?? 'NO'}`)
  if (esc !== null || r.verdict === 'FAIL' || args.task.testPassed === false) {
    return { outcome: 'FAIL_OR_ESCALATE', review: r, escalated: esc ?? 'TEST_FAILURE' }
  }
  return { outcome: 'COMPLETE', review: r, escalated: null }
}

if (risk === 'MEDIUM') {
  const r = await agent(reviewPrompt(args.task, 'reviewer'), { label: 'review-medium', phase: 'review', schema: REVIEW_SCHEMA, ...cheap })
  const esc = escalationOf(r)
  log(`MEDIUM review: verdict=${r.verdict} escalated=${esc ?? 'NO'}`)
  if (esc !== null || r.verdict === 'FAIL' || args.task.testPassed === false) {
    const sr = await agent(reviewPrompt(args.task, 'strong reviewer'), { label: 'review-escalated', phase: 'review', schema: REVIEW_SCHEMA, ...strong })
    const disagreementWithCheap = disagreement(r, sr)
    return { outcome: 'ESCALATED', cheap: r, strong: sr, escalated: esc ?? 'TEST_FAILURE',
      escalation_reason: disagreementWithCheap ? 'REVIEW_DISAGREEMENT' : (esc ?? 'TEST_FAILURE') }
  }
  return { outcome: 'COMPLETE', review: r, escalated: null }
}

if (risk === 'HIGH') {
  // parallel() 是 workflow 官方并发 hook；item 抛错 → 该项 null。
  const [scout, reviewer] = await parallel([
    () => agent(reviewPrompt(args.task, 'evidence scout'), { label: 'scout', phase: 'review', schema: REVIEW_SCHEMA, ...cheap }),
    () => agent(reviewPrompt(args.task, 'independent reviewer'), { label: 'review-high', phase: 'review', schema: REVIEW_SCHEMA, ...strong }),
  ])
  if (scout === null || reviewer === null) {
    return { outcome: 'ESCALATED', escalated: 'REVIEWER_UNAVAILABLE', scout, strong: reviewer }
  }
  const disagrees = disagreement(scout, reviewer)
  const esc = escalationOf(reviewer) ?? escalationOf(scout) ?? (disagrees ? 'REVIEW_DISAGREEMENT' : null)
  log(`HIGH review: scout=${scout.verdict} strong=${reviewer.verdict} escalated=${esc ?? 'NO'}`)
  return { outcome: esc !== null ? 'ESCALATED' : 'COMPLETE', scout, strong: reviewer, escalated: esc }
}

// CRITICAL
{
  const r = await agent(reviewPrompt(args.task, 'independent strong reviewer'), { label: 'review-critical', phase: 'review', schema: REVIEW_SCHEMA, ...strong })
  const esc = escalationOf(r)
  log(`CRITICAL review: verdict=${r.verdict} escalated=${esc ?? 'NO'}`)
  // CRITICAL 无 cheap-only 捷径；结果直接交给确定性 authority（M6 judge / 人）。
  return { outcome: esc !== null ? 'ESCALATED' : 'COMPLETE', review: r, escalated: esc }
}
```

## 7. Benchmark-ready 调用示例

```javascript
// 6 arms 的调用差异全部体现在 args 层（脚本不变）：
// A  single-Flash          → { risk:'MEDIUM', providers:{ cheap:{provider:'deepseek-official', model:'deepseek-v4-flash'}, strong:{...flash} }, task:{...} }
// B  single-Pro            → { risk:'MEDIUM', providers:{ cheap:{...pro}, strong:{...pro} }, task:{...} }
// C  Flash×2-fresh         → { risk:'MEDIUM', providers:{ cheap:{...flash}, strong:{...flash} }, task:{...} }（两次 fresh agent 调用）
// D  Flash×2→disagree→Pro  → { risk:'MEDIUM', providers:{ cheap:{...flash}, strong:{...pro} }, task:{...} }
// E  Flash+cross-provider  → { risk:'HIGH', providers:{ cheap:{...flash}, strong:{ provider:'<other-provider>', model:'<other-model>' } }, task:{...} }
// F  strong-fresh-reviewer → { risk:'CRITICAL', providers:{ strong:{...pro-or-claude-or-codex} }, task:{...} }
```

## 8. Telemetry（benchmark 必需的最小集，复用现有）

| 字段 | 来源 | 状态 |
|---|---|---|
| provider/model | workflow agent() 参数 + session request/header | 已有 |
| fresh/fork | subagent backend 选择 | 已有 |
| risk | args.risk（调用方传入） | prototype 层 |
| verdict/escalated/reason | workflow 脚本 return + log() | prototype 层 |
| input/output tokens | token-meter / session usage | 已有（需确认 per-agent 粒度） |
| wall time | workflow 生命周期事件 | 已有（需确认 per-agent 粒度） |

缺失项（不阻塞 benchmark 则不扩）：per-agent token/wall-time 粒度——若 benchmark 需要，用 workflow `log()` 记录时间戳兜底，不改 Runtime。

## 9. Validation（静态 + 最小 synthetic）

- LOW route：脚本 `risk==='LOW'` 分支——1 cheap reviewer → COMPLETE 或 FAIL_OR_ESCALATE ✓（静态走查）
- MEDIUM normal：无 trigger → COMPLETE ✓
- MEDIUM escalation：trigger 存在 → 二次 strong review → ESCALATED ✓
- HIGH cross-provider：parallel scout + strong → 记录 disagreement ✓
- CRITICAL strong-fresh：直接 strong，无 cheap 捷径 ✓
- structured report：REVIEW_SCHEMA 是 assertObjectJsonSchema 保守子集 ✓
- authority boundary：脚本只产 outcome/escalated 记录，无任何 activation/promotion 调用 ✓

> 运行时 validation（真实模型调用）defer 到 Step 2 benchmark。本 prototype 静态验证通过即可进入 benchmark。
