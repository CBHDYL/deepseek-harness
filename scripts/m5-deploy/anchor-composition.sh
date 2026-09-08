#!/bin/zsh
# Anchor a DSH_HOME's profile composition to the M5 ACTIVE SLOT.
#
# WHY THIS EXISTS
# `dsh web` is a hardcoded alias for `--profile web`, so the runtime always boots
# through the profile layer. A profile supplies its plugins by ordinary Node
# resolution, and the external web plugins (dshmarket, dsh-plugin-subscriptions,
# ...) declare their @deepseek-ai imports as peerDependencies with an EMPTY
# dependencies map. Resolution therefore walks up from each plugin's realpath and
# lands in <home>/profiles/node_modules/@deepseek-ai, whose entries are symlinks
# into the GLOBAL NVM install. That is the dual authority: the M5 pointer would
# choose the core entry while the global install still supplied every bundle and
# peer package. Because both sides are version 0.1.2-alpha.5, the mismatch is a
# LINEAGE difference that satisfies every semver range and would load silently.
#
# THE INVARIANT THIS ENFORCES
#   * a name the ACTIVE SLOT provides must resolve INTO the active slot;
#   * no @deepseek-ai name may resolve into the GLOBAL NVM install;
#   * a name the slot does NOT provide, whose original target is profile-local
#     (a local tarball in .pnpm, or .dsh-module-fallback), is LEFT ALONE — that
#     is a genuine profile-owned extension, and deleting it would break the
#     composition. @deepseek-ai/dsh-tool-browser on the stable slot is exactly
#     this case: stable predates the tool-browser family version fix, so on
#     rollback the profile's own 0.1.0 copy must remain and carry the extension.
#
# Slot-provided names are linked THROUGH <deployRoot>/active, so composition
# follows promote()/rollback(). Re-run --apply after every pointer change:
# dsh-app-boot's module-fallback writes slot-specific links into the store at
# boot, which would otherwise pin the previous slot after a rollback.
#
#   anchor-composition.sh <dsh-home> --check     report what would change
#   anchor-composition.sh <dsh-home> --apply     repoint, recording a backup
#   anchor-composition.sh <dsh-home> --restore   put the recorded targets back
#
# WARNING: applying this to the LIVE ~/.dsh changes what the currently running
# global runtime would load on its next restart. It is a CUTOVER step.
set -eu

HOME_DIR="${1:?usage: anchor-composition.sh <dsh-home> [--check|--apply|--restore]}"
MODE="${2:---check}"
DEPLOY_ROOT="${DSH_M5_DEPLOY_ROOT:-/Users/bohongchen/.dsh-deploy}"
SLOT_NM="$DEPLOY_ROOT/active/install/node_modules"
GLOBAL_PREFIX="/Users/bohongchen/.nvm/versions/node"
BACKUP="$DEPLOY_ROOT/supervisor-backup/composition-anchor-$(echo "$HOME_DIR" | tr '/' '_').tsv"

[[ -d "$HOME_DIR/profiles" ]] || { echo "FATAL: $HOME_DIR/profiles does not exist"; exit 2; }

if [[ "$MODE" == "--restore" ]]; then
  [[ -r "$BACKUP" ]] || { echo "FATAL: no backup at $BACKUP"; exit 2; }
  restored=0
  # NOT `path`: in zsh that name is tied to the PATH array, so reading into it
  # clobbers PATH and the very next external command fails with
  # "command not found: rm". set -e then aborted the restore at the first entry,
  # which silently made this recovery path non-functional.
  while IFS=$'\t' read -r link target; do
    [[ -n "$link" ]] || continue
    rm -rf "$link"
    if [[ "$target" != "(absent)" && "$target" != "(not-a-symlink)" ]]; then
      mkdir -p "${link:h}"; ln -s "$target" "$link"; restored=$((restored+1))
    fi
  done < "$BACKUP"
  echo "restored $restored entries from $BACKUP"
  echo "COMPOSITION_ANCHOR = RESTORED"
  exit 0
fi

[[ -d "$SLOT_NM/@deepseek-ai" ]] || { echo "FATAL: $SLOT_NM/@deepseek-ai does not exist (is the M5 active pointer set?)"; exit 2; }

echo "dsh-home    : $HOME_DIR"
echo "anchor      : $SLOT_NM/@deepseek-ai   (via the M5 'active' symlink)"
echo "active slot : $(readlink "$DEPLOY_ROOT/active" 2>/dev/null || echo '(none)')"
echo

# The FIRST --apply records the pre-M5 originals; later runs must not clobber
# them, or --restore would only undo back to a previous anchored state.
record_backup=0
if [[ "$MODE" == "--apply" && ! -e "$BACKUP" ]]; then
  record_backup=1; mkdir -p "${BACKUP:h}"; : > "$BACKUP"
fi

total=0; anchored=0; kept=0; dropped=0
kept_names=(); dropped_names=()

stores=("$HOME_DIR/profiles/node_modules/@deepseek-ai")
for p in "$HOME_DIR"/profiles/*/node_modules/@deepseek-ai(N); do stores+=("$p"); done

for store in "${stores[@]}"; do
  [[ -d "$store" ]] || continue
  for entry in "$store"/*(N); do
    name="${entry:t}"; total=$((total+1))
    orig=$(readlink "$entry" 2>/dev/null || echo "(not-a-symlink)")
    (( record_backup )) && printf '%s\t%s\n' "$entry" "$orig" >> "$BACKUP"

    if [[ -e "$SLOT_NM/@deepseek-ai/$name" ]]; then
      anchored=$((anchored+1))
      if [[ "$MODE" == "--apply" ]]; then
        rm -rf "$entry"; ln -s "$SLOT_NM/@deepseek-ai/$name" "$entry"
      fi
    elif [[ "$orig" == "$GLOBAL_PREFIX"* ]]; then
      # Slot does not provide it and it came from the global install: dropping it
      # is the only way to keep global lineage out. Use fails loudly.
      dropped=$((dropped+1)); dropped_names+=("$name")
      [[ "$MODE" == "--apply" ]] && rm -rf "$entry"
    else
      # Profile-owned extension (local tarball / module-fallback): leave it.
      kept=$((kept+1)); kept_names+=("$name")
    fi
  done
done

echo "entries total                    : $total"
echo "anchored to active slot          : $anchored"
echo "kept as profile-owned extension  : $kept"
(( kept > 0 )) && print -l "    kept: ${kept_names[@]}"
echo "dropped (slot-absent, global)    : $dropped"
(( dropped > 0 )) && print -l "    dropped: ${dropped_names[@]}"
echo
if [[ "$MODE" == "--apply" ]]; then
  (( record_backup )) && echo "backup recorded : $BACKUP" || echo "backup preserved: $BACKUP (originals from the first apply)"
  echo "COMPOSITION_ANCHOR = APPLIED  (undo: anchor-composition.sh '$HOME_DIR' --restore)"
else
  echo "COMPOSITION_ANCHOR = CHECK_ONLY (re-run with --apply to change)"
fi
