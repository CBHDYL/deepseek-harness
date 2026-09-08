#!/bin/zsh
# Restore com.dsh.web to its ORIGINAL, pre-M5 supervision path.
#
# Use this if the M5-backed launcher is ever activated in com.dsh.web and has to
# be backed out: it reinstates the byte-exact original plist and launcher and
# re-bootstraps the job, returning :3080 to the global NVM dsh
# (sourceRevision 55101cc593ac3b498f1264eb75ebfc67c33af32b).
#
#   restore-original-supervisor.sh --check    report drift only, change nothing
#   restore-original-supervisor.sh --apply    restore and re-bootstrap the job
#
# This is a supervisor-level restore. It does NOT touch ~/.dsh user data and it
# does NOT change the M5 control plane; runtime rollback (m5.rollback) and data
# rollback remain separate, deliberate actions.
set -eu

BACKUP_DIR="/Users/bohongchen/.dsh-deploy/supervisor-backup"
PLIST_LIVE="/Users/bohongchen/Library/LaunchAgents/com.dsh.web.plist"
LAUNCHER_LIVE="/Users/bohongchen/.dsh/bin/dsh-web-launch.sh"
PLIST_ORIG="$BACKUP_DIR/com.dsh.web.plist"
LAUNCHER_ORIG="$BACKUP_DIR/dsh-web-launch.sh"

# Recorded at capture time, 2026-09-07. Any drift from these is reported.
PLIST_SHA="4114a71cbd43e89defb4760ddbb2b4e787c4aa2596ef533c26719d18121e03f2"
LAUNCHER_SHA="35d477f6381c6355aa0eece77b74a067ed5ee79fea4e4960b25fed080c2bbc31"

MODE="${1:---check}"

sha_of() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }
report() { printf '  %-34s %s\n' "$1" "$2"; }

for f in "$PLIST_ORIG" "$LAUNCHER_ORIG"; do
  [[ -r "$f" ]] || { echo "FATAL: backup $f is missing; cannot restore"; exit 2; }
done
[[ "$(sha_of "$PLIST_ORIG")" == "$PLIST_SHA" ]] || { echo "FATAL: backup plist does not match its recorded SHA256"; exit 2; }
[[ "$(sha_of "$LAUNCHER_ORIG")" == "$LAUNCHER_SHA" ]] || { echo "FATAL: backup launcher does not match its recorded SHA256"; exit 2; }
echo "backup integrity: OK (both files match their recorded SHA256)"

echo "current state:"
report "live plist sha" "$(sha_of "$PLIST_LIVE")"
report "live launcher sha" "$(sha_of "$LAUNCHER_LIVE")"
report "job" "$(launchctl list 2>/dev/null | awk '$3=="com.dsh.web"{print "pid="$1" lastexit="$2}' || echo 'not loaded')"
report "program" "$(launchctl print gui/$UID/com.dsh.web 2>/dev/null | awk -F'= ' '/^\tprogram /{print $2}' || echo unknown)"

PLIST_DRIFT=0; LAUNCHER_DRIFT=0
[[ "$(sha_of "$PLIST_LIVE")" == "$PLIST_SHA" ]] || PLIST_DRIFT=1
[[ "$(sha_of "$LAUNCHER_LIVE")" == "$LAUNCHER_SHA" ]] || LAUNCHER_DRIFT=1

if [[ $PLIST_DRIFT -eq 0 && $LAUNCHER_DRIFT -eq 0 ]]; then
  echo "RESULT: already original — nothing to restore"
  [[ "$MODE" == "--apply" ]] && echo "        (no action taken)"
  exit 0
fi
echo "RESULT: drift detected (plist=$PLIST_DRIFT launcher=$LAUNCHER_DRIFT)"

if [[ "$MODE" != "--apply" ]]; then
  echo "        --check only; re-run with --apply to restore"
  exit 1
fi

echo "restoring..."
launchctl bootout gui/$UID/com.dsh.web 2>/dev/null || echo "  (job was not loaded)"
cp -p "$PLIST_ORIG" "$PLIST_LIVE"
cp -p "$LAUNCHER_ORIG" "$LAUNCHER_LIVE"
chmod 755 "$LAUNCHER_LIVE"
launchctl bootstrap gui/$UID "$PLIST_LIVE"
echo "restored; verifying:"
report "live plist sha" "$(sha_of "$PLIST_LIVE")"
report "live launcher sha" "$(sha_of "$LAUNCHER_LIVE")"
[[ "$(sha_of "$PLIST_LIVE")" == "$PLIST_SHA" && "$(sha_of "$LAUNCHER_LIVE")" == "$LAUNCHER_SHA" ]] \
  && { echo "RESTORE_ORIGINAL_SUPERVISOR = PASS"; exit 0; } \
  || { echo "RESTORE_ORIGINAL_SUPERVISOR = FAIL"; exit 2; }
