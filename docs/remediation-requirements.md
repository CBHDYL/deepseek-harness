# Remediation Implementation Requirements

English | [中文](remediation-requirements.zh.md)

Confirmed requirements for the Harness remediation program. Canonical execution state lives in [REMEDIATION-IMPLEMENTATION.md](../REMEDIATION-IMPLEMENTATION.md); the normative design is the Remediation Plan Design Review in `docs/system-wide-audit.md`.

- Goal: implement PR-0 through PR-6 of the remediation program as defined in the ledger, one PR per session, each with its documented closed loop and exit criteria.
- Authority: the Design Review supersedes the earlier remediation plan wherever they conflict.
- Scope discipline: only the current PR's files change; new findings are classified BLOCKING / RELATED-NONBLOCKING / UNRELATED and recorded in the ledger.
- Acceptance: each PR's exit criteria, including `pnpm run test:snapshot` green for PR-0 with every original failure attributed.
- Product decisions PD-1 … PD-6 in the ledger remain open; they must be decided by a human before the affected code lands.
