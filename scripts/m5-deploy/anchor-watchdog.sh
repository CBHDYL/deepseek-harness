#!/bin/zsh
# Continuous composition-anchor watchdog for the M5 deploy.
#
# Verifies that <home>/profiles/**/node_modules/@deepseek-ai resolves INTO the
# M5 ACTIVE SLOT (no global-NVM lineage). When a shell `dsh` / `dsh plugin` /
# `dsh-doctor provision` re-links the store back to the global install, this
# re-applies the anchor within one interval instead of waiting for the next
# boot. Steady state is a read-only verify: no mutation, no log line.
#
#   env: DSH_HOME, DSH_M5_DEPLOY_ROOT, DSH_M5_NODE_BIN (all defaulted)
set -u

DEPLOY_ROOT="${DSH_M5_DEPLOY_ROOT:-/Users/bohongchen/.dsh-deploy}"
DSH_HOME="${DSH_HOME:-/Users/bohongchen/.dsh}"
NODE_BIN="${DSH_M5_NODE_BIN:-/Users/bohongchen/.nvm/versions/node/v22.23.2/bin}"
VERIFIER="$DEPLOY_ROOT/bin/verify-composition-anchor.mjs"
ANCHOR="$DEPLOY_ROOT/bin/anchor-composition.sh"
LOCK_DIR="$DEPLOY_ROOT/run/anchor-watchdog.lock"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] dsh-m5-watchdog: $*"; }

acquire_lock() {
  mkdir -p "$DEPLOY_ROOT/run"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"
    return 0
  fi
  local pid
  pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null
  mkdir "$LOCK_DIR" 2>/dev/null || return 1
  echo $$ > "$LOCK_DIR/pid"
  return 0
}

# Healthy path: read-only verify, zero output.
"$NODE_BIN/node" "$VERIFIER" --quiet 2>/dev/null && exit 0

if ! acquire_lock; then
  log "another apply in flight; backing off"
  exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

log "anchor drift detected; re-applying"
if ! DSH_M5_DEPLOY_ROOT="$DEPLOY_ROOT" "$ANCHOR" "$DSH_HOME" --apply >/dev/null 2>&1; then
  log "re-anchor FAILED"
  exit 1
fi
if "$NODE_BIN/node" "$VERIFIER" --quiet 2>/dev/null; then
  log "re-anchored; verifier OK"
else
  log "re-anchored but verifier STILL FAILS"
  exit 1
fi
