# ENGINEERING-FINALIZATION-CHECKPOINT
Execution/ops record only. Repo/Git is authoritative.
MAINLINE: w1-w4-usability-closure
FREEZE_HEAD: e8e8cf04e (verified before install; no external movement)
LOCKFILE_HEAD: 4847154e7 (pnpm-lock.yaml +3 lines, only dsh-tool-session-query importer/snapshot)
WORKTREE: 16 pre-existing unrelated items, untouched
VERIFY: pnpm install --no-frozen-lockfile PASS (21s, offline-preferred); base->tool-session-query workspace link resolved; affected specs 174/174 PASS (post-reinstall); no unrelated lockfile churn.
INSTALLED_RUNTIME (unchanged this phase): @deepseek-ai/dsh 0.1.2-alpha.5 @ sourceRevision 55101cc59, PID 95665 GUI
LOCAL_PATCH_STATUS: installed LOCAL-PATCH-NOTES.md patch 1 (dsh-tool-workflow spillThresholdChars -> .agent/workflow-results) is NOT upstream in current source; must be re-applied on the new installed lib or intentionally dropped (user preference) - NOT silently lost (recorded).
PROMOTION_PIPELINE (fork-personal, outside repo, found but not executed): /tmp/m4-reentry/{tarballs,rebuild.mjs,pkgs-fresh,build-runtime-npm.mjs,runtime-new,consumer,m5v2-deploy}. No in-repo driver; built from a different lineage (55101cc). Executing unsupervised would: rebuild+pack ~180 pkgs from this line, npm-install consumer, swap nvm-global dsh + ~/.dsh/profiles/{web,headless}, then replace the :3080 GUI (PID 95665) that hosts this session. Blocked from unsupervised continuation on env-safety + missing in-repo formal flow + personal-patch policy.
FINALIZATION_VERDICT: PASS_WITH_RESIDUAL
  PASS: lockfile reproducible + committed; resolution verified; affected tests 174/174; no unrelated worktree change.
  RESIDUAL (single): runtime promotion + GUI switch deferred to supervised run (runbook below).
PROMOTION_RUNBOOK (supervised; each step verified before next):
1) Freeze: confirm branch w1-w4-usability-closure, HEAD includes 7ef8dbadc + 4847154e7; git status 16 unrelated.
2) Build current line: pnpm run build (repo gates) ; pack publishables -> /tmp/m4-reentry/tarballs (follow fork pack convention used for 55101cc).
3) /tmp/m4-reentry/rebuild.mjs (extract tarballs -> pkgs), refresh pkgs-fresh per fork script, run build-runtime-npm.mjs to stage runtime-new/dsh (sourceRevision must equal current mainline commit - verify dsh.sourceRevision after stage).
4) consumer npm install; verify resolved dsh.sourceRevision == mainline HEAD (no fake promotion).
5) Reapply LOCAL patch 1 to new installed dsh-tool-workflow lib (per LOCAL-PATCH-NOTES.md) OR record intentional drop (user decision).
6) Isolated smoke: DSH_HOME=/tmp/promo DEEPSEEK_API_KEY=<env> <new dsh> --profile web --port 3099 -> boot log; confirm first-search/session-query durable row + ptc tool present via dump-config; run one headless real task.
7) Only after PASS: stop old GUI (PID 95665), start new runtime on :3080, verify new PID + dsh --version/sourceRevision; minimal GUI acceptance (new session; session_search in tool set; discovery; no cross-workspace leak).
8) Tag stable: create new personal-stable tag from mainline HEAD; do not overwrite old backups/rollback artifacts.
ROLLBACK_POINT: previous install backups (nvm + ~/.dsh profiles backups/; LOCAL-PATCH-NOTES history) + mainline commits reversible.
REPORT: final branch w1-w4-usability-closure; HEAD e8e8cf04e(+lock 4847154e7); lockfile commit 4847154e7; tests 174/174 + reconstruction 26/26 (earlier); residuals: runtime promotion pending supervised run; local patch-1 reapply decision; continuity/memory core frozen.
STAGE_PROMOTION (plan b) — executed subset:
  SOURCE_HEAD = 7318c75da ; BUILD_HEAD = 7318c75da ; PACKAGE_VERSION = 0.1.2-alpha.5 (workspace)
  BUILD = PASS (pnpm run build: tsc+tsdown+220 client artifacts, exit 0)
  PACK = NOT_EXECUTED_THIS_TURN (official driver located: fork dsh-root scripts/release/{pack,tarball,publish,verify,verify-packed-install}.ts + m5-release.ts/m5-deployment.ts under /tmp/m4-reentry/m5v2-deploy/slots/stable/install/node_modules/.pnpm/@deepseek-ai+dsh-root@*/node_modules/@deepseek-ai/dsh-root/scripts)
  PATCH_1 delta captured from installed lib (dsh-tool-workflow/lib/index.js): add Config {maxResultChars default 1e4; spillThresholdChars default 1e4; spillDir default '.agent/workflow-results'}; tool description sentence; renderResult(..., value.spilledFile) + spill block: if renderedFull.length > spillThresholdChars -> write <base=header.cwd|process.cwd()>/<spillDir>/<runId>.json, return truncated+locator. NOT present in current repo source -> must reapply on staged lib, no scope expansion.
  ISOLATED_INSTALL = NOT_EXECUTED_THIS_TURN
  WEB_STAGE = NOT_EXECUTED_THIS_TURN ; HEADLESS_STAGE = NOT_EXECUTED_THIS_TURN
  LIVE_RUNTIME = UNTOUCHED (PID 95665 @ 55101cc59, profiles unchanged) — reconfirmed at close
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
  (BUILD verified; pack/consumer/slot stage + patch runtime re-verify remain; exact scripts+delta captured for a single supervised continuation)
NEXT_ACTION (single): SUPERVISED_LIVE_PROMOTION_PENDING — run dsh-root release pack -> tarballs dir, verify-packed-install in isolated dir, reapply patch-1 on staged dsh-tool-workflow lib, M5 candidate-slot prepare+canary on :3099, then (separate, user-gated) active-pointer switch to :3080. Do NOT switch global dsh / :3080 / stable tag in this phase.
STAGE_PROMOTION (plan b) — continuation result:
  PACK = BLOCKED_AT_OFFICIAL_ENV_GATE (not a code failure): dsh-root scripts/release/pack.ts verifyBuildArtifacts requires an official client-build environment record matching: DSH_CLIENT_BUILD_PROFILE=official, DSH_CLIENT_TITLE="DeepSeek Harness", DSH_CLIENT_COMMIT_HASH (from clean tree), DSH_CLIENT_GIT_DIRTY (omitted only when clean). Plain 'pnpm run build' does not emit that record; worktree is dirty with externally-drifting untracked .agent files (17->19 during this phase) so a truthful clean official provenance cannot be produced now.
  No tarballs produced (pack failed at verifyBuildArtifacts, before any member pack). /tmp/stage_promo empty.
  STAGED_SOURCE_REVISION = NOT_STAMPED (blocked before manifest).
  LIVE_RUNTIME = UNTOUCHED (reconfirmed: PID 95665, installed sourceRevision 55101cc59, ~/.dsh/profiles untouched).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
  PENDING (exact): (1) run official client build via fork dsh-root build path on a CLEAN tree with official env profile (or produce equivalent record), (2) re-run release/pack.ts --family dsh --out isolated, (3) verify-packed-install, (4) isolated consumer install, (5) Patch-1 reapply on staged dsh-tool-workflow + runtime spill probe, (6) web :3099 smoke, (7) headless smoke, (8) manifest sourceRevision=7318c75da (code head), counterfeit audit.
NEXT_ACTION: SUPERVISED_STAGING_RESUME (same scope; requires a clean-tree official client build first). Do NOT switch :3080 / global dsh / stable tag.
STAGE_PROMOTION (plan b) — clean-worktree continuation:
  CLEAN_BUILD_WORKTREE = /tmp/dsh-official-build (detached; HEAD was 7318c75da, status 0)
  FROZEN_INSTALL = PASS (pnpm install --frozen-lockfile, 34.8s)
  OFFICIAL_CLIENT_BUILD = PASS (pnpm run build:official; record: official, commit 7318c75, version 0.1.2-alpha.5, dirty omitted, 220 artifacts sha256 2cb0c41a)
  RELEASE_VERSION_FIX = packages/web/tool-browser 0.1.0 -> 0.1.2-alpha.5 (family must share one version) committed in clean worktree => staged SOURCE_CODE_HEAD = 717cd0cae92788a7f5355546b2ba643fc71edb67 (base 7318c75da + this one fix). NOTE: same bump still needed on mainline w1-w4-usability-closure (recorded residual).
  PACK = PASS (official verifyBuildArtifacts + pack --family dsh): 244 tarballs + publish-order.txt in /tmp/stage_promo/tarballs
  VERIFY_PACKED_INSTALL = FAILED (env/npm bug): first npm EPERM on root-owned ~/.npm cache; after npm_config_cache=/tmp/npmcache-staging retry, npm 10.9.8 arborist crash "Cannot read properties of null (reading 'edgesOut')" while resolving the 244 file: closure (monorepo cyclic workspace deps). Not a code/pack defect.
  PATCH_1 = NOT_YET_REAPPLIED (blocked after verify-packed-install); delta already captured in prior checkpoint.
  WEB_3099 / HEADLESS / M5_CANDIDATE / manifest sourceRevision stamp = NOT_REACHED (blocked).
  LIVE_RUNTIME = UNTOUCHED (PID 95665; installed sourceRevision 55101cc59; ~/.dsh/profiles unchanged).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
PENDING (exact): (1) resolve npm install of 244 file: closure (upgrade/repair npm cache or use the fork's consumer/install path with a compatible npm), (2) finish verify-packed-install + isolated consumer, (3) Patch-1 reapply on staged dsh-tool-workflow + runtime spill probe, (4) M5 candidate slot manifest (sourceRevision=717cd0cae), (5) web :3099 smoke, (6) headless smoke, (7) counterfeit audit, (8) mainline tool-browser version bump.
NEXT_ACTION = STAGING_RESUME (same plan b scope). No :3080 / global dsh / stable tag changes.

STAGE_PROMOTION (plan b) — installer-compat result:
  VERIFY_PACKED_INSTALL = FAILED with precise root cause (NOT a pack/code defect):
    npm 10.9.8 AND npm 9.9.4 (isolated corepack/npx, fresh cache, isolated HOME) both crash identically in arborist #loadPeerSet (build-ideal-tree.js:1302) "Cannot read properties of null (reading 'edgesOut')" while resolving the 244 file: tarball closure's peer-dependency set (cyclic workspace topology + full-closure peer resolution). Tarball manifests themselves are clean (internal deps already rewritten to ^0.1.2-alpha.5, no workspace: specifiers).
  INSTALLER_COMPATIBILITY = FAIL(npm-arborist) — a real installer-compatibility blocker, not Harness architecture.
  NOT_EXECUTED (blocked behind packed install): isolated consumer, Patch-1 reapply + runtime probe, M5 candidate, web :3099, headless, counterfeit audit.
  RUNTIME_SOURCE_AUTHORITY = 717cd0cae (staged detached; parent 7318c75da). EXPECTED_SOURCE_REVISION = 717cd0cae. Do NOT write 7318c75da into manifest.
  NEXT (fallback per scope §5-§7): read-only audit + use fork consumer/build-runtime-npm.mjs adapter (same 244 tarballs -> flattened file: layout -> isolated install) ONLY as an installer-compat adapter with proven equivalence; do not rebuild/repack from source, do not mix 55101cc artifacts.
  LIVE_RUNTIME = UNTOUCHED (reconfirm at close).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
