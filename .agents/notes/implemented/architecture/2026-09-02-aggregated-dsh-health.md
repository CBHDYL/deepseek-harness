# Agent Note: Aggregated machine-checkable DSH health (verify-health)

Status: implemented

English | [中文](2026-09-02-aggregated-dsh-health.zh.md)

## Problem

The verified baseline had every individual signal a deployment needs — artifact source identity, the R2 critical-lineage gate, profile files, and host prerequisites — but no single machine-checkable entry that aggregates them into one PASS / WARN / BLOCK verdict. Judging overall health required reading separate command outputs by hand.

## Decision

`scripts/verify-health.ts` is an aggregation layer only. It consumes existing results and re-decides none of them:

- **identity** — the installed core manifest's version and `dsh.sourceRevision`, via the R1 readers.
- **lineage** — the R2 checker's verdicts (`checkCriticalResolutions` through the plain-Node subprocess resolver); a core-runtime MISMATCH or UNKNOWN is BLOCK, plugin-private pins are accepted exactly as R2 defines.
- **profiles** — a read-only static parse of each profile's `package.json` and `cordis.yml`/`cordis.patch.yml`, plus a scan for critical packages hoisted at a profile's top-level `node_modules`. `dsh --dump-config` is deliberately not used: it rewrites profile files, so it would both mutate the user's home and fail under a write-blocked execution environment with a false BLOCK. An unreadable or unparsable profile file is BLOCK; a critical package at profile top level is WARN (it cannot shadow the core runtime — R2 proves the resolution topology — but it signals version confusion).
- **prerequisites** — CPython ≥ 3.10 for the code runtime and PTY availability, both as WARN environment debt.

Verdict rules: BLOCK is a fact this build can prove broken; WARN is environment debt or a non-shadowing signal; everything else is PASS. Exit codes: 0 PASS, 1 BLOCK, 2 WARN. `pnpm run verify-health -- --install <core package root>` is the entry point.

## Consequences

- The five R2/health scenarios are pinned by `scripts/verify-health.spec.ts`: healthy → PASS, wrong lineage → BLOCK, missing provenance → BLOCK, environment debt → WARN, plugin-private compatibility → never BLOCK.
- On the real global install the entry reports identity PASS, lineage 7/7 PASS, profiles PASS, and WARN only for the host's Python 3.9 and the sandbox-blocked PTY — matching the documented environment debt instead of a false BLOCK.
- No repair authority and no runtime semantics are introduced: the entry only reads. R4 (doctor/recovery) remains out of scope.

## Alternatives considered

- Restoring the old fork `dsh assess` command: rejected — its implementation no longer exists and its surfaces (patch manifest, drift) were superseded by R1/R2; a new thin aggregator over the current signals is smaller than resurrecting it.
- Shelling `dsh --dump-config` for profile composition: rejected — not read-only (it rewrites profile files), producing sandbox false BLOCKs and mutating the user's home during a health check.
- Putting the entry inside `apps/cli`: rejected for this round — it would change the shipped CLI surface and require redeploying the global candidate; a repo-side gate consumes the same signals and can be promoted into the CLI later.
