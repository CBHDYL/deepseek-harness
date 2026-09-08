#!/usr/bin/env node
// M5 active-slot runtime resolver for the launchd supervision path.
//
// Prints the absolute node entry of the CURRENTLY ACTIVE M5 slot on stdout and
// exits 0. On any doubt it writes an explicit reason to stderr and exits
// non-zero. It NEVER falls back to another slot and NEVER falls back to the
// global NVM dsh: a silent fallback would be an undetected identity drift, so
// the M5 active pointer is the single authority over runtime identity.
//
// Why this is a reader and not a call into m5-release.ts:
//   * m5-release.ts ships as TypeScript inside node_modules, which Node 22
//     refuses to type-strip (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so
//     it cannot be imported from a boot path without a copy hack.
//   * validateSlot() recomputes digests over ~75k files and takes minutes. That
//     is an operator/promote-time gate, not something a KeepAlive boot path can
//     run. promote() already enforces it before a slot can become active.
// So this reader deliberately implements only the CHEAP invariants, using the
// same constants and the same semantics as m5-release.ts. It is a strict
// subset, never a divergent parser, and the T1-T6 suite asserts that its
// resolution agrees with the official resolveActive()/readManifest() exactly.

import * as fs from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'node:path'

// Mirrors m5-release.ts exports of the same names.
const RELEASE_MANIFEST = 'release-manifest.json'
const ACTIVE_POINTER = 'active'
const POINTER_META = 'active-pointer.json'
const SLOTS_DIR = 'slots'
const DSH_PACKAGE = '@deepseek-ai/dsh'

const EXIT = {
  DEPLOY_ROOT: 10,
  POINTER_META: 11,
  ACTIVE_POINTER: 12,
  INCONSISTENT: 13,
  SLOT: 14,
  MANIFEST: 15,
  RELEASE_ID: 16,
  INSTALL_ROOT: 17,
  ENTRY_MISSING: 18,
  ENTRY_ESCAPE: 19,
  STATE_POLICY: 20,
}

/** Fail closed: name the invariant that was violated, never guess a runtime. */
function refuse(code, reason) {
  process.stderr.write(`dsh-m5-resolver: REFUSED (${reason})\n`)
  process.stderr.write('dsh-m5-resolver: no fallback runtime will be started; M5 active state is the only authority\n')
  process.exit(code)
}

/** realpath containment, matching m5-release.ts isWithin(). */
function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const deployRoot = process.env['DSH_M5_DEPLOY_ROOT']?.trim() || join(process.env['HOME'] ?? '', '.dsh-deploy')
if (!fs.existsSync(deployRoot) || !fs.statSync(deployRoot).isDirectory()) {
  refuse(EXIT.DEPLOY_ROOT, `deploy root ${deployRoot} is missing or not a directory`)
}

// --- pointer metadata -------------------------------------------------------
let meta
try {
  meta = JSON.parse(fs.readFileSync(join(deployRoot, POINTER_META), 'utf8'))
} catch (error) {
  refuse(EXIT.POINTER_META, `${POINTER_META} is unreadable or malformed: ${String(error)}`)
}
const slotRef = (value) =>
  typeof value === 'object' && value !== null
  && typeof value['slot'] === 'string' && typeof value['releaseId'] === 'string'
if (typeof meta !== 'object' || meta === null
  || typeof meta['generation'] !== 'number' || !slotRef(meta['active']) || !slotRef(meta['previous'])) {
  refuse(EXIT.POINTER_META, `${POINTER_META} does not match the M5 pointer schema`)
}

// --- active pointer ---------------------------------------------------------
let activeSlot
try {
  const link = fs.readlinkSync(join(deployRoot, ACTIVE_POINTER))
  activeSlot = relative(join(deployRoot, SLOTS_DIR), link)
} catch (error) {
  refuse(EXIT.ACTIVE_POINTER, `active pointer is absent or not a symlink: ${String(error)}`)
}
if (activeSlot === '' || activeSlot.includes('/') || activeSlot.startsWith('..')) {
  refuse(EXIT.SLOT, `active pointer resolves outside the slots directory (got '${activeSlot}')`)
}
// The same consistency rule promote() enforces before it will move anything.
if (meta['active']['slot'] !== activeSlot) {
  refuse(EXIT.INCONSISTENT, `ambiguous active state: pointer says '${activeSlot}' but ${POINTER_META} says '${meta['active']['slot']}'`)
}

const slotPath = join(deployRoot, SLOTS_DIR, activeSlot)
if (!fs.existsSync(slotPath)) refuse(EXIT.SLOT, `active slot directory ${slotPath} does not exist`)

// --- manifest ---------------------------------------------------------------
let manifest
try {
  manifest = JSON.parse(fs.readFileSync(join(slotPath, RELEASE_MANIFEST), 'utf8'))
} catch (error) {
  refuse(EXIT.MANIFEST, `slot '${activeSlot}' has no readable ${RELEASE_MANIFEST}: ${String(error)}`)
}
for (const field of ['releaseId', 'version', 'sourceRevision', 'artifactDigest', 'installRoot']) {
  if (typeof manifest?.[field] !== 'string' || manifest[field] === '') {
    refuse(EXIT.MANIFEST, `manifest of slot '${activeSlot}' is malformed: '${field}' is missing or not a string`)
  }
}
if (typeof manifest['statePolicy']?.['kind'] !== 'string') {
  refuse(EXIT.MANIFEST, `manifest of slot '${activeSlot}' is malformed: statePolicy.kind missing`)
}
// Mirrors promote(): an irreversible state migration has no verified rollback.
if (manifest['statePolicy']['kind'] === 'migrating') {
  refuse(EXIT.STATE_POLICY, `slot '${activeSlot}' declares an irreversible state migration`)
}
if (manifest['releaseId'] !== meta['active']['releaseId']) {
  refuse(EXIT.RELEASE_ID, `release identity mismatch: manifest '${manifest['releaseId']}' vs pointer '${meta['active']['releaseId']}'`)
}

// --- install root confinement ----------------------------------------------
let installRoot, canonicalSlot
try {
  installRoot = fs.realpathSync(manifest['installRoot'])
  canonicalSlot = fs.realpathSync(slotPath)
} catch (error) {
  refuse(EXIT.INSTALL_ROOT, `install root ${manifest['installRoot']} does not resolve: ${String(error)}`)
}
if (!isWithin(canonicalSlot, installRoot)) {
  refuse(EXIT.INSTALL_ROOT, `install root realpath escapes slot '${activeSlot}' (confinement violated)`)
}

// --- runtime entry ----------------------------------------------------------
const lib = manifest['criticalPackages']?.[DSH_PACKAGE]?.['lib']
if (typeof lib !== 'string' || lib === '') {
  refuse(EXIT.MANIFEST, `manifest does not record a critical lib for ${DSH_PACKAGE}`)
}
const entry = join(installRoot, 'node_modules', ...DSH_PACKAGE.split('/'), lib)
if (!fs.existsSync(entry)) refuse(EXIT.ENTRY_MISSING, `runtime entry ${entry} does not exist`)
let realEntry
try {
  realEntry = fs.realpathSync(entry)
} catch (error) {
  refuse(EXIT.ENTRY_MISSING, `runtime entry ${entry} does not resolve: ${String(error)}`)
}
if (!isWithin(installRoot, realEntry)) {
  refuse(EXIT.ENTRY_ESCAPE, `runtime entry realpath escapes the install root (symlink escape): ${realEntry}`)
}

if (process.argv.includes('--explain')) {
  process.stderr.write(`dsh-m5-resolver: deployRoot=${deployRoot}\n`)
  process.stderr.write(`dsh-m5-resolver: activeSlot=${activeSlot} releaseId=${manifest['releaseId']} generation=${meta['generation']}\n`)
  process.stderr.write(`dsh-m5-resolver: sourceRevision=${manifest['sourceRevision']}\n`)
  process.stderr.write(`dsh-m5-resolver: artifactDigest=${manifest['artifactDigest']}\n`)
}
process.stdout.write(`${realEntry}\n`)
