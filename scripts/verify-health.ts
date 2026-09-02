/**
 * Aggregate machine-checkable DSH health into one PASS / WARN / BLOCK verdict.
 *
 * This is an aggregation layer only: every signal below already exists as its
 * own mechanism, and this module consumes their results rather than
 * re-deciding them. The critical-lineage verdicts come from the R2 checker;
 * identity comes from the artifact's own manifest; profiles are checked by a
 * read-only static parse (`dsh --dump-config` is not read-only — it rewrites
 * profile files); prerequisites report environment debt.
 *
 * Verdict rules: a BLOCK is a fact this build can prove is broken (critical
 * lineage, an unreadable identity, a profile that cannot compose). A WARN is
 * environment debt or a signal that cannot shadow the core runtime (an
 * unstamped identity, an old Python, an unavailable PTY, a critical package
 * hoisted inside a profile subtree). Plugin-private compatibility pins never
 * contribute a BLOCK or WARN — they are the accepted shape R2 documents.
 * @module scripts/verify-health
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { load } from 'js-yaml'
import { CRITICAL_PACKAGES, checkCriticalResolutions, expectedCoreLineage, subprocessResolver, type CriticalResolution } from './release/critical-resolution.ts'
import { isEntry } from './release/process.ts'
import { declaredSourceRevision } from './release/source-revision.ts'

/** One aggregated signal. */
export interface HealthSignal {
  /** Signal name. */
  readonly name: string
  /** Signal verdict. */
  readonly status: HealthStatus
  /** Why the status was assigned. */
  readonly detail: string
}

/** The machine-checkable overall verdict. */
export type HealthStatus = 'PASS' | 'WARN' | 'BLOCK'

/** Everything the aggregation judges. */
export interface HealthInput {
  /** The installed core artifact's declared identity. */
  readonly identity: { readonly version: string | undefined; readonly sourceRevision: string | undefined }
  /** R2 critical-lineage resolutions for the installed runtime. */
  readonly lineage: readonly CriticalResolution[]
  /** Per-profile composition and top-level critical-package presence. */
  readonly profiles: readonly {
    readonly name: string
    readonly composes: boolean
    readonly criticalAtTopLevel: readonly string[]
  }[]
  /** Host environment prerequisites. */
  readonly prerequisites: { readonly pythonOk: boolean; readonly pythonDetail: string; readonly ptyAvailable: boolean | undefined }
}

const BLOCK_RANK = 2
const WARN_RANK = 1
const PASS_RANK = 0

function worst(a: HealthStatus, b: HealthStatus): HealthStatus {
  const rank = (s: HealthStatus) => (s === 'BLOCK' ? BLOCK_RANK : s === 'WARN' ? WARN_RANK : PASS_RANK)
  return rank(a) >= rank(b) ? a : b
}

/**
 * Judge one aggregation input.
 * @param input - gathered signals.
 * @returns The overall verdict and one signal per judged surface.
 */
export function assessHealth(input: HealthInput): { readonly status: HealthStatus; readonly signals: readonly HealthSignal[] } {
  const signals: HealthSignal[] = []

  if (input.identity.version === undefined) {
    signals.push({ name: 'identity', status: 'BLOCK', detail: 'core manifest declares no usable version' })
  } else if (input.identity.sourceRevision === undefined) {
    signals.push({ name: 'identity', status: 'WARN', detail: `version ${input.identity.version} carries no source revision (unproven provenance)` })
  } else {
    signals.push({ name: 'identity', status: 'PASS', detail: `version ${input.identity.version} source ${input.identity.sourceRevision}` })
  }

  const failures = input.lineage.filter(entry => entry.status !== 'MATCH' && entry.status !== 'ALLOWED_COMPATIBILITY')
  if (failures.length > 0) {
    signals.push({ name: 'lineage', status: 'BLOCK', detail: `${String(failures.length)} critical package(s) fail: ${failures.map(entry => `${entry.package}=${entry.status}`).join(', ')}` })
  } else {
    signals.push({ name: 'lineage', status: 'PASS', detail: `${String(input.lineage.length)} critical package(s) acceptable` })
  }

  for (const profile of input.profiles) {
    if (!profile.composes) {
      signals.push({ name: `profile:${profile.name}`, status: 'BLOCK', detail: 'profile manifest or cordis file is unreadable or unparsable' })
    } else if (profile.criticalAtTopLevel.length > 0) {
      signals.push({ name: `profile:${profile.name}`, status: 'WARN', detail: `critical package(s) hoisted at profile top level: ${profile.criticalAtTopLevel.join(', ')} — private to the profile, cannot shadow the core runtime` })
    } else {
      signals.push({ name: `profile:${profile.name}`, status: 'PASS', detail: 'profile files parse cleanly (static check)' })
    }
  }

  if (input.prerequisites.pythonOk) {
    signals.push({ name: 'prerequisite:python', status: 'PASS', detail: input.prerequisites.pythonDetail })
  } else {
    signals.push({ name: 'prerequisite:python', status: 'WARN', detail: `${input.prerequisites.pythonDetail} — code-runtime-python needs CPython >= 3.10 (environment debt)` })
  }
  if (input.prerequisites.ptyAvailable === true) {
    signals.push({ name: 'prerequisite:pty', status: 'PASS', detail: 'PTY available' })
  } else if (input.prerequisites.ptyAvailable === false) {
    signals.push({ name: 'prerequisite:pty', status: 'WARN', detail: 'PTY unavailable in this execution environment (posix_openpt EPERM) — terminal suites owed an unsandboxed re-run' })
  } else {
    signals.push({ name: 'prerequisite:pty', status: 'WARN', detail: 'PTY availability could not be probed' })
  }

  const status = signals.reduce<HealthStatus>((carry, signal) => worst(carry, signal.status), 'PASS')
  return { status, signals }
}

/** Read a core manifest and report its declared identity. */
function gatherIdentity(coreManifestPath: string): HealthInput['identity'] {
  const manifest = JSON.parse(readFileSync(coreManifestPath, 'utf8')) as Record<string, unknown>
  return {
    version: typeof manifest['version'] === 'string' ? manifest['version'] : undefined,
    sourceRevision: declaredSourceRevision(manifest),
  }
}

/** Probe whether a PTY can be opened in this execution environment. */
function gatherPtyAvailability(): boolean | undefined {
  const script = 'const pty=require("node-pty");const p=pty.spawn("sh",[]);p.kill()'
  try {
    execFileSync(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 15000 })
    return true
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr
    const message = `${error instanceof Error ? error.message : ''} ${stderr === undefined ? '' : String(stderr)}`
    if (message.includes('EPERM') || message.includes('Operation not permitted')) return false
    return undefined
  }
}

/** Probe the default python3 version against the code-runtime floor. */
function gatherPython(): { readonly pythonOk: boolean; readonly pythonDetail: string } {
  try {
    const reported = execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim()
    const match = /Python (\d+)\.(\d+)/.exec(reported)
    if (match === null) return { pythonOk: false, pythonDetail: `python3 reported ${JSON.stringify(reported)}` }
    const [, major, minor] = match
    const ok = Number(major) > 3 || (Number(major) === 3 && Number(minor) >= 10)
    return { pythonOk: ok, pythonDetail: `python3 = ${major}.${minor}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { pythonOk: false, pythonDetail: `python3 unavailable: ${message}` }
  }
}

/**
 * Judge one DSH home's profiles by read-only static consistency.
 *
 * `dsh --dump-config` is not read-only: it rewrites the profile manifest
 * files, which both mutates the user's home and fails under a write-blocked
 * execution environment. A health check therefore parses the profile files it
 * can read without touching them: an unreadable or unparsable manifest or
 * cordis file is a BLOCK, a clean parse is a PASS at the static level, and
 * loader composition is deliberately not exercised here.
 */
function gatherProfiles(dshHome: string): HealthInput['profiles'] {
  const profilesDir = join(dshHome, 'profiles')
  let entries: string[] = []
  try {
    entries = readdirSync(profilesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map(entry => entry.name)
  } catch {
    return []
  }
  return entries.map((name) => {
    let composes = true
    try {
      JSON.parse(readFileSync(join(profilesDir, name, 'package.json'), 'utf8')) as unknown
    } catch {
      composes = false
    }
    for (const file of ['cordis.yml', 'cordis.patch.yml']) {
      try {
        load(readFileSync(join(profilesDir, name, file), 'utf8'))
      } catch {
        if (existsSync(join(profilesDir, name, file))) composes = false
      }
    }
    const criticalAtTopLevel: string[] = []
    try {
      const scope = join(profilesDir, name, 'node_modules', '@deepseek-ai')
      for (const dir of readdirSync(scope)) {
        const packageName = `@deepseek-ai/${dir}`
        if (CRITICAL_PACKAGES.includes(packageName as (typeof CRITICAL_PACKAGES)[number])) criticalAtTopLevel.push(packageName)
      }
    } catch {
      // No @deepseek-ai scope at profile top level: nothing to report.
    }
    return { name, composes, criticalAtTopLevel }
  })
}

function main(): void {
  const { values } = parseArgs({
    options: {
      install: { type: 'string' },
      'dsh-home': { type: 'string' },
    },
    allowPositionals: false,
  })
  if (values.install === undefined) throw new Error('usage: verify-health.ts --install <installed core package root> [--dsh-home ~/.dsh]')
  const installRoot = values.install
  const dshHome = values['dsh-home'] ?? join(homedir(), '.dsh')
  const coreManifest = join(installRoot, 'package.json')

  const identity = gatherIdentity(coreManifest)
  const lineage = expectedCoreLineage(coreManifest)
  const entry = join(installRoot, 'lib', 'bin.js')
  const resolutions = checkCriticalResolutions(subprocessResolver(entry, { ...process.env }), lineage)
  const profiles = gatherProfiles(dshHome)
  const python = gatherPython()
  const ptyAvailable = gatherPtyAvailability()

  const prerequisites = { pythonOk: python.pythonOk, pythonDetail: python.pythonDetail, ptyAvailable }
  const result = assessHealth({ identity, lineage: resolutions, profiles, prerequisites })
  for (const signal of result.signals) console.log(`health-${signal.name}: ${signal.status} ${signal.detail}`)
  console.log(`health: ${result.status}`)
  if (result.status === 'BLOCK') process.exitCode = 1
  else if (result.status === 'WARN') process.exitCode = 2
}

if (isEntry(import.meta.url)) main()
