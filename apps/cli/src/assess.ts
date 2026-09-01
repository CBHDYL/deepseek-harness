/**
 * Read-only runtime-identity and health assessment for `dsh assess`: it never
 * boots a tree, never writes to a profile directory, and reports what the
 * current installation actually is (version, node, profile composition,
 * registry channels, and a small set of always-safe health probes).
 *
 * This command is boot-free and side-effect-free on purpose; composing a
 * profile and walking its patch layers is the job of `--dump-config`. Anything
 * that needs a booted tree, a candidate runtime, a full test run, or an
 * external key stays `NOT_TESTED` here and belongs to the candidate gate.
 *
 * Deeper, machine-local analysis for a specific deployment (source-vs-runtime
 * artifact drift, a Doctor supervisor, its patch-set manifest) is intentionally
 * out of this portable command; it lives in a deployment-owned tool that binds
 * to an explicit runtime identity.
 * @module @deepseek-ai/dsh/assess
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const SCHEMA_VERSION = '0.1.0'
const NAME = 'dsh'

/** Status of one check. `STALE` is reserved for reports whose evidence points at an old runtime. */
export type CheckStatus = 'PASS' | 'WARN' | 'BLOCK' | 'NOT_TESTED' | 'STALE'

/** One check's versioned evidence. */
export interface ReportCheck {
  /** Stable check id, e.g. `update.stable`. */
  id: string
  /** The check's semantic version. */
  checkVersion: string
  status: CheckStatus
  /** Short, JSON-serializable facts the decision ran on. */
  evidence: Record<string, unknown>
  /** Human-readable conclusion, prefer-redacted. */
  detail: string
  /** ISO-8601 observation time. */
  observedAt: string
  durationMs: number
  /** Process exit code this status maps to. */
  exitCode: number
}

/** The runtime snapshot `dsh assess` binds its report to. */
export interface AssessIdentity {
  schemaVersion: string
  dshVersion: string
  nodeVersion: string
  osPlatform: string
  osArch: string
  profile: string
  profileDir: string
  /** digest of the profile's `cordis.patch.yml`, or `null` when absent/unreadable. */
  profilePatchDigest: string | null
  /** True when the profile directory looks like a real DSH profile. */
  profilePresent: boolean
  /** Number of `dsh.profile.bundles` declared by the profile. */
  bundleCount: number
}

/** A full assess report. */
export interface AssessReport {
  schemaVersion: string
  profile: string
  generatedAt: string
  identity: AssessIdentity
  overall: CheckStatus
  checks: ReportCheck[]
}

/** Resolved `dsh assess` options. */
export interface AssessOptions {
  profile: string
  /** The port a local web host is expected on (default 3080); used only for the GUI probe. */
  port: number
  json: boolean
}

const now = (): string => new Date().toISOString()

function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Length of an untyped value when it is an array, else 0. */
function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

async function readText(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  const text = await readText(p)
  if (text === null) return null
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    return value
  } catch {
    return null
  }
}

/** Resolve profile dir and read its composing facts, without ever writing. */
async function readProfile(profile: string): Promise<AssessIdentity> {
  const profileDir = join(resolveDshHome(), 'profiles', profile)
  const packagePath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const pkg = await readJson(packagePath)
  const patchText = await readText(patchPath)
  const dshSection = pkg?.dsh as { profile?: { bundles?: unknown[] }; bundles?: string[] } | undefined
  const bundleCount = count(dshSection?.profile?.bundles) || count(dshSection?.bundles)
  const identity: AssessIdentity = {
    schemaVersion: SCHEMA_VERSION,
    dshVersion: await readDshVersion(),
    nodeVersion: process.version,
    osPlatform: os.platform(),
    osArch: os.arch(),
    profile,
    profileDir,
    profilePatchDigest: patchText === null ? null : sha256(Buffer.from(patchText, 'utf8')).slice(0, 12),
    profilePresent: pkg !== null || patchText !== null,
    bundleCount,
  }
  return identity
}

/** Read this CLI app's own version, resolved like the launcher bin does. */
async function readDshVersion(): Promise<string> {
  try {
    const manifest = await readJson(fileURLToPath(new URL('../package.json', import.meta.url)))
    return typeof manifest?.version === 'string' ? (manifest.version as string) : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Read npm dist-tags for the DSH package (best-effort; network may be unavailable). */
function readNpmChannels(): { latest?: string; next?: string; alpha?: string } | null {
  try {
    const out = execFileSync('npm', ['view', '@deepseek-ai/dsh', 'dist-tags', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(os.tmpdir(), 'dsh-npm-cache-assess') },
    })
    const value = JSON.parse(out) as { latest?: string; next?: string; alpha?: string }
    return value
  } catch {
    return null
  }
}

/** Identify the running `dsh web` process (best-effort), to classify launch mode and liveness. */
function detectWebProcess(): { running: boolean; mode: 'direct' | 'doctor-managed' | 'unknown' } {
  let procs: string
  try {
    procs = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  } catch {
    return { running: false, mode: 'unknown' }
  }
  const lines = procs.split('\n').filter(Boolean)
  // Match both direct `dsh web` and Doctor-launched `dsh/lib/bin.js --profile web`.
  const isWebLine = (line: string): boolean =>
    /\bdsh\s+web\b/.test(line) || /\bdsh\/lib\/bin\.js\s+--profile\s+(web|headless)/.test(line)
  const dshWeb = lines.find(isWebLine)
  if (!dshWeb) return { running: false, mode: 'unknown' }
  // Follow the parent chain; a Doctor launcher's CLI module marks managed launch.
  const rows: { pid: string; ppid: string; cmd: string }[] = []
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    if (m && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      rows.push({ pid: m[1], ppid: m[2], cmd: m[3] })
    }
  }
  const byPid = new Map(rows.map(r => [r.pid, r]))
  let cur = rows.find(r => isWebLine(r.cmd))
  let mode: 'direct' | 'doctor-managed' | 'unknown' = 'direct'
  let guard = 0
  while (cur && guard < 20) {
    const parent = byPid.get(cur.ppid)
    if (!parent) break
    if (/doctor/.test(parent.cmd) || /cli\.mjs/.test(parent.cmd)) { mode = 'doctor-managed'; break }
    cur = parent
    guard++
  }
  return { running: true, mode }
}

type ProbeResult = { status: CheckStatus; evidence: Record<string, unknown>; detail: string }

async function probe(
  id: string,
  checkVersion: string,
  fn: () => Promise<ProbeResult>,
): Promise<ReportCheck> {
  const started = performance.now()
  let status: CheckStatus = 'NOT_TESTED'
  let evidence: Record<string, unknown> = {}
  let detail = ''
  try {
    const r = await fn()
    status = r.status
    evidence = r.evidence
    detail = r.detail
  } catch (error) {
    status = 'BLOCK'
    detail = `probe error: ${error instanceof Error ? error.message : String(error)}`
  }
  return {
    id,
    checkVersion,
    status,
    evidence,
    detail,
    observedAt: now(),
    durationMs: Math.round(performance.now() - started),
    exitCode: status === 'PASS' ? 0 : status === 'WARN' ? 1 : status === 'BLOCK' ? 2 : 3,
  }
}

/** Build the `dsh assess` report from the environment; never writes, never boots. */
export async function runAssess(options: AssessOptions): Promise<AssessReport> {
  const identity = await readProfile(options.profile)
  const npmChannels = readNpmChannels()
  const web = detectWebProcess()

  const checks: ReportCheck[] = [
    await probe('identity.complete', '0.1.0', async () => {
      const missing: string[] = []
      if (!identity.dshVersion) missing.push('dshVersion')
      if (!identity.profilePresent) missing.push('profile')
      return missing.length === 0
        ? { status: 'PASS', evidence: { schemaVersion: identity.schemaVersion }, detail: '' }
        : { status: 'WARN', evidence: { missing }, detail: `missing: ${missing.join(', ')}` }
    }),
    await probe('profile.patches', '0.1.0', async () => {
      if (!identity.profilePresent) return { status: 'BLOCK', evidence: { profileDir: identity.profileDir }, detail: 'profile dir not present' }
      return identity.profilePatchDigest === null
        ? { status: 'WARN', evidence: { profileDir: identity.profileDir }, detail: 'cordis.patch.yml missing or unreadable' }
        : { status: 'PASS', evidence: { profilePatchDigest: identity.profilePatchDigest, bundleCount: identity.bundleCount }, detail: '' }
    }),
    await probe('update.stable', '0.1.0', async () => {
      if (npmChannels === null) return { status: 'NOT_TESTED', evidence: {}, detail: 'npm dist-tags unavailable (offline or npm error)' }
      const cur = identity.dshVersion
      const latest = npmChannels.latest
      if (!latest) return { status: 'NOT_TESTED', evidence: { cur }, detail: 'latest tag missing' }
      if (cur !== latest) return { status: 'WARN', evidence: { current: cur, latest }, detail: `update available: ${cur} -> ${latest} (recorded, not applied)` }
      return { status: 'PASS', evidence: { current: cur, latest }, detail: '' }
    }),
    await probe('update.prerelease', '0.1.0', async () => {
      if (npmChannels === null) return { status: 'NOT_TESTED', evidence: {}, detail: '' }
      const alpha = npmChannels.alpha
      if (alpha && alpha !== identity.dshVersion) return { status: 'WARN', evidence: { current: identity.dshVersion, alpha }, detail: `prerelease ${alpha} exists; production promotion needs the candidate-gate evidence` }
      return { status: 'PASS', evidence: { alpha }, detail: '' }
    }),
    await probe('liveness.process', '0.1.0', async () => {
      return web.running ? { status: 'PASS', evidence: { mode: web.mode }, detail: '' } : { status: 'BLOCK', evidence: { running: false }, detail: 'no running dsh web process' }
    }),
    await probe('gui.reachable', '0.1.0', async () => {
      const url = `http://127.0.0.1:${options.port}`
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
        return { status: 'PASS', evidence: { url, httpStatus: res.status }, detail: '' }
      } catch (error) {
        return { status: web.running ? 'WARN' : 'NOT_TESTED', evidence: { url }, detail: `gui unreachable: ${error instanceof Error ? error.message : String(error)}` }
      }
    }),
    await probe('credential.isolation', '0.1.0', async () => {
      const creds = join(resolveDshHome(), '.credentials.yaml')
      return { status: 'PASS', evidence: { read: false, credentialFilePresent: existsSync(creds) }, detail: 'this command never reads or hashes credential files' }
    }),
    await probe('readiness.files', '0.1.0', async () => {
      const profileDir = join(resolveDshHome(), 'profiles', options.profile)
      // Only the core files; a bare ported profile may not carry every layer.
      const present = existsSync(join(profileDir, 'package.json'))
      return present ? { status: 'PASS', evidence: { profileDir }, detail: '' } : { status: 'BLOCK', evidence: { profileDir }, detail: 'profile/profiles/<name> has no package.json' }
    }),
  ]

  let overall: CheckStatus = 'PASS'
  const rank: Record<CheckStatus, number> = { PASS: 0, NOT_TESTED: 1, WARN: 2, STALE: 2, BLOCK: 3 }
  for (const c of checks) {
    if (rank[c.status] > rank[overall]) overall = c.status
  }

  return { schemaVersion: SCHEMA_VERSION, profile: options.profile, generatedAt: now(), identity, overall, checks }
}

function renderHuman(report: AssessReport): string {
  const i = report.identity
  const lines: string[] = []
  lines.push(`dsh assess  schema=${report.schemaVersion}  profile=${report.profile}`)
  lines.push(`generatedAt=${report.generatedAt}  overall=${report.overall}`)
  lines.push('')
  lines.push('--- identity ---')
  lines.push(`  dsh=${i.dshVersion}  node=${i.nodeVersion}  os=${i.osPlatform}/${i.osArch}`)
  lines.push(`  profile=${i.profile}  dir=${i.profileDir}  present=${i.profilePresent}  bundles=${i.bundleCount}`)
  lines.push(`  patchDigest=${i.profilePatchDigest ?? '(none)'}`)
  lines.push('')
  lines.push('--- checks ---')
  for (const c of report.checks) {
    lines.push(`  [${c.status.padEnd(10)}] ${c.id} v${c.checkVersion}${c.detail ? ' — ' + c.detail : ''} (${c.durationMs}ms)`)
  }
  lines.push('')
  lines.push(`overall=${report.overall}`)
  return lines.join('\n')
}

/** Entry for the `dsh assess` mode: builds the report and writes it to stdout. */
export async function printAssess(options: AssessOptions): Promise<number> {
  const report = await runAssess(options)
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(renderHuman(report) + '\n')
  }
  return report.overall === 'BLOCK' ? 2 : report.overall === 'WARN' || report.overall === 'STALE' ? 1 : 0
}

/* v8 ignore start -- exported for the built-bin acceptance; the mode itself is exercised via bin */
export { NAME }
/* v8 ignore stop */
