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
M5 EXECUTION (this session):
  M5_CANDIDATE = PASS — /tmp/stage_promo/m5root/slots/candidate: install root copied from verified consumer (1.0G); recordManifest via official m5-release.ts (releaseId stage-candidate-2, version 0.1.2-alpha.5, sourceRevision 717cd0cae92788a7f5355546b2ba643fc71edb67, statePolicy shared-compatible, critical {dsh(lib/bin.js), dsh-tool-workflow, dsh-tool-session-query, cordis}); manifest written; artifactDigest c33a1cc09bfaeb81...; validateSlot ok:true failures:[] (manifest integrity/digest/realpath confinement incl node_modules forest PASS); active pointer before=none after=none (candidate INACTIVE; promote() never called).
  M5_CANARY = FAIL (lineage-specific blocker): m5v2-deploy canary probe expects the legacy persistence handle (.m5-canary-probe.mjs handle.append), incompatible with the candidate's current-lineage persistence API -> TypeError handle.append undefined. Not a candidate defect; would require a candidate-lineage canary probe (new M5 code, out of scope). Candidate web boot from slot (independent): PASS :3099 (GUI URL, 0 error lines).
  CANDIDATE_COUNTERFEIT_AUDIT = PASS (candidate install 253 internal == consumer closure; workflow sha 18dc3a942b993a0a...; tool-browser 0.1.2-alpha.5; 0 55101cc; 0 registry internal in candidate lock).
  CONTINUITY E2E (discovery/isolation/boundary) = NOT EXECUTED (canary gate already prevents PASS; listed pending).
  PATCH_1_LOCATOR_RESIDUAL = ACCEPTED_P2 (authorized sha 18dc3a94...).
STAGE_PROMOTION_VERDICT = PASS_WITH_RESIDUAL
STAGING_INCOMPLETE = true
BLOCKER = M5_CANARY lineage API mismatch (probe from old-lineage m5v2 tooling vs candidate current-lineage API). NEXT_ACTION = STAGING_RESUME (candidate-lineage canary probe or accept lineage-scoped canary definition) then continuity E2E -> then SUPERVISED_LIVE_PROMOTION decision. NOT promoted; live untouched.
LIVE_RUNTIME identity UNTOUCHED (rev 55101cc59; :3080; PID 66861 external).
FINAL GATE — ALL ITEMS CLOSED (execution evidence):
  M5_CANARY_CURRENT_LINEAGE = PASS — probe /tmp/stage_promo/m5-canary-current-lineage.mjs against CANDIDATE packaged persistence (coordinator API create/append/load), closed 2-event turn, reopen from fresh ctx; writtenHash==readHash 88f8ae4f8a2851a05494e13174003177ba952da7237fc34a027e29006aec23ad; readEvents==2; REAL_RC=0; isolated home; stderr empty. (M5_CANARY_LEGACY = FAIL_LINEAGE_MISMATCH preserved as history; probe migration, not waiver.)
  CANDIDATE_WEB_3099 = PASS (candidate slot install boot; GUI URL; 0 error) [prior]
  CANDIDATE_COUNTERFEIT_AUDIT = PASS [prior: 253==consumer, workflow sha 18dc3a94..., tool-browser 0.1.2-alpha.5, 0 55101cc, 0 registry internal]
  CONTINUITY E2E (candidate packaged runtime, isolated home, real model): CROSS_SESSION_DISCOVERY = PASS (model searched; found session A1 seq3; exact fact ALPHA-Q9K-77621); HISTORICAL_BOUNDARY = PASS (OLD_VALUE_41 recalled as history; NEW_VALUE_87 declared current authoritative and used); WORKSPACE_ISOLATION = PASS (bLeakInToolResults=false; 0 B content in tool results; the single BETA token echo in the answer came from the user's own question string, not B1) ; MODEL_VISIBLE_RECALL_LOGGED = PASS (25 tool/call + 25 tool/result in session log).
  PROVENANCE_CHAIN = PASS — 717cd0cae -> official build record -> 253 tarballs -> adapter -> consumer -> authorized Patch-1 (18dc3a94...) -> M5 candidate (manifest sourceRevision 717cd0cae, artifactDigest c33a1cc0...) -> current-lineage canary PASS -> candidate :3099 -> continuity E2E.
STAGE_PROMOTION_VERDICT = PASS_WITH_ACCEPTED_P2
STAGING_INCOMPLETE = false
NEXT_ACTION = SUPERVISED_LIVE_PROMOTION (user-gated; do NOT execute promote()/3080/global/stable)
ACCEPTED_P2 = Patch-1 locator not in rendered text (recover via runId + .agent/workflow-results/<runId>.json convention); M5_CANARY_LEGACY lineage mismatch preserved as historical record.
LIVE_RUNTIME = UNTOUCHED (rev 55101cc59; :3080; profiles/stable; PID 66861 external note).
SUPERVISED_LIVE_PROMOTION — execution result:
  Pre-promote verification = PASS (candidate manifest stage-candidate-2 0.1.2-alpha.5 sourceRevision 717cd0cae927... artifactDigest c33a1cc09bfaeb81; workflow sha 18dc3a942b993a0a; live identity rev 55101cc59 :3080 PID 66861 unchanged).
  promote() NOT CALLED — BLOCKED_ON_ENVIRONMENT_MODEL (decision, not deferral):
    (1) promote(deployRoot, slot, fallbackStable) requires a real stable slot for rollback/fallback; /tmp/stage_promo/m5root has only candidate. Promoting now would leave ROLLBACK=UNAVAILABLE, violating the rollback-on-failure requirement of this very operation.
    (2) The real :3080 GUI is NOT M5-managed: no active pointer exists in any deploy root; the live runtime is the nvm-global dsh (55101cc59) launched independently. M5 promote inside /tmp/stage_promo/m5root cannot become the live GUI; a true 3080 cutover would require global/profile replacement (explicitly outside authorization) or operator restart of the GUI from an M5-managed install (no such managed stable exists).
  Safe evidence retained: candidate validated (validateSlot ok), active before/after none (never promoted), :3080 still old stable, live identity untouched.
  Operator runbook (if M5-managed live is desired): (a) snapshot live runtime -> slots/stable (recordManifest with sourceRevision 55101cc59) OR declare acceptance of candidate as first slot with previous=null rollback semantics; (b) promote(m5root,'candidate','stable'); (c) verify readPointerMeta active/previous + validateSlot(active); (d) operator restarts the :3080 service from slots/candidate/install (isolated or migrated DSH_HOME decision); (e) live smoke; (f) on failure rollback(m5root). Any 3080 cutover that replaces the process hosting this agent session must be executed by the operator, not by the agent it hosts.
LIVE_PROMOTION = NOT_EXECUTED (safe; blocked on environment model; candidate intact; nothing promoted/touched)
LIVE_RUNTIME = UNTOUCHED (rev 55101cc59; :3080 PID 66861; profiles/stable/global).
LIVE PROMOTION PREP — all PASS, cutover NOT executed:
  M5_STABLE_SNAPSHOT = PASS (stable slot = byte-faithful cp -R snapshot of live nvm 55101cc runtime incl patched workflow sha 18dc3a94...; self-contained 1.1G; realpaths in-slot; BIN_OK)
  STABLE_MANIFEST/DIGEST/CONFINEMENT = PASS (stable-bootstrap-55101cc; artifactDigest 346882bc30a890f1; validateSlot ok)
  STABLE_SLOT_BOOT = PASS (:3097 isolated home served GUI, 0 error)
  M5_TOPOLOGY = ESTABLISHED (control-plane promote only; :3080 untouched): active=candidate(stage-candidate-2)/previous=stable, gen 1; both validate true
  LIVE_HOME_COMPATIBILITY = PASS_WITH_SNAPSHOT (SESSION_FORMAT_VERSION 0 both lines; snapshot ~/.dsh before cutover required)
  ROLLBACK_EXECUTABLE = PASS
  LIVE_RUNTIME still 55101cc59 / :3080 (PID 66861) UNTOUCHED; global dsh NOT replaced
LIVE_PROMOTION_PREP = PASS
LIVE_PROMOTION = NOT_YET_EXECUTED
NEXT_ACTION = EXTERNAL_OPERATOR_LIVE_CUTOVER
LIVE CUTOVER RUNBOOK (operator; resolved paths):
DEPLOY=/tmp/stage_promo/m5root; ACTIVE=$DEPLOY/slots/candidate/install; STABLE=$DEPLOY/slots/stable/install
A preflight: lsof -iTCP:3080 (record PID); installed rev == 55101cc593ac3b498f1264eb75ebfc67c33af32b
B stable valid: active=candidate/previous=stable, both validateSlot true
C candidate: digest c33a1cc0..., workflow sha 18dc3a94..., sourceRevision 717cd0cae927...
D snapshot home: ditto ~/.dsh ~/.dsh.pre-candidate-<ts>  (REQUIRED; sessions ~481MB)
E stop old :3080 (operator-owned; never from an agent hosted by it)
F launch candidate: DSH_HOME=~/.dsh node $ACTIVE/lib/bin.js web
G verify sourceRevision 717cd0cae927... + GUI token
H smoke: GUI load, 0 loader/config error, PTC boot, tool-session-query registered, one model request, one tool call, historical search reachable, workspace auth intact
I PASS -> leave running; J FAIL -> kill candidate;
K pointer rollback: m5.rollback($DEPLOY) -> active=stable; L launch stable: DSH_HOME=~/.dsh node $STABLE/lib/bin.js web; M verify 55101cc593ac3b498f1264eb75ebfc67c33af32b restored
NO live debugging / hot patching / rebuild on failure.

LIVE CUTOVER — OPERATOR RUN (this session):
  PHASE A = PASS on identity: :3080 listener PID 66861; installed rev 55101cc593ac3b498f1264eb75ebfc67c33af32b; stable manifest (stable-bootstrap-55101cc, rev 55101cc593ac3b498f1264eb75ebfc67c33af32b, artifactDigest 346882bc30a890f18815c1285bcc5d2f0b7c6adcae5ebe5f468efec509a1f108); candidate manifest (stage-candidate-2, rev 717cd0cae92788a7f5355546b2ba643fc71edb67, artifactDigest c33a1cc09bfaeb81dabb3d4cc33b7a355ce4ca48a4d03d30d2fda21ec546aff9); patch hash both slots 18dc3a942b993a0a4829c6edc9624d4079af119e556a1cddab85ac35607e1703.
  BLOCKER (decisive): the cutover operator required to STOP :3080 is HOSTED BY the :3080 process (agent worker tree is a descendant of listener PID 66861). Stopping :3080 from inside this session terminates the executor before PHASE E identity / F smoke / rollback can run, violating the operation's own rollback guarantee. Consistent with earlier ruling SELF_HOSTED_3080_CUTOVER = FORBIDDEN.
LIVE_PROMOTION = NOT_EXECUTED
REASON = SELF_HOSTED_PRE_CUTOVER_BLOCK (executor hosted by target process)
LIVE_RUNTIME = original 55101cc59 (PID 66861, untouched)
FULL OPERATOR HANDOFF VALUES: deployRoot=/tmp/stage_promo/m5root; candidate install=$deploy/slots/candidate/install (lib/bin.js); stable install=$deploy/slots/stable/install; candidate rev 717cd0cae92788a7f5355546b2ba643fc71edb67 digest c33a1cc09bfaeb81dabb3d4cc33b7a355ce4ca48a4d03d30d2fda21ec546aff9; stable rev 55101cc593ac3b498f1264eb75ebfc67c33af32b digest 346882bc30a890f18815c1285bcc5d2f0b7c6adcae5ebe5f468efec509a1f108; patch sha 18dc3a942b993a0a4829c6edc9624d4079af119e556a1cddab85ac35607e1703; M5 rollback call: import m5-release.ts then m5.rollback('/tmp/stage_promo/m5root') (pointer active->stable). Snapshot before cutover: ditto ~/.dsh ~/.dsh.pre-candidate-<ts>.

M5 LAUNCHD SUPERVISOR INTEGRATION (this session) — implemented, tested, NOT activated:
SUPERVISOR_M5_INTEGRATION = READY ; LIVE_PROMOTION = NOT_EXECUTED ; LIVE_RUNTIME = 55101cc59 (:3080 PID 66861, never restarted)
  ROOT CAUSE (located precisely): the node that hard-bound the global NVM runtime was NEITHER the plist NOR the launcher — it is dsh-doctor's findRealDsh() (profiles/web/.../dsh-doctor/lib/cli.mjs), which resolves runtime identity by scanning $PATH for `dsh` and taking the first hit. The plist merely pins PATH to the nvm bin. Authority graph: launchd -> com.dsh.web.plist -> ~/.dsh/bin/dsh-web-launch.sh -> dsh-doctor findRealDsh($PATH) -> global nvm dsh -> :3080.
  TOPOLOGY_RECONSTRUCTION = PASS (launchctl print gui/501/com.dsh.web: properties = keepalive|runatload, ThrottleInterval 15, runs 119, program = ~/.dsh/bin/dsh-web-launch.sh; listener 66861 <- 66858 <- launchd)
PERSISTENT DEPLOY ROOT = /Users/bohongchen/.dsh-deploy   (was /tmp/stage_promo/m5root)
  CAN_LAUNCHD_DURABLY_DEPEND_ON_TMP_DEPLOY_ROOT = NO — measured, not assumed: boot was Sat Sep 5 00:42:02 2026 and NOTHING in /private/tmp predates it (boot-time clear); com.apple.tmp_cleaner runs daily 00:00; /private/tmp is drwxrwxrwt world-writable, unfit as a live trust root; this checkpoint itself called it a "One-shot glue place".
  MIGRATION = atomic rename (same device 16777230), user-chosen; zero extra bytes, byte-faithful by construction. Verified: all 8 critical lib digests and file counts (stable 42212 / candidate 32675) identical pre/post.
  IDENTITY PRESERVED: artifactDigest is content-based and path-independent (assessInstall keys evidence package-root-relative), so both digests survived relocation unchanged — stable 346882bc30a890f18815c1285bcc5d2f0b7c6adcae5ebe5f468efec509a1f108, candidate c33a1cc09bfaeb81dabb3d4cc33b7a355ce4ca48a4d03d30d2fda21ec546aff9; Patch-1 18dc3a942b993a0a4829c6edc9624d4079af119e556a1cddab85ac35607e1703 in both slots; validateSlot ok:true failures:[] for both.
  Manifests re-recorded with the OFFICIAL recordManifest (identity fields carried verbatim; installRoot recomputed by the API). installRoot is inside canonicalManifest, so the approval digest necessarily changes on relocation and registerApproval is fail-closed on re-binding — a FRESH approvals registry was therefore required. New approvals: stable-bootstrap-55101cc 7567e05c2f66d3a218eca7a4e17cf94eedc59c3a078d0b00acb955f12a13509b ; stage-candidate-2 005a56573c85add604ea8a64f420b7484e17b379ab604f000e777444172c2b11. Pre-migration manifests + old approvals preserved at ~/.dsh-deploy/supervisor-backup/pre-migration-manifests/.
  CONTROL PLANE (restored to the original topology): generation 4, active=candidate(stage-candidate-2), previous=stable(stable-bootstrap-55101cc). Generations 1->4 are this session's rollback/promote test transitions, all control-plane only.
SUPERVISOR AUTHORITY (new, staged):
  launcher   /Users/bohongchen/.dsh-deploy/bin/dsh-m5-web-launch.sh          sha256 4c3dff37623108a5bca7840db0d7c701979de63d6a144ebf2f94eb8e91a3b7b9
  resolver   /Users/bohongchen/.dsh-deploy/bin/resolve-active-entry.mjs      sha256 b511194a4435a0cafbea2fdb776fe28b28a2c0d693a6066718b0324506cff798
  restore    /Users/bohongchen/.dsh-deploy/bin/restore-original-supervisor.sh   (--check | --apply)
  staged plist ~/.dsh-deploy/supervisor-backup/com.dsh.web.m5.plist          sha256 8d5d2dc776d20369dc8035a94f43f748ea2ca385cb69c841a672bc4b3b8d984c  (plutil OK; NOT installed)
  ACTIVE-SLOT RESOLUTION SEMANTICS: read active-pointer.json (M5 schema) -> readlink(active) relative to slots/ -> require pointer==metadata (same rule promote() enforces) -> read slot release-manifest.json -> require manifest.releaseId == pointer releaseId -> realpath-confine installRoot inside the slot -> entry = installRoot/node_modules/@deepseek-ai/dsh/<criticalPackages['@deepseek-ai/dsh'].lib> -> realpath-confine entry inside installRoot -> print. Refuses 'migrating' statePolicy, mirroring promote().
  WHY A READER AND NOT A CALL INTO m5-release.ts: that module is TypeScript inside node_modules, which Node 22 refuses to type-strip (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — unusable from a boot path without a copy hack; and validateSlot() rehashes ~75k files (minutes), which a KeepAlive boot path must not do. Full validation stays an operator/promote-time gate, where promote() already enforces it. The reader implements only the CHEAP invariants using the same constants/semantics, and PARSER_EQUIVALENCE is asserted by test (resolver entry == official resolveActive()+readManifest() entry), so it is a strict subset, never a divergent parser.
  RESTART SEMANTICS: launchd is the sole spawner. Each spawn re-runs the resolver, so runtime identity is re-read from M5 on every start. Promotion primitive = `launchctl kickstart -k gui/$UID/com.dsh.web`.
  ROLLBACK SEMANTICS: m5.rollback(deployRoot) then kickstart -k. Single authority: no profile-selected and no hard-coded runtime version remains in the boot path.
  FAIL-CLOSED: on missing/ambiguous/invalid M5 state the launcher exits non-zero with an explicit reason and starts NOTHING. It must never fall back to the global NVM dsh — that would be a silent identity drift while the control plane still claimed the active slot.
ORIGINAL SUPERVISOR BACKUP (byte-faithful, persistent — NOT in session scratch):
  ~/.dsh-deploy/supervisor-backup/com.dsh.web.plist   sha256 4114a71cbd43e89defb4760ddbb2b4e787c4aa2596ef533c26719d18121e03f2  -rw-r--r-- 1094B
  ~/.dsh-deploy/supervisor-backup/dsh-web-launch.sh   sha256 35d477f6381c6355aa0eece77b74a067ed5ee79fea4e4960b25fed080c2bbc31  -rwxr-xr-x 2798B
  launchctl state at capture: com.dsh.web pid 66858, runs 119, last exit 0, program ~/.dsh/bin/dsh-web-launch.sh
  RESTORATION PROCEDURE (executable, not theoretical): restore-original-supervisor.sh --apply  = verify backup SHAs -> bootout -> restore both files byte-exact -> bootstrap -> re-verify SHAs -> print RESTORE_ORIGINAL_SUPERVISOR = PASS/FAIL. EXECUTED --check this session: backup integrity OK, live files already original, exit 0.
TEST EVIDENCE:
  T1 active=candidate -> resolves candidate install, rev 717cd0cae..., bin digest a257662e22f5493acd6c1646c5a288b20eeeb5349717da91fe47e6f09aae15bb = PASS
  T2 active=stable    -> resolves stable install,    rev 55101cc59..., bin digest dc23f6c5dd7df8834e3e38bdb9609d77b459834681ae9b7133b417b0c35f3166 = PASS
  T3 real m5.rollback(candidate->stable) changes the resolved target deterministically = PASS
  T4/T5/T6 + fail-closed suite = 12/12 PASS (ambiguous pointer/meta 13, missing meta 11, malformed meta 11, no active symlink 12, releaseId mismatch 16, missing slot 14, missing manifest 15, missing entry 18, missing deploy root 10, entry symlink escape 19, migrating statePolicy 20, plus a well-formed control that resolves). T6's escape target was deliberately the GLOBAL NVM dsh and was REFUSED.
  T7 launchd restart durability = PASS — proven on a SEPARATE temporary job (com.dsh.m5test, :3098, bootstrapped from scratch space so ~/Library/LaunchAgents was never touched): KeepAlive respawn after kill -9 (runs=2) and kickstart -k (runs=3) each re-ran the resolver and re-resolved M5 active; job booted out afterwards, port released, no residue.
  T8 no global dependency = PASS — boot probes ran with PATH=/usr/bin:/bin:/usr/sbin:/sbin (no `dsh` on PATH at all); only the node executable comes from nvm; neither launcher nor resolver references the global DSH package. Note dsh-doctor's findRealDsh() would have FAILED outright in this environment, which is precisely the old coupling.
  T9 original stable restoration = PASS trivially — :3080 was never stopped, restarted, or repointed at any moment; PID 66861 is the same process throughout.
  Isolated-port boots: stable slot on :3097 served the GUI token URL with 0 error lines; candidate slot on :3098 under real launchd likewise. `exec` replaces the shell, so listener PID == launcher PID: launchd supervises the runtime process directly, one process, no extra layer.
  PARSER_EQUIVALENCE = PASS (resolver entry identical to official resolveActive()+readManifest() derivation).
CORRECTIONS TO EARLIER RECORD:
  (1) The handoff value "candidate install=$deploy/slots/candidate/install (lib/bin.js)" and runbook step F "node $ACTIVE/lib/bin.js web" are WRONG for candidate: that path does not exist. Only the stable slot has install/lib/ (it is a cp -R of the global package). The correct, uniform entry is manifest-driven: <installRoot>/node_modules/@deepseek-ai/dsh/<criticalPackages['@deepseek-ai/dsh'].lib>.
  (2) `dsh web` with no --port defaults to 127.0.0.1:3080 (verified: a no-port probe failed with EADDRINUSE on 3080 and exited without disturbing the live service). The cutover therefore needs no port argument.
DEPRECATED — MUST NOT BE USED AS THE LIVE RUNBOOK:
  "stop :3080 then manually start candidate" is RETIRED. With KeepAlive=true it creates a launchd-respawn vs manual-start race and leaves the candidate outside supervision. Runtime spawning belongs to launchd alone; promotion is a control-plane change plus a supervised restart.
P1 BLOCKER FOR THE FINAL LIVE PROMOTION (discovered this session, NOT resolved — user decision required):
  The live :3080 GUI is composed by the `--profile web` layer, which the M5 slot does not contain. Absent from the candidate slot: @linxin666/dsh-web-all, dshmarket, dsh-plugin-subscriptions, @tt-a1i/archify-dsh, @bohongchen/dsh-governance-gate. Also profile-level only (cordis.patch.yml): governance-gate, mcp-observability, mcp-knowledge, subagent-codex-safe / subagent-claude-code-safe + their tool-subagent instances, web-ui-doctor autoMigrate:false, tool-browser. The profile additionally pins @deepseek-ai/dsh-tools / dsh-session-projection / dsh-attachment / dsh-home-paths to 0.1.1-rc.2 and tool-browser to 0.1.0 — a DIFFERENT lineage from the slot's 0.1.2-alpha.5.
  So `node <slot-entry> web` yields a correct M5-authoritative runtime but NOT today's GUI. Resolving this is a prerequisite for cutover, and the two options conflict: (a) M5 slot as sole authority => those plugins are dropped from the live GUI; (b) keep --profile web => the forbidden dual authority (M5 pointer + profile-selected versions) returns. Choosing between them is a user decision, deliberately left open.
NEXT_ACTION = FINAL_LIVE_PROMOTION (separate, user-gated round), gated on the P1 profile-composition decision above.

PROFILE COMPOSITION RECONCILIATION (this session) — P1 CLOSED; live still untouched:
PROFILE_COMPOSITION_RECONCILIATION = PASS ; CORE_LINEAGE_AUTHORITY = M5_ACTIVE_SLOT_ONLY ; LIVE_PROMOTION = NOT_EXECUTED ; LIVE_RUNTIME = 55101cc59 (:3080 PID 66861, launchd runs=119 unchanged all session)
SUPERVISOR_INTEGRATION_BASE_COMMIT = 69038ca0c393e286e0747e3933c51bb86eb4f98e
  CORRECTED MODEL — the previous round's P1 framing was wrong in two ways, both now measured:
   (1) `web` is a HARDCODED ALIAS for `--profile web` (dsh/lib/bin.js args module). The launcher was ALWAYS booting the profile layer; the earlier "composition is absent" reading came from probing with an EMPTY DSH_HOME, which auto-initialized a fresh shipped template profile. No launcher change was needed.
   (2) The declared pnpm.overrides pinning dsh-tools/dsh-session-projection/dsh-attachment/dsh-home-paths to 0.1.1-rc.2 NEVER MATERIALIZED: those four are peerDependencies and have no resolution entries in the profile lockfile; the installed tree served them at 0.1.2-alpha.5. They were never the real defect.
  THE REAL DEFECT: all 266 entries of ~/.dsh/profiles/node_modules/@deepseek-ai are symlinks INTO THE GLOBAL NVM INSTALL. External web plugins declare their @deepseek-ai imports as peerDependencies with an EMPTY dependencies map, so Node walks up from each plugin's realpath and lands in that store. The M5 pointer would have chosen the core entry while the global install supplied every bundle and peer package. Both sides are version 0.1.2-alpha.5, so this is a LINEAGE divergence that satisfies every semver range and loads silently — the exact dual authority §6 forbids.
COMPOSITION ARCHITECTURE (implemented):
  launchd -> dsh-m5-web-launch.sh -> resolve-active-entry.mjs (core entry, active slot)
                                  -> verify-composition-anchor.mjs (fail-closed lineage gate)
                                  -> exec node <slot entry> web --no-open
  Profile decides WHICH extensions load and their configuration. It no longer decides WHICH core runtime backs them. Slot-provided names are linked THROUGH <deployRoot>/active, so composition follows promote()/rollback() with no edit.
  anchor-composition.sh <home> --check|--apply|--restore   sha256 c7838f601fdb2c23a5973ec8a0c9a0051480304f0a44a829bfd6ffd2ed7d93e9
  verify-composition-anchor.mjs                            sha256 91c729a0231066b90dc0c6b7fbecfe1279801fb1399f60eb0903e68dd07676b1
  dsh-m5-web-launch.sh (now gates on the verifier)         sha256 56d5f04592a90ba812460bf19bd0be91bd78ec1fa556c9dacb5cfdb61a73df64
  ANCHOR RULE (three cases, deliberately not "repoint everything"): a name the active slot provides -> link through active; a name the slot lacks whose ORIGINAL target was the global install -> drop (global lineage must never survive; use then fails loudly); a name the slot lacks whose original target is PROFILE-LOCAL (local tarball / .dsh-module-fallback) -> LEAVE IT, it is a genuine profile-owned extension.
  ENFORCED INVARIANT: no @deepseek-ai entry may resolve into the global NVM install; every name the active slot provides must resolve INTO the active slot; slot-absent names may resolve inside the profile. Violation exits 30 and the launcher refuses to boot.
COMPONENT CLASSIFICATION:
  A SLOT-OWNED CORE (M5 sole authority) — 146 of the 152 composed entries resolve from the active slot, including cordis + cordis-plugin-*, dsh-tools, dsh-session, dsh-session-projection, dsh-attachment, dsh-home-paths, dsh-llm, dsh-agent, dsh-agent-loop, dsh-system-prompt, dsh-settings, dsh-web-app, dsh-base, dsh-api-*, dsh-client-ui-*, dsh-tool-* (incl. tool-workflow, tool-session-query, tool-subagent, tool-browser), dsh-subagent*, dsh-mcp-client, dsh-agent-presets, dsh-session-query-sqlite.
  B COMPOSITION EXTENSION (profile authority) — @linxin666/dsh-web-all 0.3.12 (19 entries), @linxin666/dsh-i18n, dshmarket 1.44.0, dsh-plugin-subscriptions 0.7.1, dsh-better-sidebar, @tt-a1i/archify-dsh 0.1.0 (loaded as archify-skill-filesystem via dsh-skill-filesystem, providerName archify-plugin). dshmarket and subscriptions declare @deepseek-ai peers with ranges accepting ^0.1.2-alpha.1, satisfied by the slot's 0.1.2-alpha.5; both resolve their peers INTO the slot after anchoring.
  C LOCAL/PATCHED EXTENSION — @bohongchen/dsh-governance-gate (link: ~/Projects/dsh-governance-gate); mcp-observability and mcp-knowledge (stdio, ~/Projects/dsh-{observability,knowledge}/dist/src/server.js, both present); subagent-codex-safe and subagent-claude-code-safe + their tool-subagent instances (config only, implementations from the slot); web-ui-doctor autoMigrate:false; tool-browser insert.
  D OBSOLETE/DUPLICATE (evidence-backed) — the four profile-level copies that SHADOWED the shared store at older lineage: dsh-mcp-client 0.1.0-rc.8, dsh-subagent-claude-code 0.1.1-rc.2, dsh-subagent-codex 0.1.1-rc.2, dsh-tool-browser 0.1.0 (file: tarball). All four exist in the candidate at 0.1.2-alpha.5 and are now anchored there; tool-browser 0.1.0 -> 0.1.2-alpha.5 is precisely the family version fix that DEFINED revision 717cd0cae. Plus 14 shared-store names with no candidate counterpart (dsh-experimental-* x8, dsh-root, dsh-tool-subagent-report, node-addon-landlock-run x2, website) — none referenced by the web composition; dropped, not global-anchored.
EVIDENCE (isolated; real ~/.dsh never modified):
  Test home = APFS clonefile of the real ~/.dsh (1.5G logical, 0 bytes real), including 12 real session directories. One fidelity fix was required and is recorded because it invalidated an earlier reading: the profile's @bohongchen/dsh-governance-gate symlink is RELATIVE (../../../../../Projects/...) and therefore dangled in the clone.
  SILENT-SKIP FINDING (important): a boot with an UNRESOLVABLE @bohongchen/dsh-governance-gate produced ZERO error lines and served the GUI. Plugin load failure is silent for that insert, so "the server started" is NOT evidence the composition loaded. An unresolvable @deepseek-ai/dsh-tool-browser insert, by contrast, hard-fails with ERR_MODULE_NOT_FOUND. Per-plugin resolution evidence is therefore mandatory.
  COMPOSITION_AUDIT = PASS — every entry of the composed tree resolved the way the loader resolves it: 152 audited, 146 from the ACTIVE SLOT, 5 from the profile (web-all, i18n, better-sidebar, subscriptions, dshmarket), 1 local link (governance-gate), 0 from the GLOBAL NVM install, 0 unresolved.
  CANDIDATE ISOLATED SMOKE (real composition, isolated port, cloned real home):
    C1 GUI = PASS (:3099 token URL; unauthenticated 401, tokened 303)
    C2 no core startup/runtime error = PASS (0 error lines; verifier line "271 checked, 258 in the active slot, 0 global-lineage")
    C3 PTC = PASS (candidate ships presets/ptc; settings default preset ptc)
    C4 tool-session-query = PASS (registered by the ptc preset; exercised live below)
    C5 one REAL model request = PASS (real DeepSeek calls, no mock)
    C6 one REAL tool invocation = PASS (25 tool/call + 25 tool/result: session_search, session_trace, session_event_read, session_event_search, session_event_trace)
    C7 historical-session read path = PASS (cross-session discovery recovered ALPHA-Q9K-77621; historical boundary honoured NEW_VALUE_87 over OLD_VALUE_41)
    C8 workspace authorization = PASS (bLeakInToolResults false; the single BETA token in the answer is an echo of the question string, matching the earlier recorded result)
    C9 governance gate = PASS at load/resolution (resolves to ~/Projects/dsh-governance-gate once the clone's relative link is faithful). Functional deny-path exercise = NOT_VERIFIED this round.
    C10 MCP composition = PASS (both servers spawned as REAL child processes of the composed runtime: dsh-observability and dsh-knowledge)
    C11 browser/tool composition = PASS (dsh-tool-browser resolves from the SLOT at 0.1.2-alpha.5, replacing the profile's 0.1.0 shadow)
    C12 safe subagent registration = PASS (providerName codex-safe / claude-code-safe with tool names subagent_codex_safe / subagent_claude_code_safe in the composed tree; implementations from the slot)
  AUTHORITY ATTACKS:
    A1 global dsh absent from PATH = PASS (every boot ran with PATH=/usr/bin:/bin:/usr/sbin:/sbin, no `dsh` on PATH; only the node executable comes from nvm; 0 global-install file handles in the running process. dsh-doctor's findRealDsh() would have failed outright here, which is exactly the old coupling.)
    A2 profile attempts core override = PASS (verifier refuses, exit 30: run against the real unanchored ~/.dsh it reports 265-270 entries resolving into the global install and the launcher will not start)
    A3 missing extension = PASS (removing an anchored entry does NOT fall back to global: it resolves from the slot's own tree, or fails loudly with MODULE_NOT_FOUND; 0 global handles either way)
    A4 wrong-lineage core injected = PASS (same gate as A2; any entry resolving into the global install is refused by name and target before exec)
    A5 active slot change = PASS (composition follows the pointer: with symlinks untouched, a real m5.rollback moved dsh-tools' realpath from the candidate slot to the stable slot). CAVEAT, and it is a real one: dsh-app-boot's MODULE-FALLBACK writes slot-specific links into the profile store during boot, so after a pointer change ~69 entries stay pinned to the previous slot. The verifier catches this (exit 30, "entries the active slot provides resolve elsewhere"), and anchor-composition.sh --apply MUST therefore run after every promote/rollback, before the kickstart. This is now a required runbook step, not an optional one.
    A6 restart = PASS (restarting the composed candidate reproduced activeSlot=candidate, sourceRevision 717cd0cae..., generation 6, verifier OK)
  ROLLBACK PARITY (found and fixed this session): anchoring naively broke the rollback path. The stable slot has NO @deepseek-ai/dsh-tool-browser (it predates the family version fix), so dropping the profile's own 0.1.0 copy made the composed STABLE boot fail with "Cannot find package '@deepseek-ai/dsh-tool-browser'". The three-case anchor rule keeps profile-local extensions, after which the composed STABLE booted cleanly on :3097 (verifier: 268 in the active slot, 1 profile-owned extension, 0 global-lineage; 0 global handles). Rollback recovery is therefore proven, not assumed.
REAL ENVIRONMENT AT CLOSE (unchanged):
  :3080 = PID 66861, global NVM dsh, sourceRevision 55101cc593ac3b498f1264eb75ebfc67c33af32b; launchd com.dsh.web pid 66858, runs=119, program still ~/.dsh/bin/dsh-web-launch.sh
  ~/.dsh/profiles composition deliberately STILL global-anchored (verifier reports 265 global entries by design) — anchoring the live home is a CUTOVER step, because it changes what the currently running global runtime would load on its next restart.
  Control plane: generation 6, active=candidate(stage-candidate-2), previous=stable(stable-bootstrap-55101cc); generations 4->6 are this session's rollback/promote composition tests.
CONCEPT CORRECTION (supersedes any earlier reading): profile != runtime authority. M5 active slot = runtime/core authority; profile/composition = extension authority only. Proven by COMPOSITION_AUDIT (0 of 152 composed entries from the global install) plus the fail-closed verifier, not asserted.
REMAINING LIVE-ONLY VERIFICATION (cannot be done off :3080): real-GUI interactive acceptance on the live port; governance-gate functional deny path; MCP tool round-trips through the live GUI; the live ~/.dsh under a candidate runtime with SESSION_FORMAT_VERSION 0 shared state.
FINAL LIVE PROMOTION RUNBOOK (next round; supersedes every earlier one):
  0 preflight  : lsof -iTCP:3080 (record PID); global sourceRevision == 55101cc593ac...; resolve-active-entry.mjs --explain == candidate/717cd0cae...; validateSlot(stable)==true && validateSlot(candidate)==true
  1 snapshot   : ditto ~/.dsh ~/.dsh.pre-candidate-$(date +%Y%m%d-%H%M%S)   [REQUIRED, ~1.5G]
  2 anchor     : ~/.dsh-deploy/bin/anchor-composition.sh ~/.dsh --check, then --apply   [records originals on first apply]
  3 verify     : DSH_HOME=~/.dsh verify-composition-anchor.mjs  -> must print OK, 0 global-lineage
  4 install    : launchctl bootout gui/$UID/com.dsh.web
                 cp ~/.dsh-deploy/supervisor-backup/com.dsh.web.m5.plist ~/Library/LaunchAgents/com.dsh.web.plist
                 launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.dsh.web.plist
  5 identity   : ~/Library/Logs/dsh-web.log must show activeSlot=candidate, sourceRevision=717cd0cae..., composition OK; :3080 listener cmdline inside slots/candidate/install
  6 smoke      : S1-S8 on the real DSH_HOME (GUI, no core error, PTC, tool-session-query, one REAL model request, one REAL tool call, historical session retrieval, workspace authorization). GUI-reachable alone is NOT a pass; per-plugin resolution evidence is required because plugin load failure can be silent.
ROLLBACK RUNBOOK (no debugging, no hot patch, no rebuild):
  R1 m5.rollback('/Users/bohongchen/.dsh-deploy')                        # pointer -> stable
  R2 anchor-composition.sh ~/.dsh --apply                                 # MANDATORY: module-fallback pins the old slot
  R3 launchctl kickstart -k gui/$UID/com.dsh.web                          # launchd re-resolves -> stable slot
  R4 verify :3080 sourceRevision == 55101cc593ac...; recovery smoke (GUI, no core error, history reachable, real model + real tool)
  R5 if the stable SLOT will not serve: anchor-composition.sh ~/.dsh --restore ; restore-original-supervisor.sh --apply  -> byte-exact original plist + launcher, back to the global NVM dsh
  Data rollback stays SEPARATE: do not restore the ~/.dsh snapshot without explicit evidence of data damage.
STAGE_PROMOTION_VERDICT = PASS_WITH_ACCEPTED_P2 ; STAGING_INCOMPLETE = false
NEXT_ACTION = INDEPENDENT READ-ONLY FINAL REVIEW, then FINAL_LIVE_PROMOTION (user-gated).

FINAL LIVE PROMOTION — EXECUTED (this session):
PROMOTION = PASS ; LIVE_RUNTIME = candidate(stage-candidate-3) @ 114c8087ad1eeb7193b2c05214d7a265a2ef915a
  CAUSE OF THE REFRESH: persistence-catalog fix 5137dae5d (register browser/verify). The superseded candidate 717cd0cae predated it and was NEVER promoted; its install is retained as slots/candidate/install.superseded-717cd0cae and its approval stage-candidate-2 was left un-rebound.
  CANDIDATE REBUILD (M5-authoritative, no semantics changed): clean detached worktree at 114c8087ad (= 5137dae5d + the approved tool-browser family-version align) -> frozen install -> build:official (220 artifacts) -> release/pack.ts --family dsh (244) + --family vendor (9) = 253 -> approved extraction-only adapter -> consumer install -> Patch-1 reapplied (base 3c240ab2 byte-identical to the recorded base -> 18dc3a94...) -> recordManifest('stage-candidate-3') artifactDigest 67d0bc594dba2940f434352b26c3f78d5cda0af622a7539b4143589fb5849da6 -> validateSlot candidate/stable both true.
  SEQUENCE EXECUTED: ditto ~/.dsh -> ~/.dsh.pre-candidate3-20260907-134854 (1.5G) ; m5.promote(candidate,'stable') -> generation 8, active=candidate(stage-candidate-3), previous=stable(stable-bootstrap-55101cc) ; anchor-composition.sh ~/.dsh --apply (backup supervisor-backup/composition-anchor-_Users_bohongchen_.dsh.tsv) ; verify-composition-anchor OK 256/256 in-slot, 0 global-lineage ; launchctl bootout + install com.dsh.web.m5.plist + bootstrap.
  NOTE (now confirmed in practice): promote() rewrites pointer metadata, so the stale previous=stage-candidate-2 recorded by the earlier rollback was corrected automatically; the rollback target is a valid stable.
  POST-PROMOTION SMOKE: :3080 PID 41098 from slots/candidate/install, launchd program=dsh-m5-web-launch.sh runs=1 ; resolver activeSlot=candidate releaseId=stage-candidate-3 sourceRevision=114c8087ad ; composition OK ; GUI unauth 401 / tokened 303 ; 0 error lines ; session-e95cd494 reads with 0 refused of 831205 decoded events and both browser/verify events (#785094,#785130) as first-class known types ; dsh-tool-browser resolves from the candidate slot at 0.1.2-alpha.5 ; fixture sha256 52cf15fc... unchanged (16395837 bytes).
  ROLLBACK REMAINS: m5.rollback(~/.dsh-deploy) -> anchor-composition.sh ~/.dsh --apply -> launchctl kickstart -k gui/$UID/com.dsh.web -> stable 55101cc593ac... ; last resort anchor-composition.sh ~/.dsh --restore + restore-original-supervisor.sh --apply. Superseded material and the pre-cutover home snapshot are retained, not cleaned.
