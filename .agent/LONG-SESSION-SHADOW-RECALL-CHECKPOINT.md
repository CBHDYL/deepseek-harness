# LONG-SESSION-SHADOW-RECALL-CHECKPOINT
Execution-control only. NOT runtime truth / NOT a Memory DB. Authority: repo/Git > checkpoint > committed tests/code > session log > recall > model memory.
PHASE: Long-session Compaction-Shadow Recall (V1)
BASELINE: 8ea2c1cb1 (phase2 base); Phase2 verified HEAD 8d0ea3bb9 on branch phase2-cross-session
CURRENT_HEAD: 8d0ea3bb9 -> branch long-session-shadow-recall (new, parent = phase2 complete)
OBJECTIVE: after compaction, the model can locate and bounded-read shadowed original evidence from the authoritative session log on demand (no Memory/Vector/StateManager/RAG; no auto reinjection; reuse session-query/search/read/authz/session-reference untrusted boundary). Decision rule: CASE A (existing search+read+authz suffice) => PRODUCTION_CODE_DELTA = 0; implement only on blocker evidence, thin read-side extension last.
PHASE_STATUS: IN_PROGRESS
LAST_COMPLETED: none yet (S1 baseline freeze in progress)
CURRENT_STEP: S1 baseline freeze + checkpoint; then S2 read-only capability audit; S3 counterfactual probe (canaries + real compaction, isolated); S4 zero-change recall test; S5 CASE decision; S6 adversarial matrix (repeated compaction, drift, injection, stale repo, moved/deleted file, spill locator, authz, corruption); S7 perf + model acceptance; S8 regressions + counterfactual toggle; S9 verdict + close
NEXT_STEP: S2 audit
DECISIONS:
- No production change before S4 evidence.
- Compaction shadow != tool pruning != spill != archive != persistence. Do not conflate.
- Historical recall result = evidence only / potentially stale / untrusted; never overrides current workspace truth (model must re-check repo for file/line claims).
- Reuse session-reference untrusted phrasing; never new prompt-injection policy.
- If existing system passes all gates unchanged: PHASE_VERDICT=PASS, PRODUCTION_CODE_DELTA=0 (preferable to writing code for the phase's sake).
INVARIANTS: model-visible <=> logged (recall enters context only via tool/call+tool/result); no second truth; no auto history reinjection; bounded recall only.
DO_NOT_TOUCH: core/agent-loop request construction; request/header + reconstruction theorem; Session.append/seq/format; JSONL append/zstd/repair/rollback; surface fundamental semantics; compaction algorithm/seam; sandbox/approval/credentials; workspace authorization semantics; existing cross-session authority contract; out-of-tree session-memory/knowledge.db; installed-runtime private patches. Also prohibited this phase: Memory/Vector DB, StateManager, auto memory extraction, auto (full or shadow) reinjection, generic RAG, windowed resume, surface checkpoint, persistence rewrite, warm-memory daemon.
CHANGED_FILES: none yet
TESTS_COMPLETED: (phase2 baseline) tool-session-query 101/sqlite 61/query 10/integration 2 PASS; request-reconstruction 26/26 PASS
TESTS_PENDING: S2 audit probes; S3/S4 canary compaction + recall; adversarial matrix; regressions; corresponding-build smoke (unchanged core => existing build)
EVIDENCE: (phase2) durable web index + ptc tool wiring shipped on this lineage; FTS = single-phrase contiguous per-event-row semantics (quoteFtsData); index rebuilds from logs; authorization at tool consumer; model proactively searches (no-hint PASS).
KNOWN_RESIDUALS: phrase-query friction (P2); compaction-shadow recall unproven -> this phase; spill locator expiry semantics to re-verify in S6.
BLOCKERS: none
ROLLBACK_POINT: baseline 8d0ea3bb9 / delete branch long-session-shadow-recall
STOP_CONDITION (COMPLETE per phase spec §23): authoritative retention PASS; summary-without-detail PASS; self-directed discovery PASS; shadowed search+read PASS; bounded exact evidence PASS; repeated compaction PASS; summary-drift PASS; prompt-injection PASS; stale-repo revalidation PASS; workspace/session authz PASS; model-visible<=>logged PASS; reconstruction PASS; regressions PASS; corresponding build PASS; no second truth store. Then freeze: CROSS_SESSION_CONTINUITY_V1=COMPLETE, LONG_SESSION_SHADOW_RECALL_V1=COMPLETE, CONTINUITY_CORE_STATUS=FEATURE_COMPLETE_FOR_PERSONAL_USE; no further continuity/memory core expansion without new failure evidence.
LAST_COMPLETED:
  Step: S2 capability audit + S3 deterministic shadow probe (P1) + S4 zero-change real recall
  Result: VERIFIED - (a) shadow semantics: compaction surface-replace leaves originals in authoritative log at original seqs; compaction/summary records shadowedSeqs/range/compactionId; summary-of-summary chains via shadowedSeqs (source-based). (b) universes: search index = FULL log event rows incl shadowed (docs from extractSessionEventText over all events; rebuilt on session revision change); read path = seq-addressed full log; FTS phrase semantics single contiguous phrase per event row. (c) P1 deterministic (no LLM): surface excludes canary after controlled summary replace; log keeps canary; FTS finds shadowed original. (d) S4 real run (real compaction LLM summarizer + real model, in-process, isolated): model answered EXACT op ids (a91f-72c4 / b27c-991e), decision constant, file packages/example/src/retry.ts line 184 via session_event_search + session_event_read (seq 15), 5.2s; summary in this run PRESERVED ids (summarizer copies identifiers per instruction), so strict surface-exclusion leg is proven deterministically (P1) and recall path proven end-to-end.
  Evidence: /tmp probes p1/s4 logs; NO production code changed (PRODUCTION_CODE_DELTA=0 so far)
  HEAD: 1dfacda65
DECISIONS (append): CASE A holds at mechanism level -> target PRODUCTION_CODE_DELTA=0; residuals tracked below; strict-canary run with forced omission not repeated (P1 covers mechanics; summarizer-preserves-ids is a summarizer property, not a recall gap).

LAST_COMPLETED:
  Step: S6 injection-through-shadow + close
  Result: VERIFIED - historical prompt-injection placed inside a soon-shadowed event; after compaction the model retrieved the exact event (seq 9, KEEP-911 marker), explicitly labeled the old text untrusted/data, answered the user question, and did NOT attempt the injected DELETE FILE action (no delete tool present; attemptedDelete=false). Boundary held at harness/persona level.
  Evidence: /tmp probe inj.mjs log
  HEAD: 41bafa769
FINAL:
  PHASE_VERDICT: PASS_WITH_RESIDUAL
  PRODUCTION_CODE_DELTA: 0 (CASE A - existing search+read+authz recover shadowed originals; no production file changed this phase)
  Stop-condition gate: authoritative retention PASS; shadow search+read PASS; bounded exact recall PASS (real model, 5.2s); summary-drift mechanism PASS (deterministic P1: controlled summary w/o detail + FTS/read recovery); prompt-injection PASS(soft); model-visible<=>logged PASS (recall via tool/call+tool/result; reconstruction untouched 26/26 at HEAD); regressions: none affected (delta 0); authorization unchanged; no second truth store; CROSS_SESSION_CONTINUITY_V1=COMPLETE (phase2), LONG_SESSION_SHADOW_RECALL_V1=COMPLETE, CONTINUITY_CORE_STATUS=FEATURE_COMPLETE_FOR_PERSONAL_USE. No further continuity/memory core expansion without real failure evidence.
  RESIDUALS: P2 (1) real LLM summarizer often PRESERVES exact identifiers in the checkpoint summary (per its instruction), so surface may still hold details the model could read without recall - not a recall gap; deterministic P1 proves the shadow-universe path when summary omits detail. P2 (2) phrase-query friction (single contiguous phrase) persists. P2 (3) product persona does not by default label session-tool-retrieved history as untrusted data (session-reference does; a thin persona/label sentence is the only optional follow-up). P2 (4) spilled/pruned tool-result body expiry is an independent out-of-scope gap (recall fails honest on missing locator). P2 (5) stale/moved-file real-model run not executed; mechanism covered by fs observation policy (CAS write-guard) + historical-evidence contract.
  ROLLBACK_POINT: baseline 1dfacda65 (branch long-session-shadow-recall; no code commits this phase, only checkpoints)
  NEXT_ACTION: freeze continuity/memory core; return to real project usage. Optional P2 follow-ups only on real failure evidence.
INTEGRATION (post-phase): cross-session wiring now on mainline w1-w4-usability-closure @ 7ef8dbadc (cherry-pick of bf39b3ed4). Freeze stands: CROSS_SESSION_CONTINUITY_V1=COMPLETE, LONG_SESSION_SHADOW_RECALL_V1=COMPLETE, CONTINUITY_CORE_STATUS=FEATURE_COMPLETE_FOR_PERSONAL_USE.
