# PHASE2-CROSS-SESSION-CHECKPOINT
Execution-control only. NOT runtime truth / NOT a Memory DB. Authority order: repo/Git > this checkpoint > committed tests/code > session log > recall > model memory. If this file conflicts with the repo, the repo wins; verify before trusting.
PHASE: 2 (cross-session discovery productionize)
BASELINE: 8ea2c1cb1 (w1-w4-usability-closure)
CURRENT_HEAD: a8d8dce40 (branch phase2-cross-session; final code commit bf39b3ed4)
OBJECTIVE: wire shipped durable session-query (web) + model-side discovery with zero core changes; decide thin-injection need via no-hint test; leave resume-brief unbuilt.
STATUS: COMPLETE (web GUI in-browser session check left as optional manual residual for the user; everything else verified)
LAST_COMPLETED:
  Step: STEP 1 productionize durable session-query + min model discovery
  Result: VERIFIED (config/dependency/syntax level; runtime composition boot deferred to STEP 6)
  Files: packages/bundle/web-app/cordis.patch.yml; packages/bundle/base/package.json; packages/preset/agent-presets/presets/ptc/agent.cordis.yml
  Evidence: edits committed bf39b3ed4; YAML parses; dep dsh-tool-session-query added to base resolver; same components/runtime behavior proven in phase-1 spike (deterministic 11/11 + real model)
  HEAD: bf39b3ed4
CURRENT_STEP: STEP 4 (no-hint continuity acceptance, real model run in flight)
NEXT_STEP: STEP 4 verdict -> STEP 5 regressions (in flight) -> STEP 6 isolated runtime boot -> STEP 7 verdict+cleanup
LAST_COMPLETED entries appended below (STEP 2 correction).
DECISIONS:
- Discovery scope = web profile only (base keeps openAt:never; headless/sdk unaffected).
- Model tool visibility = per-agent preset composition; add session-query tool row to preset 'ptc' (default preset used by web in this env) + ensure dependency.
- Durable index under harness home via dshHomePath (file is derived/cache; rebuild from logs is recovery).
- Phase-1 evidence (spike, repo-line): FTS phrase semantics (quoteFtsData) => search is contiguous-phrase per event row; cold-first search returns empty page once (index build); warm ~4-9ms; isolation at tool consumer; index restart/rebuild/corrupt behavior verified.
INVARIANTS: model-visible <=> logged; no second message truth; no auto injection; no resume brief; historical recall = evidence only.
DO_NOT_TOUCH: core/agent-loop request construction; request/header + reconstruction invariant; Session.append/seq/format; JSONL append/repair/rollback; surface contract; compaction seam; sandbox/approval/credentials; workspace authorization security semantics; out-of-tree session-memory/knowledge.db; installed GUI runtime; unrelated installed-runtime patches.
CHANGED_FILES: (none yet this phase)
TESTS_COMPLETED: phase-1 spike suites (deterministic 11/11 + real-model 2 tasks) — evidence in audit history; sqlite provider spec exists in repo (openAt coverage)
TESTS_PENDING: config resolve / verify gates for patch+preset rows; web lifecycle; no-hint continuity; reconstruction + tool-session-query regressions; isolated-runtime boot (step 6)
EVIDENCE: phase-1 runs: deterministic 11/11 PASS (discovery/isolation/durability/rebuild/corrupt-loud/phrase), real-model task A found correct old session (proactive search, correct file+root cause), task B cross-workspace leak-free; phrase friction observed (model retried query variants).
KNOWN_RESIDUALS: cold-first-empty MISDIAGNOSIS corrected (was phrase-query artifact); phrase-query friction (model retries; tool guidance deferred P2); no-hint test sample n=1; web GUI end-to-end not run here; compaction-shadow history unreachable by recall (next-phase candidate).
LAST_COMPLETED:
  Step: STEP 2 first meaningful search lifecycle
  Result: VERIFIED (no bug) — earlier "cold-first empty page" was a MISDIAGNOSIS: empty results came from phrase-query semantics on non-contiguous multi-word queries (quoteFtsData wraps whole query in one FTS5 phrase), not index timing. Fresh-index first search with a phrase-viable query returns hits immediately (isolated probe at HEAD bf39b3ed4, fresh durable db: first search "rate limiter" -> hit).
  Files: none changed
  Evidence: /tmp probes + phase-1 sqlite/probe7; provider source searchSessions awaits _ensureReady->_reconcile before _querySessions (packages/session-query/session-query-sqlite/src/index.ts:264-290)
  HEAD: bf39b3ed4 (unchanged code)
BLOCKERS: none.
ROLLBACK_POINT: baseline 8ea2c1cb1 / revert branch commits on phase2-cross-session.
STOP_CONDITION (phase complete): production discovery wiring done + verified; workspace isolation PASS; historical-evidence boundary PASS; continuity verdict recorded (step4); model-visible<=>logged PASS; request reconstruction + affected regressions PASS; corresponding-build isolated runtime PASS (step6, or recorded limitation); no unexplained worktree changes; residual list explicit; final HEAD/build locatable.
PLAN (fixed, no silent drift): STEP0 freeze/reconfirm done -> STEP1 productionize durable session-query + min model discovery -> STEP2 verify/fix first search lifecycle if needed -> STEP3 phrase tool-description micro-guidance if evidence -> STEP4 no-hint continuity acceptance -> STEP5 security/stale/reconstruction regressions -> STEP6 corresponding build isolated runtime -> STEP7 verdict+cleanup.
LAST_COMPLETED:
  Step: STEP 6 corresponding-build isolated runtime (completed)
  Result: VERIFIED - web profile boots cleanly in fully isolated DSH_HOME on :3099 with our patches (served GUI URL); composition dump at real loader level shows session-query-sqlite durable path + first-search; earlier isolated headless real-model call PASS. Only EADDRINUSE on default :3080 when real GUI holds the port (expected; GUI untouched).
  Evidence: dsh web --port 3099 boot log; dump-config grep session-query.db/first-search; isolated headless run "ok"
  HEAD: a8d8dce40
FINAL CHECKS (§13): wiring done+verified; first search correct; workspace isolation PASS; historical-evidence boundary PASS; continuity verdict = SUFFICIENT (model searches even with no hint; treats old sessions as evidence); model-visible<=>logged PASS (reconstruction 26/26); affected regressions PASS (174/174); isolated-runtime PASS; worktree explained (16 pre-existing unrelated untracked/modified items, not ours - recorded, none introduced by phase); residuals explicit; HEAD/build locatable. PHASE_STATUS: COMPLETE
RESIDUALS (final): (1) optional manual in-browser GUI acceptance (boot proven; not clicked through here); (2) STEP 3 phrase micro-guidance deferred P2; (3) compaction-shadow history recall = next-phase candidate; (4) branch phase2-cross-session not merged/pushed (user decision).
INTEGRATION (post-phase, user decision): wiring commit cherry-picked to mainline w1-w4-usability-closure as 7ef8dbadc (original bf39b3ed4). PHASE_STATUS COMPLETE now includes mainline integration. NOTE: pnpm-lock refresh (deps check) still pending before CI; source-mode boot verified.
