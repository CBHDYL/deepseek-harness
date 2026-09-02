# Agent Note: R4 diagnostic and repair authority boundary

Status: implemented

English | [中文](2026-09-02-r4-authority-boundary.zh.md)

## Problem

Three parties could plausibly claim to own DSH diagnosis and repair: the verified-baseline health entry (R3), the deleted old fork M3 doctor, and the third-party `@linxin666/dsh-doctor` package wired into the web profile. Nothing recorded which of them is authoritative, which is advisory, and who may mutate runtime state.

## Decision

The authority boundary is declared as follows, based on the 2026-09-02 R4 audit evidence.

**Diagnostic authority (verified baseline)**: the fork's read-only `verify-health` entry (R3) aggregated with the R2 critical-lineage gate. These are the authoritative PASS / WARN / BLOCK verdicts for the verified `dsh-0.1.2-alpha.5-verified` lineage. They never write.

**Repair authority (verified baseline)**: none. The fork deliberately owns no repair orchestrator: R1–R3 are read-only, PR1–PR6 own runtime-internal semantics, and the old M3 doctor was removed in baseline sanitation. Building one is a separate, large decision and is not undertaken here.

**Third-party doctor**: `@linxin666/dsh-doctor@0.3.12`, wired into the web profile as `web-ui-doctor` (profile `cordis.patch.yml` sets `autoMigrate: false`, the 2026-08-30 M3 decision), with its `/api/doctor/*` surface live in the running web (auth-gated, 401 without credentials). It provides a Supervisor, launcher supervision, rescue capsule (mirrors credentials with 0600; `DSH_DOCTOR_CREDENTIALS=off` disables), staged deterministic repairs with gated promote, rollback from quarantine, and plugin quarantine. Classification: **advisory** — user-invoked and gated (`autoRepair` defaults to `false`), outside the verified-baseline lineage (unreviewed third-party code), and its credential-mirroring surface requires explicit owner acceptance. It is the de facto executor when the owner chooses to repair through it, but no fork gate or declaration endorses it as authoritative.

## Consequences

- There is no automatic duplicate authority: R3 never writes, and the doctor's automatic intervention is gated by `autoRepair: false`.
- Two user-invoked writers can touch the same profile files (`dsh plugin` and `dsh-doctor repair`); they must not run concurrently. Recorded as an operational caution, not a code defect.
- Repair failure semantics are fail-loud by the doctor's own contract: staged transaction, atomic promote or rollback, quarantine, exit codes 0 ok / 1 repaired and verified / 2 attention needed / 3 blocked.
- Any future fork-side repair capability must consume the R1/R2/R3 signals and the doctor's existing transaction primitives rather than build a second checker or repair path.

## Alternatives considered

- Classifying the third-party doctor as authoritative: rejected — it is unverified third-party code outside the sealed lineage; endorsing it as authoritative would grant unreviewed repair code the same standing as the verified baseline.
- Building a fork-owned repair orchestrator now: rejected — that is a repair architecture, which this round explicitly does not undertake.
- Removing the third-party doctor from the profile: rejected — it is owner-installed profile composition, and its `autoRepair: false` / `autoMigrate: false` posture is consistent with the audit; removal is an owner decision, not an audit requirement.
