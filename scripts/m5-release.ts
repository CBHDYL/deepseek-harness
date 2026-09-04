/**
 * M5 release-slot deployment tooling: two immutable release slots
 * (`slots/stable`, `slots/candidate`), an evidence-derived release manifest
 * per slot, one atomic `active` pointer, a rebuild-free rollback, and a
 * canary probe that runs only against the candidate slot with an isolated
 * state home.
 *
 * Deployment model (M5):
 * - executable/runtime = the slot's packed `node_modules` install root
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
  /** Absolute install root holding the slot's own `node_modules`. */
  installRoot: string
  /** Critical package name → lineage evidence (packed entry path + SHA-256). */
  criticalPackages: Record<string, { digest: string; lib: string }>
  /** ISO timestamp the slot evidence was recorded. */
  createdAt: string
  /**
   * State compatibility the candidate claims. Only `shared-compatible`
   * (reuses the shared state home read/write without a migration) may be
   * promoted; `migrating` is blocked because this tool ships no state
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

/** The deployed slot layout: `<deployRoot>/slots/<name>/release-manifest.json` + install root. */
export function slotDir(deployRoot: string, slotName: string): string {
  return join(deployRoot, SLOTS_DIR, slotName)
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

/** Read the active slot name, or `undefined` when no pointer exists yet. */
export function resolveActive(deployRoot: string): string | undefined {
  const active = join(deployRoot, ACTIVE_POINTER)
  try {
    const link = fs.readlinkSync(active)
    return relative(join(deployRoot, SLOTS_DIR), link)
  } catch {
    return undefined
  }
}

/** One critical package whose packed entry file is hashed as lineage evidence. */
export interface CriticalPackage {
  /** Package name, e.g. `@deepseek-ai/dsh-session`. */
  readonly name: string
  /** Path to the packed entry file inside the package, default `lib/index.js`. */
  readonly lib?: string
}

/** Normalize a critical entry (name string or `{name, lib}` object). */
function criticalEntry(entry: string | CriticalPackage): { name: string; lib: string } {
  return typeof entry === 'string' ? { name: entry, lib: 'lib/index.js' } : { name: entry.name, lib: entry.lib ?? 'lib/index.js' }
}

/** SHA-256 of one file's bytes. */
function fileDigest(path: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

/** Every `@deepseek-ai/*` package directory under an install root's node_modules. */
function installedPackages(installRoot: string): string[] {
  const scoped = join(installRoot, 'node_modules', '@deepseek-ai')
  try {
    return fs.readdirSync(scoped).map(name => `@deepseek-ai/${name}`).sort()
  } catch {
    return []
  }
}

/**
 * Record a release manifest from ACTUAL install evidence: critical-package
 * hashes are recomputed from the install root's packed `lib/index.js` files
 * and the artifact digest is derived from the complete installed-package
 * hash list — never hand-written claims.
 * @param deployRoot - the deployment directory.
 * @param slotName - `stable` or `candidate`.
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
  const installRoot = join(dir, 'install')
  const entries = critical.map(criticalEntry)
  const missing = entries.filter(entry => !fs.existsSync(join(installRoot, 'node_modules', ...entry.name.split('/'), entry.lib)))
  if (missing.length > 0) {
    throw new Error(`m5-release: cannot record ${slotName} manifest — missing critical package libs: ${missing.map(entry => entry.name).join(', ')}`)
  }
  const criticalPackages: Record<string, { digest: string; lib: string }> = {}
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    criticalPackages[entry.name] = { digest: fileDigest(join(installRoot, 'node_modules', ...entry.name.split('/'), entry.lib)), lib: entry.lib }
  }
  const evidence: string[] = []
  for (const name of installedPackages(installRoot)) {
    const lib = join(installRoot, 'node_modules', ...name.split('/'), 'lib', 'index.js')
    if (fs.existsSync(lib)) evidence.push(`${name} ${fileDigest(lib)}`)
  }
  const manifest: ReleaseManifest = {
    releaseId: identity.releaseId,
    version: identity.version,
    sourceRevision: identity.sourceRevision,
    artifactDigest: crypto.createHash('sha256').update(evidence.join('\n')).digest('hex'),
    installRoot: resolve(installRoot),
    criticalPackages,
    createdAt: new Date().toISOString(),
    statePolicy: { kind: 'shared-compatible' },
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(join(dir, RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Read and parse one slot's manifest; `undefined` when absent or malformed. */
/** Narrow an untrusted parsed manifest record to the release-manifest shape. */
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
 * Validate one slot against its recorded evidence: manifest shape, critical
 * lineage hashes, install-root existence, and slot isolation (an install
 * root must not nest inside another slot's root and must own its
 * `node_modules`).
 */
export function validateSlot(deployRoot: string, slotName: string): SlotValidation {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(join(slotDir(deployRoot, slotName), RELEASE_MANIFEST), 'utf8')) as unknown
  } catch {
    return { ok: false, failures: [`slot "${slotName}" has no readable ${RELEASE_MANIFEST}`] }
  }
  const shaped = shapeManifest(raw)
  if (shaped.manifest === undefined) {
    return { ok: false, failures: shaped.failures }
  }
  const manifest = shaped.manifest
  const failures: string[] = []
  const installRoot = resolve(manifest.installRoot)
  if (!fs.existsSync(join(installRoot, 'node_modules'))) {
    failures.push(`install root ${installRoot} has no node_modules`)
  }
  const scoped = join(installRoot, 'node_modules', '@deepseek-ai')
  if (!fs.existsSync(scoped)) failures.push(`install root ${installRoot} has no @deepseek-ai packages`)
  for (const sibling of fs.readdirSync(join(deployRoot, SLOTS_DIR)).filter(name => name !== slotName)) {
    const siblingRoot = readManifest(deployRoot, sibling)?.installRoot
    if (siblingRoot === undefined) continue
    const fromSibling = relative(resolve(siblingRoot), installRoot)
    if (fromSibling === '' || (!fromSibling.startsWith('..') && !isAbsolute(fromSibling))) {
      failures.push(`slot "${slotName}" install root nests inside slot "${sibling}" (cross-slot isolation violated)`)
    }
  }
  for (const [name, evidence] of Object.entries(manifest.criticalPackages)) {
    const lib = join(installRoot, 'node_modules', ...name.split('/'), evidence.lib)
    if (!fs.existsSync(lib)) {
      failures.push(`critical package ${name} is missing from the install root`)
    } else if (fileDigest(lib) !== evidence.digest) {
      failures.push(`critical package ${name} lineage mismatch (packed lib changed)`)
    }
  }
  return { ok: failures.length === 0, failures, manifest }
}

/**
 * Atomically promote one validated slot: the previous active slot (or
 * `fallbackStable`) is recorded as the rollback target BEFORE the pointer
 * moves, the pointer switches by rename, and a post-switch identity check
 * restores the prior slot on any failure — never leaving a half-promoted
 * runtime.
 * @param deployRoot - the deployment directory.
 * @param slotName - the candidate slot to activate.
 * @param fallbackStable - rollback target when no previous active exists.
 * @throws {Error} when validation, state policy, switching, or identity fails.
 */
export function promote(deployRoot: string, slotName: string, fallbackStable: string): PointerResult {
  const validation = validateSlot(deployRoot, slotName)
  if (!validation.ok || validation.manifest === undefined) {
    throw new Error(`m5-release: promotion blocked — ${validation.failures.join('; ')}`)
  }
  if (validation.manifest.statePolicy.kind === 'migrating') {
    throw new Error('m5-release: promotion blocked — the candidate declares an irreversible state migration and this deployment has no verified state rollback')
  }
  const previous = resolveActive(deployRoot) ?? fallbackStable
  if (!validateSlot(deployRoot, previous).ok) {
    throw new Error(`m5-release: promotion blocked — rollback target "${previous}" is not a valid slot`)
  }
  const meta = join(deployRoot, POINTER_META)
  fs.writeFileSync(meta, `${JSON.stringify({ previous, switchedAt: new Date().toISOString() }, null, 2)}\n`)
  try {
    switchPointer(deployRoot, slotName)
  } catch (error) {
    throw new Error(`m5-release: pointer switch failed — ${String(error)}`)
  }
  // Post-switch identity: the active pointer must resolve to this exact slot
  // and the slot must still validate. Any failure restores the prior slot.
  if (resolveActive(deployRoot) !== slotName || !validateSlot(deployRoot, slotName).ok) {
    try { switchPointer(deployRoot, previous) } catch { /* the prior pointer attempt is recorded in POINTER_META */ }
    throw new Error(`m5-release: post-switch identity check failed — active restored to "${previous}"`)
  }
  return { active: slotName, releaseId: validation.manifest.releaseId, previous }
}

/**
 * Deterministically restore the runtime pointer to the slot recorded before
 * the last promotion. Requires no rebuild, no reinstall, no repack, and no
 * network — the two slots are untouched; only the pointer moves back.
 * @param deployRoot - the deployment directory.
 */
export function rollback(deployRoot: string): PointerResult {
  let meta: { previous?: string } = {}
  try {
    meta = JSON.parse(fs.readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { previous?: string }
  } catch { /* no recorded rollback target */ }
  if (typeof meta.previous !== 'string' || meta.previous === '') {
    throw new Error('m5-release: rollback unavailable — no previous active slot is recorded')
  }
  const validation = validateSlot(deployRoot, meta.previous)
  if (!validation.ok) {
    throw new Error(`m5-release: rollback refused — recorded slot "${meta.previous}" is invalid: ${validation.failures.join('; ')}`)
  }
  switchPointer(deployRoot, meta.previous)
  if (resolveActive(deployRoot) !== meta.previous) {
    throw new Error(`m5-release: rollback pointer check failed for "${meta.previous}"`)
  }
  if (validation.manifest === undefined) {
    throw new Error(`m5-release: rollback refused — recorded slot "${meta.previous}" has no manifest`)
  }
  return { active: meta.previous, releaseId: validation.manifest.releaseId }
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
  if (manifest === undefined) throw new Error(`m5-release: slot "${slotName}" has no manifest`)
  fs.writeFileSync(join(resolve(manifest.installRoot), CANARY_PROBE), `${CANARY_PROBE_SOURCE}\n`)
}

/**
 * Run the canary for one candidate slot with an isolated state home.
 * Steps: identity (`--version`), profile boot (default-config dump), the
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
    problems.push(`guard/auth/persistence probe failed: ${(`${probe.stdout}${probe.stderr}`).slice(0, 400)}`)
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
