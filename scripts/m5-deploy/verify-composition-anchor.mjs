#!/usr/bin/env node
// Enforce CORE_LINEAGE_AUTHORITY = M5_ACTIVE_SLOT_ONLY at boot.
//
// The profile layer decides WHICH extensions load and how they are configured.
// It must not decide WHICH core runtime backs them. Because a profile supplies
// packages by ordinary Node resolution, an @deepseek-ai entry in a profile store
// that resolves into the GLOBAL NVM install silently introduces a second core
// lineage — and since both installs are version 0.1.2-alpha.5, every semver
// range is satisfied and nothing would complain.
//
// The invariant, matching anchor-composition.sh:
//   1. no @deepseek-ai entry may resolve into the global NVM install;
//   2. every name the ACTIVE SLOT provides must resolve INTO the active slot;
//   3. a name the slot does not provide may resolve inside the profile itself —
//      that is a profile-owned extension (e.g. dsh-tool-browser on the stable
//      slot, which predates the tool-browser family version fix).
//
// Any violation exits non-zero so the launcher refuses to boot rather than start
// a mixed-lineage runtime.
//
//   verify-composition-anchor.mjs [--quiet]
//   env: DSH_HOME, DSH_M5_DEPLOY_ROOT

import * as fs from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'node:path'

const home = process.env['DSH_HOME']?.trim() || join(process.env['HOME'] ?? '', '.dsh')
const deployRoot = process.env['DSH_M5_DEPLOY_ROOT']?.trim() || join(process.env['HOME'] ?? '', '.dsh-deploy')
const globalPrefix = join(process.env['HOME'] ?? '', '.nvm', 'versions', 'node')
const quiet = process.argv.includes('--quiet')

const fail = (reason) => {
  process.stderr.write(`dsh-m5-composition: REFUSED (${reason})\n`)
  process.exit(30)
}

let slotInstall
try {
  slotInstall = fs.realpathSync(join(deployRoot, 'active', 'install'))
} catch (error) {
  fail(`cannot resolve the active slot install root: ${String(error)}`)
}

const isWithin = (parent, child) => {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const slotProvides = new Set(fs.readdirSync(join(slotInstall, 'node_modules', '@deepseek-ai')))

const stores = [join(home, 'profiles', 'node_modules', '@deepseek-ai')]
try {
  for (const e of fs.readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== 'node_modules') {
      stores.push(join(home, 'profiles', e.name, 'node_modules', '@deepseek-ai'))
    }
  }
} catch (error) {
  fail(`cannot read ${join(home, 'profiles')}: ${String(error)}`)
}

let checked = 0, inSlot = 0, profileOwned = 0
const globalLeaks = []
const misanchored = []
for (const store of stores) {
  let entries
  try { entries = fs.readdirSync(store) } catch { continue }
  for (const name of entries) {
    checked++
    const path = join(store, name)
    let real
    try { real = fs.realpathSync(path) } catch (error) {
      // A dangling entry cannot load anything; it fails loudly at use.
      continue
    }
    if (real.startsWith(globalPrefix)) { globalLeaks.push({ name, real }); continue }
    if (isWithin(slotInstall, real)) { inSlot++; continue }
    if (slotProvides.has(name)) { misanchored.push({ name, real }); continue }
    profileOwned++
  }
}

if (globalLeaks.length > 0) {
  process.stderr.write(`dsh-m5-composition: ${globalLeaks.length} profile @deepseek-ai entries resolve into the GLOBAL NVM install\n`)
  for (const v of globalLeaks.slice(0, 10)) process.stderr.write(`  ${v.name} -> ${v.real}\n`)
  fail('global-lineage core packages are reachable from the profile; run anchor-composition.sh --apply')
}
if (misanchored.length > 0) {
  process.stderr.write(`dsh-m5-composition: ${misanchored.length} entries the active slot provides resolve elsewhere\n`)
  for (const v of misanchored.slice(0, 10)) process.stderr.write(`  ${v.name} -> ${v.real}\n`)
  fail('composition is anchored to a different slot; re-run anchor-composition.sh --apply after the pointer change')
}

if (!quiet) {
  process.stderr.write(`dsh-m5-composition: OK — ${checked} entries checked; ${inSlot} in the active slot, ${profileOwned} profile-owned extensions, 0 global-lineage\n`)
}
