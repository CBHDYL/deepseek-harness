#!/bin/zsh
# M5-backed web launcher for the launchd job com.dsh.web.
#
# Replaces the runtime-identity decision that dsh-doctor's findRealDsh() used to
# make by scanning $PATH (which always resolved to the global NVM dsh, bypassing
# the M5 control plane). Here the M5 active pointer is the ONLY authority over
# which runtime starts:
#
#   launchd -> this script -> resolve-active-entry.mjs -> <active slot>/install
#
# Promotion and rollback are therefore pure control-plane operations:
#   m5.promote(deployRoot,'candidate','stable') ; then kickstart -k com.dsh.web
#   m5.rollback(deployRoot)                     ; then kickstart -k com.dsh.web
#
# Fail-closed contract: if the M5 state is missing, inconsistent, or unsafe,
# this script exits non-zero WITHOUT starting anything. It must never silently
# start the global NVM dsh, because that would be an undetected rollback to a
# different revision while the control plane still claimed the active slot.
#
# Original supervisor (unchanged, still on disk): ~/.dsh/bin/dsh-web-launch.sh

set -eu

NODE_BIN="${DSH_M5_NODE_BIN:-/Users/bohongchen/.nvm/versions/node/v22.23.2/bin}"
export PATH="$NODE_BIN:$PATH"

# The real user home is deliberate: the runtime slot changes, user data does not.
export DSH_HOME="${DSH_HOME:-/Users/bohongchen/.dsh}"
export DSH_DOCTOR_HOME="${DSH_DOCTOR_HOME:-/Users/bohongchen/.dsh-doctor}"
export GOVERNANCE_GATE_ALLOW_SELF_APPROVAL="${GOVERNANCE_GATE_ALLOW_SELF_APPROVAL:-1}"

DEPLOY_ROOT="${DSH_M5_DEPLOY_ROOT:-/Users/bohongchen/.dsh-deploy}"
RESOLVER="$DEPLOY_ROOT/bin/resolve-active-entry.mjs"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] dsh-m5-web-launch: deployRoot=$DEPLOY_ROOT DSH_HOME=$DSH_HOME"

if [[ ! -r "$RESOLVER" ]]; then
  echo "  FATAL: resolver $RESOLVER is missing or unreadable; refusing to start any runtime"
  exit 70
fi

# Resolution failure must stop the boot, not degrade to a different runtime.
if ! ENTRY=$("$NODE_BIN/node" "$RESOLVER" --explain); then
  rc=$?
  echo "  FATAL: M5 active-slot resolution failed (exit $rc); no runtime started"
  exit $rc
fi

echo "  resolved entry: $ENTRY"

# `dsh web` is an alias for `--profile web`, so the profile layer always loads.
# Its @deepseek-ai entries must resolve inside the active slot, or the boot would
# mix a second core lineage (typically the global NVM install, whose packages
# satisfy the same semver ranges and would load silently).
ANCHOR="$DEPLOY_ROOT/bin/anchor-composition.sh"
VERIFIER="$DEPLOY_ROOT/bin/verify-composition-anchor.mjs"

# Self-heal before verifying. dsh's own profile provisioning re-links
# <home>/profiles/node_modules/@deepseek-ai back into whichever runtime performed
# it, and every plain `dsh` / `dsh plugin` / `dsh-doctor provision` invocation from
# a shell runs the GLOBAL NVM binary. That silently reverts the anchor, and the
# verifier below would then fail closed on every launchd retry — a 15s restart
# loop with :3080 down (observed 2026-09-07: profile re-linked at 17:23, runs
# climbed past 413). Re-anchoring here is deterministic, keeps the first-apply
# backup, and turns that conflict into an automatic correction instead of an
# outage. The verifier still has the final say.
if [[ -x "$ANCHOR" ]]; then
  DSH_M5_DEPLOY_ROOT="$DEPLOY_ROOT" "$ANCHOR" "$DSH_HOME" --apply >/dev/null 2>&1 \
    || echo "  WARN: re-anchor did not complete; the verifier decides whether to boot"
fi

if [[ ! -r "$VERIFIER" ]]; then
  echo "  FATAL: composition verifier $VERIFIER is missing; refusing to start"
  exit 71
fi
# Capture the verifier's own status: `if ! cmd` resets $? to the negation's
# result, which previously reported a failure as "exit 0" and hid it from launchd.
rc=0
DSH_M5_DEPLOY_ROOT="$DEPLOY_ROOT" "$NODE_BIN/node" "$VERIFIER" || rc=$?
if (( rc != 0 )); then
  echo "  FATAL: profile composition is not anchored to the M5 active slot (exit $rc); no runtime started"
  exit $rc
fi

exec "$NODE_BIN/node" "$ENTRY" web --no-open ${=DSH_M5_WEB_ARGS:-}
