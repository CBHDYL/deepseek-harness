# Agent Note: Sandbox escalation — same-mode normalization and a structured failure code

Status: implemented

English | [中文](2026-08-29-sandbox-escalation-same-mode-normalization.zh.md)

## Problem

An agent running at the effective mode already in force kept requesting that same mode as an escalation: the schema advertised `sandbox_permissions`/`justification` whenever a confining executor was mounted, so a session at `danger-full-access` under `approval=never` saw an escalation knob that could never succeed and hammered it — 35 consecutive calls in one observed run, all failing on `is not strictly wider than this call's current mode`. Each failure was a plain `Error`, so observer and retry layers could not classify it and fell back to message matching.

## Decision

Two coordinated changes, both in the shared escalation choreography:

- `approveEscalation` treats a request whose mode equals the call's effective mode as idempotent: it returns the effective mode without asking the approval channel, so the call executes under the standing policy. The equality check is guarded on the closed `SandboxMode` vocabulary, so an unknown-mode pair still fails closed. - A genuinely non-widening request throws a `HarnessError` carrying the stable code `SANDBOX_ESCALATION_NOT_WIDER`; the tool registry surfaces it as `result.error.info.code`, so failure fingerprints and observability classify it structurally instead of parsing text.

The same-mode path applies to every enforcing family (bash, pwsh, edit, write) because they all resolve through the one `approveEscalation` home. The escalation-hider guard also widens its default `tools` list from `['bash', 'pwsh']` to `['bash', 'pwsh', 'edit', 'write']`, so the never-succeeds knob is hidden from the model for filesystem mutations too. The hiding remains cosmetic: a model that emits the fields anyway still hits the idempotent or structured failure exactly as the execution layer defines it.

## Alternatives considered

**Keep the plain error and let the schema enum prevent same-mode requests.** Rejected: the schema enum is the closed target vocabulary advertised composition-wide, while the effective mode is per-session truth; the enum cannot express "not wider than this session's current mode".

**Normalize any requested mode equal to the effective mode, including unknown modes.** Rejected: an unrecognized mode string must fail closed rather than be accepted by comparison, because a typo or a future mode would silently execute instead of surfacing the mismatch.

**Fold the idempotence into each tool family instead of `approveEscalation`.** Rejected: both families already funnel through the one shared sequence, and the cross-file duplication gate exists precisely to keep them from diverging.

## Consequences

A same-mode escalation retry now executes instead of failing, eliminating the observed hammering loop; genuinely non-wider requests fail with a machine-routable code that repeat-detection and observability consume without message parsing. Behavior of narrower-but-valid escalations is unchanged: they still prompt through the approval seam and run under the granted mode only for that call.

## Testing

Focused contract tests pin the idempotence (no approval ask, standing mode stamped) and the structured code on the shared sequence and on the bash and fs tool families; the hider suite pins the widened default tool set.
