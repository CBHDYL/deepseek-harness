# Agent Note: Release source identity and critical dependency lineage (R1/R2)

Status: implemented

English | [中文](2026-09-02-release-source-identity-critical-lineage.zh.md)

## Problem

An installed `dsh` could not prove which source produced it, and could not prove that its authority-sensitive packages came from the same lineage as the core package.

- Package version was the only identity: two builds of one version from different commits were indistinguishable once installed. The global install of `0.1.2-alpha.3` reported the same version as a fork HEAD carrying sealed remediation semantics, while running none of them.
- The release install path compounded it: the core package declares its family members with caret ranges, so installing the packed core tarball alone made npm fetch the members from the registry. One deployment produced a hybrid — a stamped candidate core beside unstamped upstream `0.1.2-alpha.5` members — which version-only identity could not see.
- `dsh-base` composed `action-policy-guard` in its patch layer without declaring the dependency, so the package was never installed at all; no gate checked that the base patch's 86 referenced plugins all had manifest declarations.

## Decision

### Release pack stamps the packing commit

`scripts/release/source-revision.ts` writes `dsh.sourceRevision` (full 40-character commit) into every member manifest immediately before `pnpm pack` and restores the checked-in bytes afterwards. The stamp comes from the checkout being packed, never from the runtime environment.

### Runtime reports what its own artifact declares

`apps/cli/src/identity.ts` reads the installed manifest beside the running `bin.js` — not any nearby checkout — and `dsh --version` renders `0.1.2-alpha.5 (source 70dca4e50)`. Same version, different packing commit → different report.

### Critical dependency lineage checker

`scripts/release/critical-resolution.ts` resolves seven authority-sensitive packages from the installed core entry and judges each copy's domain:

- `core-runtime`: any copy the core's own Node resolution walk can supply — nested inside the core package (global install), hoisted beside the core in the same `node_modules` level (the packed-install consumer), or hoisted at an ancestor level above the core's install level (reached when the core lacks its own member). A core copy must carry the core's version and its exact `sourceRevision`; missing stamp is `UNKNOWN`, same version with a different stamp is `MISMATCH` — both fail.
- `plugin-private`: nested under another package's own `node_modules`. Accepted as `ALLOWED_COMPATIBILITY` without a lineage requirement; the core's resolution walk never descends into these, so they cannot supply authority.
- `unknown` / unresolvable: fails.

The checker answers provenance only; it never inspects or re-decides the security semantics inside those packages.

## Consequences

- `scripts/release/verify-packed-install.ts` runs the checker over the packed family installed into a throwaway consumer, so a registry-mixed or wrong-lineage pack fails at release time.
- `scripts/release/verify-critical-resolution.ts` is a read-only command for any installed runtime: `--install <package root>`. It is what the future `dsh assess` should consume instead of reimplementing dependency checks.
- Resolution probes run in a plain Node child process so no loader in the release process (tsx, workspace tsconfig paths) can answer on the installation's behalf.
- 2026-09-02 global install of the packed candidate tarball produced the hybrid described above (npm resolved the caret members to upstream `0.1.2-alpha.5`); the checker detected all seven critical packages as MISMATCH/UNKNOWN and the install was rolled back from a pre-install backup.
- The same round found `verify-packed-install` passed vacuously: npm hoists the family into the consumer root, and the first domain rule classified hoisted members as plugin-private, skipping the lineage check. The domain rule above fixes the classification; the hoisted-layout spec cases pin it.
- `dsh-base` now declares `action-policy-guard` as a dependency, closing the silent absence.
- Residuals: `verify-packed-install` runs `npm install --omit=optional`, which on macOS skips koffi's prebuilt platform package and falls back to a source build that needs CMake (environment prerequisite, not a gate defect). The three backups under the global npm prefix (`dsh.pre-r1r2-backup`, `dsh.pre-align-backup`, `dsh.rollback-0.1.1-rc.2`) are outside the repo; cleanup is an owner decision.

## Alternatives considered

- `gitHead` stamped by npm's own pack machinery: rejected — the release pack step runs `pnpm pack` per member and the stamp must be one revision shared by the whole family, which the pack step already knows.
- Version-only identity plus a separate drift scanner: rejected — it keeps the version-string ambiguity that let the hybrid deploy happen.
- For the vacuous pack gate: treating the whole consumer directory as core lineage was rejected (a sibling plugin's private copy would be misjudged as core); removing the gate from the pack job was rejected (release-time interception would be lost). Extending the domain rule was chosen.
