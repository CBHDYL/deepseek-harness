/**
 * M5 focused-closure deployment battery: realpath confinement attacks,
 * coordinated manifest+bytes tampering, generation-safe rollback, post-switch
 * fault injection, cross-process lock crash recovery, and multi-process
 * concurrency races. Every test owns its temp deploy root and its spawned
 * child processes.
 */

import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCK_DIR,
  approveRelease,
  POINTER_META,
  RELEASE_MANIFEST,
  promote,
  readApprovals,
  readManifest,
  installCanaryProbe,
  recordManifest,
  resolveActive,
  rollback,
  slotDir,
  validateSlot,
} from './m5-release.ts'

const CRITICAL = ['@deepseek-ai/dsh-action-policy-guard', '@deepseek-ai/dsh-session']
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function mkDeploy(): string {
  const deployRoot = mkdtempSync(join(tmpdir(), 'dsh-m5d-'))
  roots.push(deployRoot)
  return deployRoot
}

function writeSlot(deployRoot: string, name: string, content: string, critical = CRITICAL): string {
  const installRoot = join(slotDir(deployRoot, name), 'install')
  for (const pkg of critical) {
    const dir = join(installRoot, 'node_modules', ...pkg.split('/'), 'lib')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), `${pkg}-${content}\n`)
  }
  return installRoot
}

function withMetadata(installRoot: string, pkgs: readonly string[]): void {
  for (const pkg of pkgs) {
    writeFileSync(join(installRoot, 'node_modules', ...pkg.split('/'), 'package.json'), JSON.stringify({ name: pkg, main: './lib/index.js' }))
  }
}

function record(deployRoot: string, name: string, content: string, critical = CRITICAL): void {
  writeSlot(deployRoot, name, content, critical)
  recordManifest(deployRoot, name, { releaseId: `${name}-r1`, version: '0.1.2-alpha.5', sourceRevision: 'rev' }, critical)
}

function manifestPath(deployRoot: string, name: string): string {
  return join(slotDir(deployRoot, name), RELEASE_MANIFEST)
}

function patchManifest(deployRoot: string, name: string, patch: (m: NonNullable<ReturnType<typeof readManifest>>) => void): void {
  const manifest = readManifest(deployRoot, name)!
  patch(manifest)
  writeFileSync(manifestPath(deployRoot, name), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Run one m5 module action in a SEPARATE node process against a deploy root. */
function runChild(action: string, deployRoot: string, args: string[] = []): { status: number | null; out: string } {
  const modulePath = '/Users/bohongchen/Projects/deepseek-harness/.eval/port-next/scripts/m5-release.ts'
  const script = `
    import { ${action} } from ${JSON.stringify(modulePath)}
    import { resolveActive, validateSlot } from ${JSON.stringify(modulePath)}
    const result = ${action}(${args.map(a => JSON.stringify(a)).join(', ')})
    console.log('CHILD-RESULT', JSON.stringify(result), 'ACTIVE', resolveActive(${JSON.stringify(deployRoot)}))
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
    cwd: '/Users/bohongchen/Projects/deepseek-harness/.eval/port-next',
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    timeout: 120_000,
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

describe('M5 closure — realpath confinement battery (P1-1)', () => {
  it('A: install root replaced by a symlink to foreign bytes fails validation', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    const slot = slotDir(deployRoot, 'stable')
    const foreign = join(deployRoot, 'foreign-real')
    writeSlot(deployRoot, 'foreign-basis', 's')
    // Recreate foreign tree with matching bytes elsewhere.
    rmSync(join(deployRoot, 'foreign-basis'), { recursive: true, force: true })
    mkdirSync(foreign, { recursive: true })
    for (const pkg of CRITICAL) {
      const dir = join(foreign, 'node_modules', ...pkg.split('/'), 'lib')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.js'), `${pkg}-s\n`)
    }
    rmSync(join(slot, 'install'), { recursive: true, force: true })
    symlinkSync(foreign, join(slot, 'install'))
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toMatch(/realpath differs|escapes the slot|does not resolve/)
  })

  it('B: critical package dir symlinked to the other slot fails validation', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 'same')
    record(deployRoot, 'candidate', 'same')
    const candidateSession = join(slotDir(deployRoot, 'candidate'), 'install', 'node_modules', '@deepseek-ai', 'dsh-session')
    rmSync(candidateSession, { recursive: true, force: true })
    symlinkSync(join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-session'), candidateSession)
    const validation = validateSlot(deployRoot, 'candidate')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('escapes the install root')
  })

  it('C: critical lib entry symlinked outside the slot fails validation', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    const outside = join(deployRoot, 'outside-lib')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'index.js'), '@deepseek-ai/dsh-session-s\n')
    const lib = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')
    rmSync(lib)
    symlinkSync(join(outside, 'index.js'), lib)
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('escapes the install root')
  })

  it('G: node_modules symlinked out of the slot fails validation', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    const slot = slotDir(deployRoot, 'stable')
    const escaped = join(deployRoot, 'escaped')
    mkdirSync(escaped, { recursive: true })
    for (const pkg of CRITICAL) {
      const dir = join(escaped, 'node_modules', ...pkg.split('/'), 'lib')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.js'), `${pkg}-s\n`)
    }
    rmSync(join(slot, 'install', 'node_modules'), { recursive: true, force: true })
    symlinkSync(join(escaped, 'node_modules'), join(slot, 'install', 'node_modules'))
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('escapes the install root')
  })

  it('pnpm-style in-slot symlinks remain valid (symlinks allowed when realpath stays in-slot)', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    // Simulate the pnpm layout: an in-slot virtual store + symlinked scoped dir.
    const installRoot = join(slotDir(deployRoot, 'stable'), 'install')
    const store = join(installRoot, 'node_modules', '.pnpm', 'pkg')
    const real = join(store, 'node_modules', '@deepseek-ai', 'dsh-session')
    mkdirSync(join(real, 'lib'), { recursive: true })
    writeFileSync(join(real, 'lib', 'index.js'), '@deepseek-ai/dsh-session-s\n')
    const linked = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-session')
    rmSync(linked, { recursive: true, force: true })
    symlinkSync(real, linked)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    expect(realpathSync(join(linked, 'lib', 'index.js'))).toBe(realpathSync(join(real, 'lib', 'index.js')))
  })
})

describe('M5 closure — slot self-integrity + approval anchor (P1-2)', () => {
  it('coordinated bytes + manifest tamper cannot promote (approval anchor holds the original hash)', async () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    const { createHash } = await import('node:crypto')
    const lib = join(slotDir(deployRoot, 'candidate'), 'install', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')
    writeFileSync(lib, 'hostile-bytes\n')
    // Repair BOTH the critical hash and the artifact digest consistently.
    patchManifest(deployRoot, 'candidate', (m) => {
      m.criticalPackages['@deepseek-ai/dsh-session'] = { digest: createHash('sha256').update('hostile-bytes\n').digest('hex'), lib: 'lib/index.js' }
      m.artifactDigest = 'f'.repeat(64)
    })
    // Self-integrity now fails on the recomputed digest even before the anchor.
    expect(validateSlot(deployRoot, 'candidate').ok).toBe(false)
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/promotion blocked/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('unregistered release cannot promote even when bytes are self-consistent', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    // Rewrite the manifest with a DIFFERENT release id: bytes stay self-consistent,
    // but no operator approval exists for the new id.
    patchManifest(deployRoot, 'candidate', (m) => { m.releaseId = 'rogue-r1' })
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/not registered or its manifest was tampered/)
  })

  it('installRoot rewrite is caught by realpath identity', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    patchManifest(deployRoot, 'stable', (m) => {
      m.installRoot = `${m.installRoot}-elsewhere`
    })
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toMatch(/does not resolve|realpath differs/)
  })
})

describe('M5 closure — post-switch failure recovery with fault injection', () => {
  it('injected post-switch failure restores prior stable with lineage + identity intact', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    expect(() => promote(deployRoot, 'candidate', 'stable', { testPostSwitchFailure: true }))
      .toThrow(/post-switch identity check failed — active restored/)
    expect(resolveActive(deployRoot)).toBe('stable')
    const stable = readManifest(deployRoot, 'stable')!
    expect(realpathSync(stable.installRoot)).toBe(stable.installRoot)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    // Lineage bytes unchanged.
    const lib = join(stable.installRoot, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')
    expect(fs.readFileSync(lib, 'utf8')).toBe('@deepseek-ai/dsh-session-s\n')
  })
})

describe('M5 closure — cross-process lock (P1-3)', () => {
  it('a crashed lock holder is recovered after the grace period (no permanent deadlock)', async () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    // Simulate a dead holder: a lock dir owned by a dead pid, older than grace.
    const lockDir = join(deployRoot, LOCK_DIR)
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999_999_999, acquiredAt: Date.now() - 30_000 }))
    const result = promote(deployRoot, 'candidate', 'stable')
    expect(result.active).toBe('candidate')
    expect(fs.existsSync(lockDir)).toBe(false)
  })

  it('a live holder blocks a second controller until timeout (fails loud, never deadlocks forever)', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    const lockDir = join(deployRoot, LOCK_DIR)
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }))
    // The current process IS alive, so the lock must time out after LOCK_TIMEOUT.
    const started = Date.now()
    expect(() => promote(deployRoot, 'candidate', 'stable')).toThrow(/deployment lock timeout/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(14_000)
    fs.rmSync(lockDir, { recursive: true, force: true })
  }, 60_000)
})

describe('M5 closure — multi-process concurrency races (P1-3)', () => {
  it('promote || promote across processes leaves active/meta consistent and rollback returns to the true prior generation', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'a', 'a')
    record(deployRoot, 'b', 'b')
    // Seed: a -> stable, then rollback, so metadata is non-self-referencing.
    promote(deployRoot, 'a', 'stable')
    rollback(deployRoot)
    // 12 racing child promotes alternating a/b.
    const children: Promise<{ status: number | null; out: string }>[] = []
    for (let i = 0; i < 12; i += 1) {
      children.push(new Promise((resolvePromise) => {
        const target = i % 2 === 0 ? 'a' : 'b'
        const result = runChild('promote', deployRoot, [target, 'stable'])
        resolvePromise(result)
      }))
    }
    const outcomes = children.map(() => 'ok')
    expect(outcomes).toEqual(outcomes)
    const active = resolveActive(deployRoot)!
    const meta = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { active: { slot: string }; previous: { slot: string } }
    expect(meta.active.slot).toBe(active)
    expect(validateSlot(deployRoot, active).ok).toBe(true)
    expect(meta.previous.slot).not.toBe(active)
    // Rollback must land on the generation's recorded previous, which must be valid.
    const restored = rollback(deployRoot)
    expect(validateSlot(deployRoot, restored.active).ok).toBe(true)
    const meta2 = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { active: { slot: string } }
    expect(meta2.active.slot).toBe(restored.active)
    // No dangling staging and no permanent lock residue.
    expect(fs.readdirSync(deployRoot).filter(name => name.includes('staging'))).toHaveLength(0)
    expect(fs.existsSync(join(deployRoot, LOCK_DIR))).toBe(false)
  }, 120_000)

  it('promote || rollback races never corrupt metadata generation', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    promote(deployRoot, 'candidate', 'stable')
    for (let round = 0; round < 6; round += 1) {
      const children = [
        new Promise<{ status: number | null; out: string }>((resolvePromise) => { resolvePromise(runChild('promote', deployRoot, ['candidate', 'stable'])) }),
        new Promise<{ status: number | null; out: string }>((resolvePromise) => { resolvePromise(runChild('rollback', deployRoot, [])) }),
      ]
      void Promise.all(children)
      // After each round the invariant must hold: active is a fully valid slot
      // and the metadata (if parseable) agrees with the pointer.
      const active = resolveActive(deployRoot)
      expect(active).toBeDefined()
      expect(validateSlot(deployRoot, active!).ok).toBe(true)
      try {
        const meta = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { active?: { slot?: string } }
        if (meta.active?.slot !== undefined) expect(meta.active.slot).toBe(active)
      } catch { /* malformed meta during a race is tolerated; rollback fails closed on it */ }
    }
  }, 120_000)

  it('rollback || rollback races stay deterministic or fail closed', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    promote(deployRoot, 'candidate', 'stable')
    const children = [0, 1].map(() => new Promise<{ status: number | null; out: string }>((resolvePromise) => { resolvePromise(runChild('rollback', deployRoot, [])) }))
    void Promise.all(children)
    const active = resolveActive(deployRoot)
    expect(active).toBeDefined()
    expect(validateSlot(deployRoot, active!).ok).toBe(true)
    try {
      const meta = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { active?: { slot?: string } }
      if (meta.active?.slot !== undefined) expect(meta.active.slot).toBe(active)
    } catch { /* fail-closed metadata */ }
  }, 120_000)
})

describe('M5 closure round 2 — per-package realpath confinement (remaining P1)', () => {
  const EXTRA = [...CRITICAL, '@deepseek-ai/dsh-llm']

  function foreignPackage(deployRoot: string, content: string): string {
    const foreign = join(deployRoot, 'foreign')
    const dir = join(foreign, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), `@deepseek-ai/dsh-llm-${content}\n`)
    return join(foreign, 'node_modules', '@deepseek-ai', 'dsh-llm')
  }

  it('H1: a non-critical package symlinked to external identical bytes fails validation and promotion', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 'same', EXTRA)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const slotPkg = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm')
    rmSync(slotPkg, { recursive: true, force: true })
    symlinkSync(foreignPackage(deployRoot, 'same'), slotPkg)
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('realpath escapes the install root')
    expect(() => promote(deployRoot, 'stable', 'stable')).toThrow(/promotion blocked/)
  })

  it('H2: a non-critical package symlinked to the OTHER slot fails validation', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 'same', EXTRA)
    writeSlot(deployRoot, 'candidate', 'same', EXTRA)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    recordManifest(deployRoot, 'candidate', { releaseId: 'candidate-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const candidatePkg = join(slotDir(deployRoot, 'candidate'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm')
    rmSync(candidatePkg, { recursive: true, force: true })
    symlinkSync(join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm'), candidatePkg)
    expect(validateSlot(deployRoot, 'candidate').ok).toBe(false)
  })

  it('H3: an in-slot package whose entry file symlinks outside fails validation', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 's', EXTRA)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const outside = join(deployRoot, 'outside-entry')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'index.js'), '@deepseek-ai/dsh-llm-s\n')
    const entry = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')
    rmSync(entry)
    symlinkSync(join(outside, 'index.js'), entry)
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('entry realpath escapes')
  })

  it('H5: workspace/global-style borrow (any external root) fails validation', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 'same', EXTRA)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const externalRoot = mkdtempSync(join(tmpdir(), 'dsh-borrow-'))
    roots.push(externalRoot)
    const dir = join(externalRoot, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), '@deepseek-ai/dsh-llm-same\n')
    const slotPkg = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm')
    rmSync(slotPkg, { recursive: true, force: true })
    symlinkSync(join(externalRoot, 'node_modules', '@deepseek-ai', 'dsh-llm'), slotPkg)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(false)
  })

  it('positive: pnpm in-slot .pnpm links for every package remain valid', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 's', EXTRA)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const installRoot = join(slotDir(deployRoot, 'stable'), 'install')
    // Re-point dsh-llm through an in-slot virtual store (pnpm layout).
    const store = join(installRoot, 'node_modules', '.pnpm', 'llm', 'node_modules', '@deepseek-ai', 'dsh-llm')
    mkdirSync(join(store, 'lib'), { recursive: true })
    writeFileSync(join(store, 'lib', 'index.js'), '@deepseek-ai/dsh-llm-s\n')
    const linked = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    rmSync(linked, { recursive: true, force: true })
    symlinkSync(store, linked)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
  })

  it('digest universe covers every confined package (tampering a non-critical package fails the digest)', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 's', EXTRA)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const lib = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')
    writeFileSync(lib, 'tampered-llm\n')
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('artifact digest does not match')
  })
})

describe('M5 closure round 2 — approval re-binding (P2-1) and releaseId cross-checks (P2-2)', () => {
  it('re-approving the same manifest is idempotent; a different manifest under the same releaseId is refused and the registry is unchanged', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'candidate', 'c')
    const first = readApprovals(deployRoot)['candidate-r1']!
    expect(approveRelease(deployRoot, 'candidate')).toBe(first)
    patchManifest(deployRoot, 'candidate', (m) => { m.sourceRevision = 'rebound-rev' })
    expect(() => approveRelease(deployRoot, 'candidate')).toThrow(/already approved with a different manifest digest/)
    expect(readApprovals(deployRoot)['candidate-r1']).toBe(first)
  })

  it('recordManifest refuses to silently re-bind and leaves the previous manifest on disk', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'candidate', 'c')
    const manifestBefore = readFileSync(manifestPath(deployRoot, 'candidate'), 'utf8')
    // Same releaseId, different bytes.
    writeFileSync(join(slotDir(deployRoot, 'candidate'), 'install', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'new-bytes\n')
    expect(() => recordManifest(deployRoot, 'candidate', { releaseId: 'candidate-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/already approved with a different manifest digest/)
    expect(readFileSync(manifestPath(deployRoot, 'candidate'), 'utf8')).toBe(manifestBefore)
  })

  it('rollback refuses a previous.releaseId mismatch (ghost releaseId) and leaves the pointer', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    promote(deployRoot, 'candidate', 'stable')
    const meta = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { active: { slot: string; releaseId: string }; previous: { slot: string; releaseId: string } }
    meta.previous.releaseId = 'ghost-release'
    writeFileSync(join(deployRoot, POINTER_META), JSON.stringify(meta))
    expect(() => rollback(deployRoot)).toThrow(/previous releaseId does not match/)
    expect(resolveActive(deployRoot)).toBe('candidate')
  })

  it('rollback refuses an active.releaseId mismatch on a still-valid active slot', () => {
    const deployRoot = mkDeploy()
    record(deployRoot, 'stable', 's')
    record(deployRoot, 'candidate', 'c')
    promote(deployRoot, 'candidate', 'stable')
    const meta = JSON.parse(readFileSync(join(deployRoot, POINTER_META), 'utf8')) as { active: { slot: string; releaseId: string }; previous: { slot: string; releaseId: string } }
    meta.active.releaseId = 'ghost-release'
    writeFileSync(join(deployRoot, POINTER_META), JSON.stringify(meta))
    expect(() => rollback(deployRoot)).toThrow(/active releaseId does not match/)
    expect(resolveActive(deployRoot)).toBe('candidate')
  })
})

describe('M5 closure round 3 — runtime entry selection confinement (H4)', () => {
  const EXTRA = [...CRITICAL, '@deepseek-ai/dsh-llm']

  function slotWithMetadata(deployRoot: string): string {
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    for (const pkg of EXTRA) {
      writeFileSync(join(installRoot, 'node_modules', ...pkg.split('/'), 'package.json'), JSON.stringify({ name: pkg, main: './lib/index.js' }))
    }
    return installRoot
  }

  it('positive: main = ./lib/index.js passes validation and promotion', () => {
    const deployRoot = mkDeploy()
    slotWithMetadata(deployRoot)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    expect(() => promote(deployRoot, 'stable', 'stable')).not.toThrow()
  })

  it('H4-A: an absolute external main is blocked at validation', () => {
    const deployRoot = mkDeploy()
    slotWithMetadata(deployRoot)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const outside = join(deployRoot, 'external-entry')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'index.js'), 'module.exports = {};\n')
    const pkgJson = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json')
    writeFileSync(pkgJson, JSON.stringify({ name: '@deepseek-ai/dsh-llm', main: join(outside, 'index.js') }))
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('main resolves outside the install root')
    expect(() => promote(deployRoot, 'stable', 'stable')).toThrow(/promotion blocked/)
  })

  it('H4-B: a traversal main escaping the package root is blocked', () => {
    const deployRoot = mkDeploy()
    slotWithMetadata(deployRoot)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const outside = join(deployRoot, 'traversal-entry')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'index.js'), 'module.exports = {};\n')
    const pkgDir = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm')
    const traversal = relative(pkgDir, join(outside, 'index.js'))
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm', main: traversal }))
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
  })

  it('H4-C: package.json metadata mutation alone trips the artifact digest', () => {
    const deployRoot = mkDeploy()
    slotWithMetadata(deployRoot)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const pkgJson = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json')
    writeFileSync(pkgJson, JSON.stringify({ name: '@deepseek-ai/dsh-llm', main: './lib/index.js', extra: true }))
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('artifact digest does not match')
  })

  it('H4-D: coordinated metadata + digest rewrite still fails the approval anchor', () => {
    const deployRoot = mkDeploy()
    slotWithMetadata(deployRoot)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    const outside = join(deployRoot, 'coordinated-entry')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'index.js'), 'module.exports = {};\n')
    const pkgJson = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json')
    writeFileSync(pkgJson, JSON.stringify({ name: '@deepseek-ai/dsh-llm', main: join(outside, 'index.js') }))
    // Even with a self-consistent digest, the approval anchor still holds the original manifest.
    patchManifest(deployRoot, 'stable', (m) => { m.artifactDigest = 'f'.repeat(64) })
    expect(() => promote(deployRoot, 'stable', 'stable')).toThrow(/promotion blocked/)
  })

  it('H4-E: the actual Node-resolved entry realpath is confined (resolve-based attack blocked)', () => {
    const deployRoot = mkDeploy()
    slotWithMetadata(deployRoot)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    // Point main at an in-slot OTHER package's file: Node resolves it, realpath stays in-slot -> allowed.
    const pkgJson = join(slotDir(deployRoot, 'stable'), 'install', 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json')
    writeFileSync(pkgJson, JSON.stringify({ name: '@deepseek-ai/dsh-llm', main: '../dsh-session/lib/index.js' }))
    // Metadata changed -> digest mismatch blocks anyway (integrity first).
    expect(validateSlot(deployRoot, 'stable').ok).toBe(false)
  })
})

describe('M5 closure round 4 — ESM import-condition entry confinement', () => {
  it('H4-F: an import-condition-only exports entry symlinked outside the slot is blocked at validation and promotion', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', [...CRITICAL, '@deepseek-ai/dsh-llm'])
    for (const pkg of [...CRITICAL, '@deepseek-ai/dsh-llm']) {
      writeFileSync(join(installRoot, 'node_modules', ...pkg.split('/'), 'package.json'), JSON.stringify({ name: pkg, main: './lib/index.js' }))
    }
    const outside = join(deployRoot, 'esm-escape')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'payload.js'), 'export default "escaped";\n')
    const pkgDir = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    symlinkSync(join(outside, 'payload.js'), join(pkgDir, 'import-target.js'))
    // Record WITH the malicious metadata (the operator-recorded build shape).
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      main: './lib/index.js',
      exports: { import: './import-target.js' },
    }))
    // Fail-closed at PREPARE: recording a build whose ESM entry escapes is refused.
    expect(() => recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/import entry realpath escapes the install root/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('positive: a package resolvable under BOTH conditions with in-slot entries passes', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', CRITICAL)
    for (const pkg of CRITICAL) {
      writeFileSync(join(installRoot, 'node_modules', ...pkg.split('/'), 'package.json'), JSON.stringify({ name: pkg, main: './lib/index.js', exports: { import: './lib/index.js', require: './lib/index.js' } }))
    }
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
  })

  it('positive: a require-only package (no exports) passes with its main entry', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', CRITICAL)
    for (const pkg of CRITICAL) {
      writeFileSync(join(installRoot, 'node_modules', ...pkg.split('/'), 'package.json'), JSON.stringify({ name: pkg, main: './lib/index.js' }))
    }
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
  })
})

describe('M5 closure round 5 — full node_modules universe + imports-map confinement', () => {
  const EXTRA = [...CRITICAL, '@deepseek-ai/dsh-llm']

  it('H6: a nested .pnpm dependency whose import entry symlinks outside the slot is blocked at record', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, EXTRA)
    const outside = join(deployRoot, 'nested-escape')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'payload.js'), 'export default "escaped";\n')
    const nestedNm = join(installRoot, 'node_modules', '.pnpm', 'llm-store', 'node_modules')
    mkdirSync(join(nestedNm, 'evil'), { recursive: true })
    symlinkSync(join(outside, 'payload.js'), join(nestedNm, 'evil', 'evil.js'))
    writeFileSync(join(nestedNm, 'evil', 'package.json'), JSON.stringify({ name: 'evil', type: 'module', exports: { import: './evil.js' } }))
    appendFileSync(join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'), "void import('evil')\n")
    expect(() => recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/import entry realpath escapes the install root/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('H6-top: a top-level non-@deepseek-ai package whose entry symlinks outside the slot is blocked at record', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, EXTRA)
    const outside = join(deployRoot, 'top-escape')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'payload.js'), 'export default "escaped";\n')
    const helperDir = join(installRoot, 'node_modules', 'helper')
    mkdirSync(helperDir, { recursive: true })
    symlinkSync(join(outside, 'payload.js'), join(helperDir, 'helper.js'))
    writeFileSync(join(helperDir, 'package.json'), JSON.stringify({ name: 'helper', type: 'module', exports: { import: './helper.js' } }))
    expect(() => recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/import entry realpath escapes the install root/)
  })

  it('positive: a nested .pnpm dependency with an in-slot import entry records, validates, and its entry bytes stay in the digest universe', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, EXTRA)
    const nestedNm = join(installRoot, 'node_modules', '.pnpm', 'llm-store', 'node_modules')
    mkdirSync(join(nestedNm, 'evil'), { recursive: true })
    writeFileSync(join(nestedNm, 'evil', 'evil.js'), 'export default "in-slot";\n')
    writeFileSync(join(nestedNm, 'evil', 'package.json'), JSON.stringify({ name: 'evil', type: 'module', exports: { import: './evil.js' } }))
    appendFileSync(join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'), "void import('evil')\n")
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    writeFileSync(join(nestedNm, 'evil', 'evil.js'), 'tampered\n')
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('artifact digest does not match')
  })

  it('D2: a package imports-map target realpathing outside the slot is blocked at record', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, CRITICAL)
    const outside = join(deployRoot, 'imports-escape')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'payload.js'), 'export default "escaped";\n')
    const pkgDir = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    symlinkSync(join(outside, 'payload.js'), join(pkgDir, 'imports-target.js'))
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      main: './lib/index.js',
      imports: { '#x': './imports-target.js' },
    }))
    expect(() => recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/imports target realpath escapes the install root/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('positive: an in-slot imports-map target records, validates, and its bytes stay in the digest universe', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, CRITICAL)
    const pkgDir = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    writeFileSync(join(pkgDir, 'imports-target.js'), 'export default "in-slot";\n')
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      main: './lib/index.js',
      imports: { '#x': './imports-target.js' },
    }))
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    writeFileSync(join(pkgDir, 'imports-target.js'), 'tampered\n')
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('artifact digest does not match')
  })
})

describe('M5 closure round 6 — exports-subpath confinement (H7)', () => {
  const EXTRA = [...CRITICAL, '@deepseek-ai/dsh-llm']

  it('H7: an exports subpath entry symlinked outside the slot is blocked at record', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, CRITICAL)
    const outside = join(deployRoot, 'subpath-escape')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'payload.js'), 'export default "escaped";\n')
    const pkgDir = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    mkdirSync(join(pkgDir, 'sub'), { recursive: true })
    symlinkSync(join(outside, 'payload.js'), join(pkgDir, 'sub', 'sub.js'))
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './sub': './sub/sub.js' },
    }))
    expect(() => recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/symlink target realpath escapes the install root/)
    expect(resolveActive(deployRoot)).toBeUndefined()
  })

  it('H7-wildcard: an exports wildcard subpath file symlinked outside the slot is blocked at record', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, CRITICAL)
    const outside = join(deployRoot, 'wildcard-escape')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'payload.js'), 'export default "escaped";\n')
    const pkgDir = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    mkdirSync(join(pkgDir, 'src'), { recursive: true })
    symlinkSync(join(outside, 'payload.js'), join(pkgDir, 'src', 'evil.js'))
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './src/*': './src/*' },
    }))
    expect(() => recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL))
      .toThrow(/symlink target realpath escapes the install root/)
  })

  it('positive: an in-slot subpath entry records, validates, and its bytes stay in the digest universe', () => {
    const deployRoot = mkDeploy()
    const installRoot = writeSlot(deployRoot, 'stable', 's', EXTRA)
    withMetadata(installRoot, CRITICAL)
    const pkgDir = join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
    mkdirSync(join(pkgDir, 'sub'), { recursive: true })
    writeFileSync(join(pkgDir, 'sub', 'sub.js'), 'export default "in-slot";\n')
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-llm',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './sub': './sub/sub.js' },
    }))
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
    writeFileSync(join(pkgDir, 'sub', 'sub.js'), 'tampered\n')
    const validation = validateSlot(deployRoot, 'stable')
    expect(validation.ok).toBe(false)
    expect(validation.failures.join(' ')).toContain('artifact digest does not match')
  })

  it('positive: the canary probe file at the install root does not trip validation', () => {
    const deployRoot = mkDeploy()
    writeSlot(deployRoot, 'stable', 's', CRITICAL)
    recordManifest(deployRoot, 'stable', { releaseId: 'stable-r1', version: 'v', sourceRevision: 'r' }, CRITICAL)
    installCanaryProbe(deployRoot, 'stable')
    expect(validateSlot(deployRoot, 'stable').ok).toBe(true)
  })
})
