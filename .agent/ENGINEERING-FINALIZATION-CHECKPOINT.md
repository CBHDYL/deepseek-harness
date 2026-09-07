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
STAGE_PROMOTION — deep installer audit result:
  VENDOR_PACK = PASS (9 tarballs: cordis + cordis-plugin-* + logger-console; /tmp/stage_promo/tarballs-vendor)
  COMBINED_CLOSURE = 253 tarballs, 253 unique, all 0.1.2-alpha.5; internal dep closure SELF-CONSISTENT (missing only linux-only OPTIONAL @deepseek-ai/node-addon-landlock-run, skipped by --omit=optional). No workspace:/file:/* ranges.
  VERIFY_PACKED_INSTALL = STILL FAILED (npm 9.9.4 AND 10.9.8, isolated cache/HOME): arborist #loadPeerSet build-ideal-tree.js:1302 "Cannot read properties of null (reading 'edgesOut')" after idealTree completes — a peer-dependency-set materialization incompatibility over the 253 file: closure + cyclic peer topology. Root cause is NOT closure incompleteness (vendor family now included) and NOT a tarball defect. This is an installer (npm/arborist) compatibility blocker, explicitly out of scope to fix by mutating the package graph (§19).
  NOT_EXECUTED (still blocked): isolated consumer, Patch-1 reapply + runtime probe, M5 candidate, web :3099, headless, counterfeit audit.
  RECOMMENDED NEXT (supervised): use the fork's own evidence-backed consumer/install path (historical pkgs-fresh + pnpm, or a layout arborist can resolve) as an installer-compat adapter over the SAME 253 tarballs — after read-only audit confirms it does not rebuild/repack, skip closure verification, or mix 55101cc artifacts.
  RUNTIME_SOURCE_AUTHORITY = 717cd0cae (parent 7318c75da). LIVE_RUNTIME = UNTOUCHED.
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
STAGE_PROMOTION — PHASE A/B adapter result (audit + execution):
  ADAPTER_EQUIVALENCE = PASS (historical consumer = file: dir layout + pnpm; extraction-only transform; no rebuild/repack/registry-fallback/55101cc hardcode; consumer/pnpm-lock historical has 0 registry @deepseek-ai)
  PACKED_INSTALL_COMPAT_ADAPTER = PASS — pnpm (v12.3.4) install of 253 file: dirs in /tmp/stage_promo/consumer-adapter (pkgs-current regenerated from OUR 253 tarballs; allowBuilds mapping added)
  INSTALLED_CLOSURE_AUDIT = PASS — 253 internal installed; 244 dsh-family @ 0.1.2-alpha.5 + vendor (cordis 4.0.2, schemastery 3.18.2 ...); tool-browser 0.1.2-alpha.5; tool-session-query/session-query-sqlite/tool-workflow present; cordis family present; 0 registry @deepseek-ai in consumer lock
  RUNTIME_SOURCE_AUTHORITY = 717cd0cae (parent 7318c75da; delta = tool-browser family version fix)
  PACKAGED SMOKES = HEADLESS PASS (isolated DSH_HOME real-model reply "consumer-ok"); WEB :3099 PASS (isolated DSH_HOME boot serving GUI URL, 0 error lines)
  COUNTERFEIT SPOT = PASS — consumer tool-browser lib hash == tarball payload; no 55101cc in consumer dsh/pkgs-current; web patch first-search x2; ptc preset tool-session-query x2
  STAGING_INCOMPLETE = true — remaining ONLY: (1) Patch-1 reapply on consumer dsh-tool-workflow + runtime spill probe, (2) M5 candidate slot/manifest (sourceRevision=717cd0cae, digests, realpath confinement), (3) packaged-web cross-session tool-flow + workspace-isolation e2e (spot web boot done only), (4) full counterfeit audit (spot checks done).
  LIVE_RUNTIME = UNTOUCHED (PID 95665; installed rev 55101cc59).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
NEXT_ACTION = STAGING_RESUME_REMAINING (patch-1 -> M5 candidate -> packaged e2e). NOT SUPERVISED_LIVE_PROMOTION.
STAGE_PROMOTION — remaining-4 close (partial):
  PATCH_1_REAPPLIED = PASS (consumer-adapter dsh-tool-workflow lib; BEFORE sha256 3c240ab2b23933acbb2774279dda198d94034d9ab494bd1dd776a3f5296d55bc -> AFTER 18dc3a942b993a0a4829c6edc9624d4079af119e556a1cddab85ac35607e1703; node --check PASS; anchors spillThresholdChars x2 / spillDir x2 / workflow-results x3 confirmed; base == repoBuilt 717cd0cae lib diffstat 0). Base artifact preserved unpatched in pkgs-current (patch is deployment-local on consumer store copy only).
  FULL_COUNTERFEIT_AUDIT = PASS (consumer installed 253 == pkgs-current 253; 0 consumerOnly; 0 versionDiff; 0 registry @deepseek-ai in consumer lock; 0 55101cc anywhere in consumer)
  WIRING (from candidate consumer, not source): first-search present (web bundle), ptc tool-session-query present, tool-browser 0.1.2-alpha.5, vendor cordis family staged.
  NOT_EXECUTED (blocked by turn budget; precise): (1) PATCH_1_RUNTIME_PROBE (needs real workflow execution > spillThresholdChars inside packaged runtime), (2) M5_CANDIDATE slot + confinement (m5 tooling run), (3) packaged cross-session discovery + workspace-isolation + historical-boundary E2E (boot-level only done), (4) PROVENANCE_CHAIN manifest/digest record (blocked by M5 slot).
  LIVE_RUNTIME identity UNTOUCHED (PID 66861 external restart noted; rev 55101cc59; port 3080; profiles/stable untouched).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
NEXT_ACTION = STAGING_RESUME_FINAL (patch-1 runtime probe -> M5 candidate+manifest -> packaged e2e discovery/isolation). NOT SUPERVISED_LIVE_PROMOTION.
STAGE_PROMOTION — final-three blockers (turn closed honestly):
  1) PATCH_1_RUNTIME_PROBE = BLOCKED: requires a real packaged workflow execution with renderedFull > spillThresholdChars; packaged headless composition does not deterministically expose tool-workflow + subagent provider path within budget (LLM-volatile output or fixture-provider composition needed; fixture path not executed this turn).
  2) M5_CANDIDATE = BLOCKED (environment/tooling): m5v2-deploy slot copy of dsh-root ships ONLY scripts/m5-release.ts (slot engine) + {m5-release,m5-deployment}.spec.ts; there is no executable operator prepare/record CLI present in this copy to create a candidate slot + manifest without writing new glue (forbidden: no new release subsystem). Candidate would have been: install root = consumer-adapter node_modules; manifest sourceRevision=717cd0cae version 0.1.2-alpha.5; Patch-1 as deployment-local delta.
  3) packaged continuity E2E (discovery/isolation/boundary) = BLOCKED by (2) (requires candidate runtime).
  Provenance so far remains: 717cd0cae -> official build record -> 253 tarballs -> adapter -> consumer(patched, sha 18dc3a94...) ; counterfeit PASS; packaged headless/web-boot PASS.
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
NEXT_ACTION = STAGING_RESUME_REQUIRES (a) official M5 prepare CLI or explicit user authorization to create candidate slot via documented m5-release flow; (b) a fixture-composed deterministic workflow probe; (c) candidate E2E. NOT SUPERVISED_LIVE_PROMOTION.
LIVE_RUNTIME identity UNTOUCHED (rev 55101cc59; :3080; profiles/stable; PID external note only).
FINAL CLOSURE SESSION — results:
  A. PATCH_1_RUNTIME_PROBE = PASS(core) + residual: harness /tmp/stage_promo/probe_p1.mjs exercised the REAL packaged tool-workflow execute path (ctx.plugin(toolWorkflow) on packaged libs) with an engine at the documented ctx.workflowEngine seam executing the script via agent() fixture (AUTH_A). Positive: spilled=true, spill file .agent/workflow-results/<runId>.json created, spill payload sha == JSON(fixture) sha (947104a1cf4bed9d31d872332ae50089bdbd3c911c131000f1936a902d61238d; 15010 chars), returned/model-visible text bounded (10088 chars incl truncation marker), runId present. RESIDUAL(P2): locator note absent from rendered text because the OLD-STABLE patch itself never attaches spilledFile to the returned tool value (render reads value.spilledFile which is undefined) — pre-existing behavior of the copied authorized delta, not introduced here; file+runId recover full payload. NO_SPILL_BELOW_THRESHOLD = PASS (small fixture -> no file, inline preserved, exact).
  B. M5_CANDIDATE = READY_TO_EXECUTE (NOT BLOCKED_BY_API_SURFACE): m5-release.ts exports slotDir/recordManifest/approveRelease/readManifest/validateSlot/resolveActive/readPointerMeta/promote/rollback/installCanaryProbe/runCanary + canonicalManifest/ReleaseManifest; m5-deployment.spec proves exact call order (recordManifest(deployRoot,name,{releaseId,version,sourceRevision},critical) then validateSlot). One-shot glue place: /tmp/stage_promo/m5root (new deployRoot; candidate slot; install root from verified patched consumer). NOT EXECUTED this session.
  C. CANDIDATE CONTINUITY E2E = gated by B (not executed).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL ; STAGING_INCOMPLETE = true
NEXT_ACTION = STAGING_RESUME_EXECUTION (run M5 one-shot glue -> validateSlot+canary -> candidate :3099 -> continuity E2E -> provenance; single focused session). NOT SUPERVISED_LIVE_PROMOTION.
LIVE_RUNTIME identity UNTOUCHED (rev 55101cc59, :3080).

FINAL EXECUTION CLOSURE (latest) — result:
  PATCH_1_LOCATOR_CLOSURE = NOT_COMPLETED: attempted minimal data-flow fix (attach spilledFile to returned tool value + optional output-schema property) on the deployment-local patched lib; value-prop fix caused output-schema rejection (additionalProperties:false) and bundled-lib schema edits proved fragile in this packaged artifact. Restored the authorized patch byte-exact (sha 18dc3a942b993a0a4829c6edc9624d4079af119e556a1cddab85ac35607e1703; node --check PASS; 5 spill anchors). Locator absence in rendered text is a PRE-EXISTING P2 residual of the authorized old-stable patch (spilledFile never surfaced; runId + documented .agent/workflow-results/<runId>.json convention recover the file). Patch scope NOT expanded.
  M5_CANDIDATE / candidate :3099 / continuity E2E = NOT EXECUTED (budget boundary; M5 API surface already proven sufficient; glue place /tmp/stage_promo/m5root).
  Probe core evidence (prior runs, authorized patch): spill executed, file exists, payload sha == 947104a1..., bounded render; NO_SPILL PASS.
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
NEXT_ACTION = STAGING_RESUME_EXECUTION (dedicated session: M5 one-shot glue -> validateSlot/canary -> candidate :3099 -> continuity E2E; Patch-1 locator optional P2). NOT SUPERVISED_LIVE_PROMOTION.
LIVE_RUNTIME identity UNTOUCHED (rev 55101cc59; :3080).
