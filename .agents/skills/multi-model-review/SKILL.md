---
name: multi-model-review
description: "Run the frozen Multi-Model Execution Policy as a real review: pass a task, risk, and provider config to the canonical workflow script; it routes LOW/MEDIUM/HIGH/CRITICAL topology, enforces the deterministic security floor and gate precedence, escalates to a cross-provider strong reviewer, retries at most once, and returns findings only, never authority. Use for PR review, candidate qualification, and any evidence-gated review task."
---

# Multi-Model Review

Executes `.agent/MULTI-MODEL-EXECUTION-POLICY.md` (frozen 2026-09-05) as a real review run on existing DSH primitives: the `workflow` tool, `agent(provider, model)`, `parallel()`, fresh reviewers. Findings only — deterministic gates and the existing review/approval chain own authority.

## Invocation

Call the `workflow` tool with `meta.name = "multi-model-review"` and `args`:

```json
{
  "risk": "LOW | MEDIUM | HIGH | CRITICAL",
  "task": {
    "name": "short task label",
    "kind": "mechanical | security | authority | sandbox_authority | persistence_authority | promotion_authority | semantic | other",
    "context": "what the change is and why",
    "artifact": "the diff/code snippet under review"
  },
  "providers": {
    "cheap": { "provider": "<provider-id>", "model": "<model-id>" },
    "strong": { "provider": "<other-provider-id>", "model": "<model-id>" }
  },
  "deterministicGate": { "label": "lint/typecheck/test name", "passed": true },
  "evidence": { "browserVerify": { "...": "optional browser evidence records" } }
}
```

The `script` parameter is the canonical body in `SKILL.md` (section `## Canonical script` — copy verbatim). Rules:

- `risk` default MEDIUM when omitted.
- Security floor: `kind` of `security`/`authority`/`sandbox_authority`/`persistence_authority`/`promotion_authority` raises any non-CRITICAL risk to HIGH. No bypass.
- Cross-provider check = provider id string inequality; a same-family alias pair is a caller configuration defect made visible by the recorded provider ids (no family registry is built — zero new abstraction).
- Risk values are a closed set: anything but LOW/MEDIUM/HIGH/CRITICAL fails with `CONFIGURATION_ERROR`.
- Gate precedence: a failed `deterministicGate` returns `GATE_FAILURE` with zero model calls — models can explain or locate, never override.
- Gate absence on LOW/HIGH/CRITICAL is recorded (`gate_missing: true`) but not fatal: the policy scopes gates to "适用处" and applicability is caller-determined; the flag makes it visible, never silent.
- Transient provider failure: at most one retry per reviewer, never a provider substitution. A null cheap reviewer ends LOW/MEDIUM with `INFRA_FAILURE`; on HIGH a single surviving reviewer keeps its record (prefixed fields), and only a double null ends with `INFRA_FAILURE`. `agent()` resolves `null` for a failed child; host-relay and start faults are fatal throws that kill the script loudly (workflow runtime semantics).
- The script records topology, provider identity, escalation reason, retries, and returns structured findings/uncertainty. Its output is NOT authority.
- Field convention: unprefixed `verdict`/`findings`/`confidence`/`evidence_complete` always belong to the cheap/scout side; the strong side always carries the `strong_` prefix (`strong_verdict`/`strong_findings`/`strong_confidence`/`strong_evidence_complete`). When only the strong reviewer survives on HIGH, only prefixed fields appear.

## Canonical script

```javascript
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
function reviewPrompt(task, role, evidence) {
  const evidenceText = evidence === undefined ? 'none' : JSON.stringify(evidence)
  return 'You are a ' + role + ' code reviewer for "' + task.name + '". Review ONLY the artifact against its context. '
    + 'Kind: ' + task.kind + '. Extra evidence: ' + evidenceText + '. '
    + 'Return verdict PASS (no real defect) / FAIL (real defect) / UNCERTAIN (cannot determine), '
    + 'findings (severity/claim/evidence), confidence, evidence_complete, escalation_recommended, escalation_reason. '
    + 'Do NOT invent defects; be precise about which line is wrong and why.\n\n'
    + 'Context: ' + task.context + '\n\nArtifact:\n' + task.artifact
}
// Deterministic trigger vocabulary: the frozen seven. A reviewer FAIL escalates
// under the stable route label VERDICT_FAIL; the model's own escalation_reason
// is recorded as evidence, never as the trigger.
function escalationOf(r) {
  // A null reviewer is recorded through the *_unavailable fields, never as an escalation trigger.
  if (r === null || r === undefined) return null
  if (r.verdict === 'UNCERTAIN' || r.confidence === 'LOW') return 'REVIEWER_UNCERTAIN'
  if (!r.evidence_complete) return 'MISSING_EVIDENCE'
  return null
}
const SECURITY_KINDS = new Set(['security', 'authority', 'sandbox_authority', 'persistence_authority', 'promotion_authority'])
let risk = args.risk ?? 'MEDIUM'
if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(risk)) {
  return { outcome: 'CONFIGURATION_ERROR', reason: 'risk must be LOW | MEDIUM | HIGH | CRITICAL', risk_requested: risk }
}
if (SECURITY_KINDS.has(args.task.kind)) risk = risk === 'CRITICAL' ? 'CRITICAL' : 'HIGH'
const cheap = args.providers.cheap
const strong = args.providers.strong
const crossProvider = cheap.provider !== strong.provider
const gate = args.deterministicGate ?? null
const gateMissing = gate === null && (risk === 'LOW' || risk === 'HIGH' || risk === 'CRITICAL')
const retries = []
// agent() resolves null for a failed child; a THROW is a fatal workflow fault
// and must kill the script loudly, never masquerade as a reviewer failure.
async function callWithRetry(role, label, opts) {
  const first = await agent(reviewPrompt(args.task, role, args.evidence), { label, phase: 'multi-model-review', schema: REVIEW_SCHEMA, ...opts })
  if (first !== null) return { result: first, retries: 0 }
  retries.push({ role: label, attempt: 1, result: 'unavailable' })
  const second = await agent(reviewPrompt(args.task, role, args.evidence), { label: label + '-retry', phase: 'multi-model-review', schema: REVIEW_SCHEMA, ...opts })
  retries.push({ role: label, attempt: 2, result: second === null ? 'unavailable' : 'ok' })
  return { result: second, retries: 1 }
}
// Deterministic aggregation: a FAIL anywhere is preserved — no reviewer, not
// even the strong one, can erase another reviewer's FAIL (T2-A lesson).
function aggregate(verdicts) {
  if (verdicts.length === 0) return 'REVIEW_UNCERTAIN'
  if (verdicts.some(v => v === 'FAIL')) return 'REVIEW_FAIL'
  if (verdicts.some(v => v === 'UNCERTAIN')) return 'REVIEW_UNCERTAIN'
  return 'REVIEW_COMPLETE'
}
function base(riskUsed) {
  return {
    risk_requested: args.risk ?? 'MEDIUM',
    risk_effective: riskUsed,
    task: args.task.name,
    kind: args.task.kind,
    providers: { cheap: cheap.provider + '/' + cheap.model, strong: strong.provider + '/' + strong.model },
    cross_provider: crossProvider,
    cross_provider_warning: crossProvider ? null : 'strong reviewer uses the same provider as cheap; HIGH/CRITICAL require cross-provider',
    critical: riskUsed === 'CRITICAL',
    authority_required: riskUsed === 'CRITICAL' ? 'existing approval/judge boundary (M6/human)' : null,
    gate: gate,
    gate_missing: gateMissing,
    retries: retries,
    authority_note: 'findings only; deterministic gates and the existing review/approval chain own authority',
  }
}
phase('multi-model-review')
if (gate !== null && gate.passed === false) {
  return { outcome: 'GATE_FAILURE', ...base(risk), note: 'deterministic gate failed; models cannot override' }
}
if ((risk === 'HIGH' || risk === 'CRITICAL') && !crossProvider) {
  return { outcome: 'CONFIGURATION_ERROR', reason: 'HIGH/CRITICAL requires a cross-provider strong reviewer', ...base(risk) }
}
if (risk === 'LOW') {
  const { result } = await callWithRetry('reviewer', 'low-review', cheap)
  if (result === null) return { outcome: 'INFRA_FAILURE', ...base(risk) }
  return { outcome: result.verdict === 'FAIL' ? 'REVIEW_FAIL' : result.verdict === 'UNCERTAIN' ? 'REVIEW_UNCERTAIN' : 'REVIEW_COMPLETE', verdict: result.verdict, findings: result.findings, confidence: result.confidence, evidence_complete: result.evidence_complete, escalation: null, ...base(risk) }
}
if (risk === 'MEDIUM') {
  const { result } = await callWithRetry('reviewer', 'medium-review', cheap)
  if (result === null) return { outcome: 'INFRA_FAILURE', ...base(risk) }
  const trigger = escalationOf(result)
  const escalate = trigger !== null || result.verdict === 'FAIL'
  if (!escalate) {
    return { outcome: result.verdict === 'UNCERTAIN' ? 'REVIEW_UNCERTAIN' : 'REVIEW_COMPLETE', verdict: result.verdict, findings: result.findings, confidence: result.confidence, evidence_complete: result.evidence_complete, escalation: null, ...base(risk) }
  }
  const reason = trigger ?? 'VERDICT_FAIL'
  const strongRun = await callWithRetry('strong reviewer', 'medium-strong', strong)
  const sr = strongRun.result
  if (sr === null) {
    return { outcome: aggregate([result.verdict]), verdict: result.verdict, findings: result.findings, confidence: result.confidence, evidence_complete: result.evidence_complete, escalation: { triggered: true, reason: reason }, strong_unavailable: true, ...base(risk) }
  }
  return { outcome: aggregate([result.verdict, sr.verdict]), verdict: result.verdict, strong_verdict: sr.verdict, findings: result.findings, strong_findings: sr.findings, confidence: result.confidence, evidence_complete: result.evidence_complete, strong_confidence: sr.confidence, strong_evidence_complete: sr.evidence_complete, reviewer_escalation_reason: result.escalation_recommended === true ? result.escalation_reason : null, escalation: { triggered: true, reason: reason }, ...base(risk) }
}
const pair = await parallel([
  () => callWithRetry('evidence scout', 'high-scout', cheap),
  () => callWithRetry('independent reviewer', 'high-strong', strong),
])
const scoutRun = pair[0]
const strongRun = pair[1]
const scoutNull = scoutRun === null || scoutRun.result === null
const strongNull = strongRun === null || strongRun.result === null
if (scoutNull && strongNull) {
  return { outcome: 'INFRA_FAILURE', ...base(risk) }
}
const scout = scoutRun === null ? null : scoutRun.result
const reviewer = strongRun === null ? null : strongRun.result
const scoutVerdict = scout === null ? undefined : scout.verdict
const strongVerdict = reviewer === null ? undefined : reviewer.verdict
const verdicts = [scoutVerdict, strongVerdict].filter(v => v !== undefined)
const disagreement = scoutVerdict !== undefined && strongVerdict !== undefined
  && scoutVerdict !== strongVerdict && scoutVerdict !== 'UNCERTAIN' && strongVerdict !== 'UNCERTAIN'
const trigger = escalationOf(reviewer) ?? escalationOf(scout) ?? (disagreement ? 'REVIEW_DISAGREEMENT' : null)
const out = {
  outcome: aggregate(verdicts),
  scout_unavailable: scout === null,
  strong_unavailable: reviewer === null,
  escalation: trigger === null ? null : { triggered: true, reason: trigger },
  ...base(risk),
}
if (scout !== null) {
  out.scout_verdict = scout.verdict
  out.scout_findings = scout.findings
  if (reviewer === null) {
    out.confidence = scout.confidence
    out.evidence_complete = scout.evidence_complete
  }
}
if (reviewer !== null) {
  out.strong_verdict = reviewer.verdict
  out.strong_findings = reviewer.findings
  out.strong_confidence = reviewer.confidence
  out.strong_evidence_complete = reviewer.evidence_complete
  out.reviewer_escalation_reason = reviewer.escalation_recommended === true ? reviewer.escalation_reason : null
}
return out
```

## Dogfood evidence

The canonical script was exercised against real routes (2026-09-05): LOW mechanical, MEDIUM escalation, HIGH security (floor), a real transient provider failure (retry path), and a real deterministic gate conflict. Records live in `.agent/reports/w2-dogfood.md`. Four rounds of independent closure review found five policy-conformance blockers plus a series of warnings (field-prefixing symmetry, trigger vocabulary, risk-validation ordering, HIGH null-source symmetry); all were fixed and re-verified in the same records.

## Authority boundary

Output is findings/evidence. No 2/3 majority, no model confidence, no verdict grants authority. `GATE_FAILURE` is final for the gate; reviewers only explain/locate/suggest.
