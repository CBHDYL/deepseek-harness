/**
 * M5 release-slot deployment tooling: two immutable release slots
 * ('slots/stable', 'slots/candidate'), an evidence-derived release manifest
 * per slot, one atomic 'active' pointer, a rebuild-free rollback, and a
 * canary probe that runs only against the candidate slot with an isolated
 * state home.
 *
 * Deployment model (M5):
 * - executable/runtime = the slot's packed 'node_modules' install root
 * - configuration = profiles/patch layers under a state home (never a slot)
 * - mutable user state = sessions/caches under a state home (never a slot)
 *
 * PROMOTION IS A POINTER/SLOT CHANGE, NOT A DESTRUCTIVE OVERWRITE: the
 * active pointer is a symlink switched by an atomic rename; neither
 * promotion nor rollback ever rewrites a slot, reinstalls, repacks, or
 * touches the network. Runtime rollback and user-state rollback are
 * distinct: this tool only rolls back the runtime pointer; a candidate
 * whose manifest declares a state migration is refused promotion.
 *
 * Trust model (M5 focused closure):
 * - REALPATH CONFINEMENT: every runtime-critical byte (install root,
 *   '@deepseek-ai' package tree, critical entry files, CLI bin) must
 *   realpath inside its own slot's canonical install root. pnpm-style
 *   symlinks are allowed — their realpath must still land in-slot.
 * - SLOT SELF-INTEGRITY: 'validateSlot' recomputes the artifact digest and
 *   every critical-package digest from the installed bytes and compares
 *   against the manifest; stale manifest + mutated bytes fails closed.
 * - RELEASE AUTHENTICITY: an operator-run prepare step registers each
 *   release id against the SHA-256 of its canonical manifest bytes in a
 *   deployment-side approval record OUTSIDE the slot; promotion only
 *   consumes already-registered digests, so coordinated manifest+bytes
 *   tampering cannot self-approve. Same-machine deployment integrity, not
 *   adversarial OS security: 'sourceRevision' remains deployment
 *   provenance, never a package-internal stamp.
 * - CONCURRENCY: promote and rollback share one deploy-root cross-process
 *   lock with stale-owner (dead pid + grace) recovery; pointer metadata is
 *   generation-aware and rollback only consumes the previous release of the
 *   generation the active pointer currently belongs to.
 *
 * @module scripts/m5-release
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export const RELEASE_MANIFEST = 'release-manifest.json'
export const ACTIVE_POINTER = 'active'
export const POINTER_META = 'active-pointer.json'
export const SLOTS_DIR = 'slots'
export const CANARY_PROBE = '.m5-canary-probe.mjs'
export const RELEASE_APPROVALS = 'release-approvals.json'
export const LOCK_DIR = '.m5-deploy-lock'

/** Dead-owner grace before a stale deployment lock may be recovered. */
const LOCK_GRACE_MS = 10_000
/** Total wait before acquire fails loud (never an indefinite block). */
const LOCK_TIMEOUT_MS = 15_000

/** Deployment-time provenance the slot builder records from actual artifacts. */
export interface ReleaseManifest {
  /** Opaque release identity, unique across slots of one deployment. */
  releaseId: string
  /** Package version the slot's artifacts carry. */
  version: string
  /** Source commit the slot's artifacts were built from. */
  sourceRevision: string
  /** SHA-256 over the sorted per-package (name, packed lib hash) evidence list. */
  artifactDigest: string
  /** Canonical (realpath) install root holding the slot's own 'node_modules'. */
  installRoot: string
  /** Critical package name → lineage evidence (packed entry path + SHA-256). */
  criticalPackages: Record<string, { digest: string; lib: string }>
  /** ISO timestamp the slot evidence was recorded. */
  createdAt: string
  /**
   * State compatibility the candidate claims. Only 'shared-compatible'
   * (reuses the shared state home read/write without a migration) may be
   * promoted; 'migrating' is blocked because this tool ships no state
   * rollback.
   */
  statePolicy: { kind: 'shared-compatible' | 'migrating' }
}

/** One validation outcome: why a slot may not become active. */
export interface SlotValidation {
  ok: boolean
  failures: string[]
  manifest?: ReleaseManifest
}

/** Outcome of one promotion or rollback pointer operation. */
export interface PointerResult {
  active: string
  releaseId: string
  previous?: string
}

/** Generation-aware pointer metadata: which release is active now, which one came before it. */
export interface PointerMeta {
  generation: number
  active: { slot: string; releaseId: string }
  previous: { slot: string; releaseId: string }
}

/** One critical package whose packed entry file is hashed as lineage evidence. */
export interface CriticalPackage {
  /** Package name, e.g. '@deepseek-ai/dsh-session'. */
  readonly name: string
  /** Path to the packed entry file inside the package, default 'lib/index.js'. */
  readonly lib?: string
}

/** The deployed slot layout: '<deployRoot>/slots/<name>/release-manifest.json' + install root. */
export function slotDir(deployRoot: string, slotName: string): string {
  return join(deployRoot, SLOTS_DIR, slotName)
}

/** Normalize a critical entry (name string or '{name, lib}' object). */
function criticalEntry(entry: string | CriticalPackage): { name: string; lib: string } {
  return typeof entry === 'string' ? { name: entry, lib: 'lib/index.js' } : { name: entry.name, lib: entry.lib ?? 'lib/index.js' }
}

/** SHA-256 of one file's bytes. */
function fileDigest(path: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

/** SHA-256 of a string. */
function stringDigest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** Every '@deepseek-ai/*' package directory under an install root's node_modules. */
function installedPackages(installRoot: string): string[] {
  const scoped = join(installRoot, 'node_modules', '@deepseek-ai')
  try {
    return fs.readdirSync(scoped).map(name => `@deepseek-ai/${name}`).sort()
  } catch {
    return []
  }
}

/** The evidence hash over every installed package entry (sorted, deterministic). */
function computeArtifactDigest(installRoot: string): string {
  const evidence: string[] = []
  for (const name of installedPackages(installRoot)) {
    const lib = join(installRoot, 'node_modules', ...name.split('/'), 'lib', 'index.js')
    if (fs.existsSync(lib)) evidence.push(`${name} ${fileDigest(lib)}`)
  }
  return stringDigest(evidence.join('\n'))
}

/** Canonical (key-sorted) JSON text of one manifest, used for approval hashes. */
export function canonicalManifest(manifest: ReleaseManifest): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(record).sort()) out[key] = stable(record[key])
      return out
    }
    return value
  }
  return `${JSON.stringify(stable(manifest))}\n`
}

/** Whether one real path is inside (or equal to) another real directory path. */
function isWithin(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return fromParent === '' || (!fromParent.startsWith('..') && !isAbsolute(fromParent))
}

/** Read and narrow an untrusted parsed manifest record. */
function shapeManifest(value: unknown): { manifest?: ReleaseManifest; failures: string[] } {
  const failures: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { failures: ['manifest is not a JSON object'] }
  }
  const record = value as Record<string, unknown>
  if (typeof record['releaseId'] !== 'string' || record['releaseId'] === '') failures.push('manifest.releaseId must be a non-empty string')
  if (typeof record['version'] !== 'string' || record['version'] === '') failures.push('manifest.version must be a non-empty string')
  if (typeof record['sourceRevision'] !== 'string' || record['sourceRevision'] === '') failures.push('manifest.sourceRevision must be a non-empty string')
  if (typeof record['artifactDigest'] !== 'string' || record['artifactDigest'] === '') failures.push('manifest.artifactDigest must be a non-empty string')
  if (typeof record['installRoot'] !== 'string' || record['installRoot'] === '') failures.push('manifest.installRoot must be a non-empty string')
  if (typeof record['createdAt'] !== 'string' || record['createdAt'] === '') failures.push('manifest.createdAt must be a non-empty string')
  const critical = record['criticalPackages']
  if (typeof critical !== 'object' || critical === null || Array.isArray(critical)) {
    failures.push('manifest.criticalPackages must be an object')
  } else {
    for (const [name, evidence] of Object.entries(critical as Record<string, unknown>)) {
      if (typeof evidence !== 'object' || evidence === null
        || typeof (evidence as Record<string, unknown>)['digest'] !== 'string'
        || typeof (evidence as Record<string, unknown>)['lib'] !== 'string') {
        failures.push(`manifest.criticalPackages["${name}"] must be {digest, lib}`)
      }
    }
  }
  const policy = record['statePolicy']
  const kind = typeof policy === 'object' && policy !== null ? (policy as Record<string, unknown>)['kind'] : undefined
  if (kind !== 'shared-compatible' && kind !== 'migrating') failures.push('manifest.statePolicy.kind must be "shared-compatible" or "migrating"')
  if (failures.length > 0) return { failures }
  return { failures, manifest: record as unknown as ReleaseManifest }
}

/** Read the deployment-side release approval record (outside any slot). */
export function readApprovals(deployRoot: string): Record<string, string> {
  try {
    const value = JSON.parse(fs.readFileSync(join(deployRoot, RELEASE_APPROVALS), 'utf8')) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, string>
    }
  } catch { /* absent or malformed approvals mean nothing is approved */ }
  return {}
}

/**
 * Operator-run prepare step: re-record the deployment-side approval for one
 * slot's CURRENT manifest bytes. This is the only path that updates the
 * trust record, and it runs outside the slot — a candidate mutating its own
 * manifest and bytes cannot self-approve.
 */
export function approveRelease(deployRoot: string, slotName: string): string {
  const manifest = readManifest(deployRoot, slotName)
  if (manifest === undefined) throw new Error(`m5-release: cannot approve slot '${slotName}' — no readable manifest`)
  const digest = stringDigest(canonicalManifest(manifest))
  const approvals = readApprovals(deployRoot)
  approvals[manifest.releaseId] = digest
  fs.writeFileSync(join(deployRoot, RELEASE_APPROVALS), `${JSON.stringify(approvals, null, 2)}\n`)
  return digest
}

/** Read and parse one slot's manifest; 'undefined' when absent or malformed. */
export function readManifest(deployRoot: string, slotName: string): ReleaseManifest | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(join(slotDir(deployRoot, slotName), RELEASE_MANIFEST), 'utf8')) as unknown
  } catch {
    return undefined
  }
  return shapeManifest(raw).manifest
}

/**
 * Record a release manifest from ACTUAL install evidence and register it as
 * the deployment's approved release: critical-package hashes and the
 * artifact digest are recomputed from the install root's packed entry files
 * (whose realpath must stay inside the slot), never hand-written claims.
 * @param deployRoot - the deployment directory.
 * @param slotName - 'stable' or 'candidate'.
 * @param identity - release identity fields (version, source revision, id).
 * @param critical - critical package names whose lineage must match later.
 * @returns the recorded manifest.
 */
export function recordManifest(
  deployRoot: string,
  slotName: string,
  identity: { readonly releaseId: string; readonly version: string; readonly sourceRevision: string },
  critical: readonly (string | CriticalPackage)[],
): ReleaseManifest {
  const dir = slotDir(deployRoot, slotName)
  const lexicalRoot = resolve(join(dir, 'install'))
  let installRoot: string
  try {
    installRoot = fs.realpathSync(lexicalRoot)
  } catch {
    throw new Error(`m5-release: cannot record ${slotName} manifest — install root ${lexicalRoot} does not resolve`)
  }
  let canonicalSlot: string
  try {
    canonicalSlot = fs.realpathSync(dir)
  } catch {
    throw new Error(`m5-release: cannot record ${slotName} manifest — slot directory ${dir} does not resolve`)
  }
  if (!isWithin(canonicalSlot, installRoot)) {
    throw new Error(`m5-release: cannot record ${slotName} manifest — install root realpath escapes the slot (confinement violated)`)
  }
  const entries = critical.map(criticalEntry)
  for (const entry of entries) {
    const entryPath = join(installRoot, 'node_modules', ...entry.name.split('/'), entry.lib)
    if (!fs.existsSync(entryPath)) {
      throw new Error(`m5-release: cannot record ${slotName} manifest — missing critical package libs: ${entries.filter(e => !fs.existsSync(join(installRoot, 'node_modules', ...e.name.split('/'), e.lib))).map(e => e.name).join(', ')}`)
    }
    if (!isWithin(installRoot, fs.realpathSync(entryPath))) {
      throw new Error(`m5-release: cannot record ${slotName} manifest — critical package ${entry.name} realpath escapes the install root`)
    }
  }
  const criticalPackages: Record<string, { digest: string; lib: string }> = {}
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    criticalPackages[entry.name] = { digest: fileDigest(join(installRoot, 'node_modules', ...entry.name.split('/'), entry.lib)), lib: entry.lib }
  }
  const manifest: ReleaseManifest = {
    releaseId: identity.releaseId,
    version: identity.version,
    sourceRevision: identity.sourceRevision,
    artifactDigest: computeArtifactDigest(installRoot),
    installRoot,
    criticalPackages,
    createdAt: new Date().toISOString(),
    statePolicy: { kind: 'shared-compatible' },
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(join(dir, RELEASE_MANIFEST), canonicalManifest(manifest))
  approveRelease(deployRoot, slotName)
  return manifest
}

/**
 * Validate one slot against its recorded evidence: manifest shape, the
 * RECOMPUTED artifact digest, critical lineage hashes, and realpath
 * confinement (install root, scoped package tree, and every critical entry
 * must realpath inside the slot's canonical install root). pnpm-style
 * symlinks are fine as long as their realpath stays in-slot.
 */
export function validateSlot(deployRoot: string, slotName: string): SlotValidation {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(join(slotDir(deployRoot, slotName), RELEASE_MANIFEST), 'utf8')) as unknown
  } catch {
    return { ok: false, failures: [`slot '${slotName}' has no readable ${RELEASE_MANIFEST}`] }
  }
  const shaped = shapeManifest(raw)
  if (shaped.manifest === undefined) {
    return { ok: false, failures: shaped.failures }
  }
  const manifest = shaped.manifest
  const failures: string[] = []

  // REALPATH CONFINEMENT (P1-1): canonical slot dir must own the canonical install root.
  let canonicalSlot: string | undefined
  try {
    canonicalSlot = fs.realpathSync(slotDir(deployRoot, slotName))
  } catch {
    failures.push(`slot '${slotName}' directory does not resolve`)
  }
  let installRoot: string | undefined
  if (canonicalSlot !== undefined) {
    try {
      installRoot = fs.realpathSync(manifest.installRoot)
    } catch {
      failures.push(`install root ${manifest.installRoot} does not resolve (symlink escape or missing path)`)
    }
    if (installRoot !== undefined) {
      if (installRoot !== manifest.installRoot) {
        failures.push('install root realpath differs from the recorded path (symlink escape)')
      }
      if (!isWithin(canonicalSlot, installRoot)) {
        failures.push(`slot '${slotName}' install root realpath escapes the slot (cross-slot/foreign confinement violated)`)
      }
    }
  }
  if (installRoot !== undefined) {
    const scopedLexical = join(installRoot, 'node_modules', '@deepseek-ai')
    if (!fs.existsSync(scopedLexical)) {
      failures.push(`install root ${installRoot} has no @deepseek-ai packages`)
    } else {
      const scopedReal = fs.realpathSync(scopedLexical)
      if (!isWithin(installRoot, scopedReal)) {
        failures.push('@deepseek-ai package tree realpath escapes the install root')
      }
    }
    // Self-integrity: recompute the artifact digest and every critical digest.
    const recomputed = computeArtifactDigest(installRoot)
    if (recomputed !== manifest.artifactDigest) {
      failures.push('artifact digest does not match the installed bytes (stale manifest or mutated slot)')
    }
    for (const [name, evidence] of Object.entries(manifest.criticalPackages)) {
      const entry = join(installRoot, 'node_modules', ...name.split('/'), evidence.lib)
      if (!fs.existsSync(entry)) {
        failures.push(`critical package ${name} is missing from the install root`)
        continue
      }
      const entryReal = fs.realpathSync(entry)
      if (!isWithin(installRoot, entryReal)) {
        failures.push(`critical package ${name} realpath escapes the install root (symlink borrow)`)
      } else if (fileDigest(entryReal) !== evidence.digest) {
        failures.push(`critical package ${name} lineage mismatch (packed lib changed)`)
      }
    }
  }
  for (const sibling of fs.readdirSync(join(deployRoot, SLOTS_DIR)).filter(name => name !== slotName)) {
    const siblingRoot = readManifest(deployRoot, sibling)?.installRoot
    if (siblingRoot === undefined) continue
    const fromSibling = relative(resolve(siblingRoot), resolve(manifest.installRoot))
    if (fromSibling === '' || (!fromSibling.startsWith('..') && !isAbsolute(fromSibling))) {
      failures.push(`slot '${slotName}' install root nests inside slot '${sibling}' (cross-slot isolation violated)`)
    }
  }
  return { ok: failures.length === 0, failures, manifest }
}

// ---- Deployment lock (P1-3) ----

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

/** Whether a pid is alive on this machine (ESRCH = dead). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Acquire the deploy-root exclusive lock used by promote and rollback.
 * Stale-lock recovery: an owner with a dead pid and a held age beyond the
 * grace period is stolen via an atomic rename (only one stealer wins);
 * a live owner or a fresh lock waits up to the timeout and then fails loud.
 * @returns the release function.
 */
function acquireDeploymentLock(deployRoot: string): () => void {
  const dir = join(deployRoot, LOCK_DIR)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      fs.mkdirSync(dir)
      fs.writeFileSync(join(dir, 'owner.json'), `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`)
      return () => {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* already stolen or removed */ }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner: { pid?: unknown; acquiredAt?: unknown } | undefined
      try {
        owner = JSON.parse(fs.readFileSync(join(dir, 'owner.json'), 'utf8')) as { pid?: unknown; acquiredAt?: unknown }
      } catch { /* owner file missing: treat by directory age below */ }
      let heldMs = 0
      if (typeof owner?.acquiredAt === 'number') heldMs = Date.now() - owner.acquiredAt
      else {
        try { heldMs = Date.now() - fs.statSync(dir).mtimeMs } catch { heldMs = 0 }
      }
      const deadOwner = owner !== undefined && typeof owner.pid === 'number' ? !pidAlive(owner.pid) : owner === undefined
      if (deadOwner && heldMs > LOCK_GRACE_MS) {
        const stalePath = join(deployRoot, `${LOCK_DIR}.stale-${process.pid}`)
        try { fs.renameSync(dir, stalePath) } catch { /* lost the steal race — retry */ }
        try { fs.rmSync(stalePath, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(`m5-release: deployment lock timeout — another controller holds ${dir}`)
      }
      sleepSync(15)
    }
  }
}

/** Atomic pointer replacement on the same filesystem: symlink staging + rename. */
function switchPointer(deployRoot: string, slotName: string): void {
  const active = join(deployRoot, ACTIVE_POINTER)
  const staged = `${active}.staging-${process.pid}`
  fs.symlinkSync(slotDir(deployRoot, slotName), staged)
  try {
    fs.renameSync(staged, active)
  } catch (error) {
    try { fs.rmSync(staged, { force: true }) } catch { /* staging cleanup is best-effort */ }
    throw error
  }
}

/** Read the active slot name, or 'undefined' when no pointer exists yet. */
export function resolveActive(deployRoot: string): string | undefined {
  const active = join(deployRoot, ACTIVE_POINTER)
  try {
    const link = fs.readlinkSync(active)
    return relative(join(deployRoot, SLOTS_DIR), link)
  } catch {
    return undefined
  }
}

/** Read generation-aware pointer metadata, or 'undefined'. */
export function readPointerMeta(deployRoot: string): PointerMeta | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(join(deployRoot, POINTER_META), 'utf8')) as unknown
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    const slotRef = (value: unknown): value is { slot: string; releaseId: string } =>
      typeof value === 'object' && value !== null
      && typeof (value as Record<string, unknown>)['slot'] === 'string'
      && typeof (value as Record<string, unknown>)['releaseId'] === 'string'
    if (typeof record['generation'] !== 'number' || !slotRef(record['active']) || !slotRef(record['previous'])) {
      return undefined
    }
    return value as unknown as PointerMeta
  } catch {
    return undefined
  }
}

function writePointerMeta(deployRoot: string, meta: PointerMeta): void {
  fs.writeFileSync(join(deployRoot, POINTER_META), `${JSON.stringify(meta, null, 2)}\n`)
}

/**
 * Atomically promote one validated, approved slot under the deployment lock:
 * the previous active slot (or 'fallbackStable') is recorded as the
 * rollback target BEFORE the pointer moves, the pointer switches by rename,
 * and a post-switch identity check restores the prior slot on any failure —
 * never leaving a half-promoted runtime.
 * @param deployRoot - the deployment directory.
 * @param slotName - the candidate slot to activate.
 * @param fallbackStable - rollback target when no previous active exists.
 * @param options - test-only fault injection ('testPostSwitchFailure').
 * @throws {Error} when validation, approval, state policy, locking, switching, or identity fails.
 */
export function promote(
  deployRoot: string,
  slotName: string,
  fallbackStable: string,
  options: { readonly testPostSwitchFailure?: boolean } = {},
): PointerResult {
  const release = acquireDeploymentLock(deployRoot)
  try {
    const validation = validateSlot(deployRoot, slotName)
    if (!validation.ok || validation.manifest === undefined) {
      throw new Error(`m5-release: promotion blocked — ${validation.failures.join('; ')}`)
    }
    const manifest = validation.manifest
    // Release authenticity: the manifest bytes must match the operator-approved digest.
    const approved = readApprovals(deployRoot)[manifest.releaseId]
    if (approved !== stringDigest(canonicalManifest(manifest))) {
      throw new Error(`m5-release: promotion blocked — release '${manifest.releaseId}' is not registered or its manifest was tampered with`)
    }
    if (manifest.statePolicy.kind === 'migrating') {
      throw new Error('m5-release: promotion blocked — the candidate declares an irreversible state migration and this deployment has no verified state rollback')
    }
    const current = resolveActive(deployRoot)
    const meta = readPointerMeta(deployRoot)
    if (current !== undefined && (meta === undefined || meta.active.slot !== current)) {
      throw new Error('m5-release: promotion blocked — active pointer and pointer metadata are inconsistent')
    }
    if (current === slotName) {
      throw new Error(`m5-release: promotion refused — slot '${slotName}' is already active`)
    }
    const previous = current ?? fallbackStable
    const previousValidation = validateSlot(deployRoot, previous)
    if (!previousValidation.ok || previousValidation.manifest === undefined) {
      throw new Error(`m5-release: promotion blocked — rollback target '${previous}' is not a valid slot`)
    }
    const generation = (meta?.generation ?? 0) + 1
    writePointerMeta(deployRoot, {
      generation,
      active: { slot: slotName, releaseId: manifest.releaseId },
      previous: { slot: previous, releaseId: previousValidation.manifest.releaseId },
    })
    try {
      switchPointer(deployRoot, slotName)
    } catch (error) {
      throw new Error(`m5-release: pointer switch failed — ${String(error)}`)
    }
    // Post-switch identity: the active pointer must resolve to this exact slot
    // and the slot must still validate. Any failure restores the prior slot.
    if (options.testPostSwitchFailure === true
      || resolveActive(deployRoot) !== slotName
      || !validateSlot(deployRoot, slotName).ok) {
      try { switchPointer(deployRoot, previous) } catch { /* prior attempt stays recorded in POINTER_META */ }
      throw new Error(`m5-release: post-switch identity check failed — active restored to '${previous}'`)
    }
    return { active: slotName, releaseId: manifest.releaseId, previous }
  } finally {
    release()
  }
}

/**
 * Deterministically restore the runtime pointer to the release that preceded
 * the current active generation, under the deployment lock. Requires no
 * rebuild, no reinstall, no repack, and no network — the two slots are
 * untouched; only the pointer moves back. Generation-aware: metadata whose
 * active slot no longer matches the pointer, a self-referencing previous, or
 * an invalid previous slot all fail closed without moving anything.
 * @param deployRoot - the deployment directory.
 */
export function rollback(deployRoot: string): PointerResult {
  const release = acquireDeploymentLock(deployRoot)
  try {
    const meta = readPointerMeta(deployRoot)
    if (meta === undefined) {
      throw new Error('m5-release: rollback unavailable — no previous active slot is recorded')
    }
    const current = resolveActive(deployRoot)
    if (current === undefined || meta.active.slot !== current) {
      throw new Error('m5-release: rollback refused — pointer metadata does not match the active pointer generation')
    }
    if (meta.previous.slot === meta.active.slot) {
      throw new Error('m5-release: rollback refused — pointer metadata self-references the active slot')
    }
    const validation = validateSlot(deployRoot, meta.previous.slot)
    if (!validation.ok || validation.manifest === undefined) {
      throw new Error(`m5-release: rollback refused — recorded slot '${meta.previous.slot}' is invalid: ${validation.failures.join('; ')}`)
    }
    switchPointer(deployRoot, meta.previous.slot)
    if (resolveActive(deployRoot) !== meta.previous.slot) {
      throw new Error(`m5-release: rollback pointer check failed for '${meta.previous.slot}'`)
    }
    writePointerMeta(deployRoot, {
      generation: meta.generation + 1,
      active: { slot: meta.previous.slot, releaseId: validation.manifest.releaseId },
      previous: { slot: meta.active.slot, releaseId: meta.active.releaseId },
    })
    return { active: meta.previous.slot, releaseId: validation.manifest.releaseId }
  } finally {
    release()
  }
}

/**
 * Copy the canary probe into a slot's install root. The probe is part of
 * the slot layout (excluded from lineage hashes): it imports packed runtime
 * packages by resolution from the slot's own tree and exercises the
 * guard/auth deny path plus a persistence write/reopen round trip against
 * an isolated state home.
 */
export function installCanaryProbe(deployRoot: string, slotName: string): void {
  const manifest = readManifest(deployRoot, slotName)
  if (manifest === undefined) throw new Error(`m5-release: slot '${slotName}' has no manifest`)
  fs.writeFileSync(join(resolve(manifest.installRoot), CANARY_PROBE), `${CANARY_PROBE_SOURCE}\n`)
}

/**
 * Run the canary for one candidate slot with an isolated state home.
 * Steps: identity ('--version'), profile boot (default-config dump), the
 * packed guard/auth/persistence probe, and a clean shutdown. Failures are
 * reported as structured problems and never touch the active pointer.
 * @param deployRoot - the deployment directory.
 * @param slotName - the candidate slot to probe.
 * @param canaryHome - isolated state home the probe writes to.
 * @returns problem strings; empty means the canary passed.
 */
export function runCanary(deployRoot: string, slotName: string, canaryHome: string): string[] {
  const validation = validateSlot(deployRoot, slotName)
  if (!validation.ok || validation.manifest === undefined) return [`slot validation failed: ${validation.failures.join('; ')}`]
  const manifest = validation.manifest
  const problems: string[] = []
  const bin = join(resolve(manifest.installRoot), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(bin)) return [`CLI entry missing at ${bin}`]
  const run = (args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string } => {
    const result = spawnSync(process.execPath, [bin, ...args], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: canaryHome, ...env },
      timeout: 120_000,
    })
    return { status: result.status, stdout: `${result.stdout}${result.stderr}` }
  }
  const version = run(['--version'])
  if (version.status !== 0 || !version.stdout.includes(manifest.version)) {
    problems.push(`identity check failed (expected version ${manifest.version}): ${version.stdout.slice(0, 200)}`)
  }
  const boot = run(['--profile', 'headless', '--dump-default-config'])
  if (boot.status !== 0 || !boot.stdout.includes('@deepseek-ai/dsh-action-policy-guard')) {
    problems.push(`profile boot failed or the action-policy guard row is absent: ${boot.stdout.slice(0, 200)}`)
  }
  const probe = spawnSync(process.execPath, [join(resolve(manifest.installRoot), CANARY_PROBE)], {
    encoding: 'utf8',
    env: { ...process.env, M5_CANARY_HOME: canaryHome },
    timeout: 120_000,
  })
  if (probe.status !== 0) {
    problems.push(`guard/auth/persistence probe failed: ${`${probe.stdout}${probe.stderr}`.slice(0, 400)}`)
  }
  return problems
}
/** The packed-runtime probe copied into each slot (imports resolve from the slot's own tree). */
const CANARY_PROBE_SOURCE = `// M5 canary probe: guard presence + deny path + persistence round trip.
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as ActionPolicyGuard from '@deepseek-ai/dsh-action-policy-guard'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(ApprovalService, {})
await ctx.plugin(ActionPolicyGuard, { mode: 'enforce' })
let bodyRan = false
ctx.tools.register(defineContentToolFixture({
  name: 'canary-side-effect', description: 'c', parameters: {},
  effects: 'side-effectful',
  async execute() { bodyRan = true; return [{ type: 'text', text: 'ran' }] },
}))
// Agentless side-effectful call under enforce: the guard deny path must fire.
const denied = await ctx.tools.execute({
  callId: ToolCallId('canary-1'), name: 'canary-side-effect', arguments: {}, signal: new AbortController().signal,
})
if (!denied.isError || bodyRan) {
  console.error('canary guard deny path failed')
  process.exit(1)
}
// Persistence write/reopen round trip against the isolated state home.
await ctx.plugin(JsonlSessionPersistence, { root: process.env.M5_CANARY_HOME, compression: 'none' })
const id = SessionId('canary-' + Date.now())
const handle = await ctx.sessionPersistence.create({
  version: 0, id, createdAt: Date.now(), isSeeded: false, delegationDepth: 0,
})
await handle.append([{ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }])
await handle.close()
const reopened = await (await ctx.sessionPersistence.open(id, 'read')).read()
if (reopened.length !== 1 || reopened[0]?.type !== 'turn/start') {
  console.error('canary persistence round trip failed')
  process.exit(1)
}
await ctx.fiber.dispose()
console.log('M5 canary probe OK')
`
