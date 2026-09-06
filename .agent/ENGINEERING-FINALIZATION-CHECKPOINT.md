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
