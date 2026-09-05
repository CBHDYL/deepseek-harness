/**
 * M5 release-slot mechanism tests: evidence-derived manifests, realpath
 * confinement, atomic promotion, generation-aware rebuild-free rollback, and
 * the promotion failure injections A–F. Each test owns its temporary deploy
 * root and install roots; no ports, no network, no shared state.
 */

import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_POINTER,
  POINTER_META,
  RELEASE_MANIFEST,
  installCanaryProbe,
  promote,
  readManifest,
  recordManifest,
  resolveActive,
  rollback,
  runCanary,
  slotDir,
  validateSlot,
} from './m5-release.ts'

const CRITICAL = ['@deepseek-ai/dsh-action-policy-guard', '@deepseek-ai/dsh-session']

interface Fixture {
  deployRoot: string
  stableRoot: string
  candidateRoot: string
}

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build a deployment with two real (stubbed-lib) install roots and manifests. */
function fixture(options: { corruptCandidate?: boolean; nestedCandidate?: boolean; migrating?: boolean } = {}): Fixture {
  const deployRoot = mkdtempSync(join(tmpdir(), 'dsh-m5-'))
  roots.push(deployRoot)
  mkdirSync(slotDir(deployRoot, 'stable'), { recursive: true })
  const stableRoot = join(slotDir(deployRoot, 'stable'), 'install')
  const candidateRoot = join(slotDir(deployRoot, 'candidate'), 'install')
  const nestedRoot = join(stableRoot, 'nested', 'install')
  for (const name of CRITICAL) {
    const content = `${name}-content\n`
    const dir = join(stableRoot, 'node_modules', ...name.split('/'), 'lib')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), content)
    if (options.corruptCandidate !== true) {
      const candidateDir = join(candidateRoot, 'node_modules', ...name.split('/'), 'lib')
      mkdirSync(candidateDir, { recursive: true })
      writeFileSync(join(candidateDir, 'index.js'), content)
      if (options.nestedCandidate === true) {
        const nestedDir = join(nestedRoot, 'node_modules', ...name.split('/'), 'lib')
        mkdirSync(nestedDir, { recursive: true })
        writeFileSync(join(nestedDir, 'index.js'), content)
      }
    }
  }
  mkdirSync(candidateRoot, { recursive: true })
  recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: '0.1.2-alpha.5', sourceRevision: 'stable-rev' }, CRITICAL)
  recordManifest(deployRoot, 'candidate', { releaseId: 'candidate-r1', version: '0.1.2-alpha.5', sourceRevision: 'candidate-rev', ...options.migrating === true ? { statePolicy: 'migrating' as const } : {} }, CRITICAL)
  if (options.nestedCandidate === true) {
    const manifest = readManifest(deployRoot, 'candidate')!
    manifest.installRoot = realpathSync(nestedRoot)
    writeFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return { deployRoot, stableRoot, candidateRoot }
}

describe('m5-release manifests are evidence-derived', () => {
  it('records critical-package hashes and an artifact digest from the real install tree', () => {
    const { deployRoot, stableRoot } = fixture()
    const manifest = readManifest(deployRoot, 'stable')!
    expect(manifest.releaseId).toBe('stable-r1')
    expect(manifest.installRoot).toBe(realpathSync(stableRoot))
    expect(Object.keys(manifest.criticalPackages).sort()).toEqual([...CRITICAL].sort())
    expect(manifest.artifactDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.createdAt).toBeTruthy()
    expect(manifest.statePolicy).toEqual({ kind: 'shared-compatible' })
  })

  it('refuses to record a manifest when a critical package lib is missing', () => {
    const deployRoot = mkdtempSync(join(tmpdir(), 'dsh-m5-'))
    roots.push(deployRoot)
    mkdirSync(join(slotDir(deployRoot, 'broken'), 'install'), { recursive: true })
    expect(() => recordManifest(deployRoot, 'broken', { releaseId: 'x', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/missing critical package libs/)
  })
})

describe('m5-release slot validation and isolation', () => {
  it('accepts a complete slot', () => {
    const { deployRoot } = fixture()
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    expect(validateSlot(deployRoot, 'candidate').ok).toBe(true)
  })

  it('fails a slot whose critical lineage changed after recording (injection B)', () => {
    const { deployRoot, candidateRoot } = fixture()
    writeFileSync(join(candidateRoot, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'tampered\n')
    const validation = validateSlot(deployRoot, 'candidate')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('lineage mismatch')
  })

  it('fails a slot whose artifact digest no longer matches the installed bytes (P1-2)', async () => {
    const { deployRoot, candidateRoot } = fixture()
    writeFileSync(join(candidateRoot, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'tampered\n')
    // Also repair the critical hash so ONLY the artifact digest goes stale.
    const { createHash } = await import('node:crypto')
    const manifest = readManifest(deployRoot, 'candidate')!
    manifest.criticalPackages['@deepseek-ai/dsh-session'] = { digest: createHash('sha256').update('tampered\n').digest('hex'), lib: 'lib/index.js' }
    writeFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
    const validation = validateSlot(deployRoot, 'candidate')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('artifact digest does not match')
  })

  it('rejects an install root nested inside another slot (cross-slot isolation)', () => {
    const { deployRoot } = fixture({ nestedCandidate: true })
    const validation = validateSlot(deployRoot, 'candidate')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('escapes the slot')
  })
})

describe('m5-release atomic promotion', () => {
  it('promotes a validated candidate and records the rollback target without touching slots', () => {
    const { deployRoot } = fixture()
    const stableBefore = readFileSync(join(slotDir(deployRoot, 'stable'), RELEASE_MANIFEST), 'utf8')
    const candidateBefore = readFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), 'utf8')
    const result = promote(deployRoot, 'candidate', 'stable')
    expect(result.active).toBe('candidate')
    expect(result.previous).toBe('stable')
    expect(resolveActive(deployRoot)).toBe('candidate')
    expect(readFileSync(join(slotDir(deployRoot, 'stable'), RELEASE_MANIFEST), 'utf8')).toBe(stableBefore)
    expect(readFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), 'utf8')).toBe(candidateBefore)
    const meta = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { previous: { slot: string }; generation: number }
    expect(meta.previous.slot).toBe('stable')
    expect(meta.generation).toBe(1)
  })

  it('blocks an unregistered or tampered release (release authenticity anchor, P1-2)', () => {
    const { deployRoot } = fixture()
    // Tamper a provenance field only: slot bytes still self-consistent, but the
    // canonical manifest no longer matches the operator-approved hash.
    const manifest = readManifest(deployRoot, 'candidate')!
    manifest.sourceRevision = 'attacker-rev'
    writeFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/not registered or its manifest was tampered/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('injection A: an incomplete candidate (missing node_modules) blocks promotion and leaves the pointer', () => {
    const { deployRoot, candidateRoot } = fixture()
    rmSync(candidateRoot, { recursive: true, force: true })
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/promotion blocked/)
    expect(resolveActive(deployRoot)).toBeUndefined()
    expect(fs.existsSync(join(deployRoot, ACTIVE_POINTER))).toBe(false)
  })

  it('injection C: pre-switch validation failure keeps stable active', () => {
    const { deployRoot, candidateRoot } = fixture()
    promote(deployRoot, 'candidate', 'stable')
    writeFileSync(join(candidateRoot, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'broken\n')
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/promotion blocked/)
    expect(resolveActive(deployRoot)).toBe('candidate')
  })

  it('injection F: a state-migrating candidate is refused promotion', () => {
    const { deployRoot } = fixture({ migrating: true })
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/irreversible state migration/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('injection D: a pointer-switch failure leaves no half-promoted runtime', () => {
    const { deployRoot } = fixture()
    mkdirSync(join(deployRoot, ACTIVE_POINTER))
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/pointer switch failed/)
    expect(resolveActive(deployRoot)).toBeUndefined()
    expect(fs.readdirSync(deployRoot).filter(name => name.includes('staging'))).toHaveLength(0)
  })

  it('injection E: rollback restores the prior stable deterministically after a post-switch failure', () => {
    const { deployRoot, candidateRoot } = fixture()
    promote(deployRoot, 'candidate', 'stable')
    expect(resolveActive(deployRoot)).toBe('candidate')
    rmSync(join(candidateRoot, 'node_modules'), { recursive: true, force: true })
    const result = rollback(deployRoot)
    expect(result.active).toBe('stable')
    expect(resolveActive(deployRoot)).toBe('stable')
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
  })
})

describe('m5-release rebuild-free rollback', () => {
  it('rollback restores the prior slot without rebuild, reinstall, or slot modification', () => {
    const { deployRoot } = fixture()
    const stableManifestBefore = readFileSync(join(slotDir(deployRoot, 'stable'), RELEASE_MANIFEST), 'utf8')
    const candidateManifestBefore = readFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), 'utf8')
    promote(deployRoot, 'candidate', 'stable')
    const result = rollback(deployRoot)
    expect(result.active).toBe('stable')
    expect(result.releaseId).toBe('stable-r1')
    expect(readFileSync(join(slotDir(deployRoot, 'stable'), RELEASE_MANIFEST), 'utf8')).toBe(stableManifestBefore)
    expect(readFileSync(join(slotDir(deployRoot, 'candidate'), RELEASE_MANIFEST), 'utf8')).toBe(candidateManifestBefore)
  })

  it('refuses rollback when the recorded target is invalid (never a blind pointer move)', () => {
    const { deployRoot } = fixture()
    promote(deployRoot, 'candidate', 'stable')
    rmSync(slotDir(deployRoot, 'stable'), { recursive: true, force: true })
    expect(() => rollback(deployRoot)).toThrow(/rollback refused/)
    expect(resolveActive(deployRoot)).toBe('candidate')
  })

  it('rolls back without any recorded target bookkeeping drift', () => {
    const { deployRoot } = fixture()
    expect(() => rollback(deployRoot)).toThrow(/no previous active slot is recorded/)
  })

  it('P2-1: a self-referencing POINTER_META fails closed instead of silently no-opping', () => {
    const { deployRoot } = fixture()
    promote(deployRoot, 'candidate', 'stable')
    writeFileSync(join(deployRoot, POINTER_META), JSON.stringify({
      generation: 1, active: { slot: 'candidate', releaseId: 'candidate-r1' }, previous: { slot: 'candidate', releaseId: 'candidate-r1' },
    }))
    expect(() => rollback(deployRoot)).toThrow(/self-references the active slot/)
    expect(resolveActive(deployRoot)).toBe('candidate')
  })

  it('P1-3: stale metadata whose active slot no longer matches the pointer fails closed', () => {
    const { deployRoot } = fixture()
    promote(deployRoot, 'candidate', 'stable')
    writeFileSync(join(deployRoot, POINTER_META), JSON.stringify({
      generation: 2, active: { slot: 'ghost', releaseId: 'ghost' }, previous: { slot: 'stable', releaseId: 'stable-r1' },
    }))
    expect(() => rollback(deployRoot)).toThrow(/does not match the active pointer generation/)
    expect(resolveActive(deployRoot)).toBe('candidate')
  })
})

describe('m5-release canary surface', () => {
  it('installs the probe into the slot install root', () => {
    const { deployRoot, candidateRoot } = fixture()
    installCanaryProbe(deployRoot, 'candidate')
    expect(fs.existsSync(join(candidateRoot, '.m5-canary-probe.mjs'))).toBe(true)
  })

  it('reports structured problems instead of throwing when the slot cannot boot', () => {
    const { deployRoot } = fixture()
    const problems = runCanary(deployRoot, 'candidate', mkdtempSync(join(tmpdir(), 'dsh-m5-canary-')))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('CLI entry missing')
  })

  it('reports validation failures as canary problems', () => {
    const { deployRoot, candidateRoot } = fixture()
    rmSync(join(candidateRoot, 'node_modules', '@deepseek-ai', 'dsh-session'), { recursive: true, force: true })
    const problems = runCanary(deployRoot, 'candidate', mkdtempSync(join(tmpdir(), 'dsh-m5-canary-')))
    expect(problems.join(' ')).toContain('slot validation failed')
  })
})
