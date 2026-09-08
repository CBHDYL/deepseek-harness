/**
 * Fail-closed invariants of the M5 deploy supervisor scripts.
 *
 * These scripts are the live authority that starts :3080 from the M5 ACTIVE
 * SLOT and keeps the profile composition anchored to it. They live in
 * ~/.dsh-deploy/bin (not under node_modules), and they mirror the constants
 * and semantics of @deepseek-ai/dsh-root's scripts/m5-release.ts, whose
 * promote()/rollback() they front. The three pinned behaviors every boot and
 * promote/rollback depend on are: the resolver never falls back to another
 * runtime, the verifier never lets a global-NVM core lineage load, and the
 * watchdog re-anchors drift (a shell `dsh` re-linking the store to the
 * global install) within one interval.
 *
 * Fixtures mirror the real deploy-root layout (slots/<slot>/install with a
 * release-manifest.json and an active symlink into slots/) under a temp dir,
 * and every subprocess receives an explicit DSH_M5_DEPLOY_ROOT / DSH_HOME /
 * DSH_M5_NODE_BIN / HOME so nothing reads or writes the operator's real home.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, realpathSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const RESOLVER = join(SCRIPT_DIR, 'resolve-active-entry.mjs')
const VERIFIER = join(SCRIPT_DIR, 'verify-composition-anchor.mjs')
const WATCHDOG = join(SCRIPT_DIR, 'anchor-watchdog.sh')
const LAUNCHER = join(SCRIPT_DIR, 'dsh-m5-web-launch.sh')
const NODE_BIN = dirname(process.execPath)

const created: string[] = []

function run(bin: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
const nodeRun = (args: string[], env: Record<string, string> = {}) => run(process.execPath, args, env)
const zshRun = (args: string[], env: Record<string, string> = {}) => run('/bin/zsh', args, env)

interface Fixture {
  root: string
  deploy: string
  home: string
  fakeHome: string
  slot: string
  install: string
  entry: string
}

function releaseManifest(installRoot: string, releaseId = 'stage-candidate-1', statePolicyKind = 'preserve') {
  return {
    releaseId,
    version: '0.1.2-alpha.5',
    sourceRevision: 'a'.repeat(40),
    artifactDigest: 'b'.repeat(64),
    installRoot,
    statePolicy: { kind: statePolicyKind },
    criticalPackages: { '@deepseek-ai/dsh': { lib: 'lib/bin.js' } },
  }
}

function pointerMeta(slot = 'candidate', releaseId = 'stage-candidate-1') {
  return { generation: 1, active: { slot, releaseId }, previous: { slot: 'stable', releaseId: 'stable-1' } }
}

/** Build a valid deploy root + home that resolves cleanly; mutate per test. */
function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'm5-deploy-'))
  created.push(root)
  const deploy = join(root, 'deploy')
  const fakeHome = join(root, 'fakehome')
  const home = join(fakeHome, '.dsh')
  const slot = join(deploy, 'slots', 'candidate')
  const install = join(slot, 'install')

  mkdirSync(join(deploy, 'slots', 'stable'), { recursive: true })
  mkdirSync(install, { recursive: true })
  const dshLib = join(install, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(dshLib, { recursive: true })
  writeFileSync(join(dshLib, 'bin.js'), '#!/usr/bin/env node\n')
  // dsh/ already exists via dshLib's recursive mkdir above; add a second
  // slot-provided package so the verifier has a name to anchor.
  mkdirSync(join(install, 'node_modules', '@deepseek-ai', 'cordis'))

  writeFileSync(join(slot, 'release-manifest.json'), JSON.stringify(releaseManifest(install)) + '\n')
  writeFileSync(join(deploy, 'active-pointer.json'), JSON.stringify(pointerMeta()) + '\n')
  symlinkSync(slot, join(deploy, 'active'), 'dir')

  // The watchdog resolves its verifier + anchor through DEPLOY_ROOT/bin, so the
  // fixture mirrors the real layout. The resolver is deliberately omitted so
  // the launcher's missing-resolver fail-closed test stays exact.
  const bin = join(deploy, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const name of ['verify-composition-anchor.mjs', 'anchor-composition.sh']) {
    symlinkSync(join(SCRIPT_DIR, name), join(bin, name), 'file')
  }

  const store = join(home, 'profiles', 'node_modules', '@deepseek-ai')
  mkdirSync(store, { recursive: true })
  return { root, deploy, home, fakeHome, slot, install, entry: join(dshLib, 'bin.js') }
}

function plantGlobalLeak(fixture: Fixture, name = 'cordis'): string {
  const target = join(
    fixture.fakeHome, '.nvm', 'versions', 'node', 'v22.0.0', 'lib', 'node_modules',
    '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', name,
  )
  mkdirSync(target, { recursive: true })
  symlinkSync(target, join(fixture.home, 'profiles', 'node_modules', '@deepseek-ai', name), 'dir')
  return target
}

function verifierEnv(fixture: Fixture): Record<string, string> {
  // realpath the HOME: macOS /var/folders realpaths to /private/var/folders,
  // and the verifier compares realpath'd link targets against join(HOME, ...).
  return { DSH_M5_DEPLOY_ROOT: fixture.deploy, DSH_HOME: fixture.home, HOME: realpathSync(fixture.fakeHome) }
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolve-active-entry.mjs', () => {
  it('resolves the active slot runtime entry and prints its realpath', () => {
    const f = buildFixture()
    const r = nodeRun([RESOLVER, '--explain'], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe(realpathSync(f.entry))
    expect(r.stderr).toContain('activeSlot=candidate releaseId=stage-candidate-1')
  })

  it('refuses a missing deploy root (10) instead of falling back', () => {
    const f = buildFixture()
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: join(f.root, 'absent') })
    expect(r.status).toBe(10)
    expect(r.stderr).toContain('REFUSED')
  })

  it('refuses malformed pointer metadata (11)', () => {
    const f = buildFixture()
    writeFileSync(join(f.deploy, 'active-pointer.json'), JSON.stringify({ generation: 1, active: { slot: 'candidate' } }) + '\n')
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(11)
  })

  it('refuses an active pointer that escapes the slots directory (14)', () => {
    const f = buildFixture()
    const outside = join(f.deploy, 'outside')
    mkdirSync(outside)
    rmSync(join(f.deploy, 'active'))
    symlinkSync(outside, join(f.deploy, 'active'), 'dir')
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(14)
  })

  it('refuses pointer/meta disagreement (13)', () => {
    const f = buildFixture()
    writeFileSync(join(f.deploy, 'active-pointer.json'), JSON.stringify(pointerMeta('stable', 'stable-1')) + '\n')
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(13)
  })

  it('refuses a missing manifest (15)', () => {
    const f = buildFixture()
    rmSync(join(f.slot, 'release-manifest.json'))
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(15)
  })

  it('refuses an irreversible state migration (20)', () => {
    const f = buildFixture()
    writeFileSync(join(f.slot, 'release-manifest.json'), JSON.stringify(releaseManifest(f.install, 'stage-candidate-1', 'migrating')) + '\n')
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(20)
  })

  it('refuses a release identity mismatch between manifest and pointer (16)', () => {
    const f = buildFixture()
    writeFileSync(join(f.slot, 'release-manifest.json'), JSON.stringify(releaseManifest(f.install, 'other-release')) + '\n')
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(16)
  })

  it('refuses a missing runtime entry (18)', () => {
    const f = buildFixture()
    rmSync(f.entry)
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(18)
  })

  it('refuses a runtime entry that escapes the install root (19)', () => {
    const f = buildFixture()
    const outsideDsh = join(f.root, 'outside-dsh')
    mkdirSync(join(outsideDsh, 'lib'), { recursive: true })
    writeFileSync(join(outsideDsh, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
    const link = join(f.install, 'node_modules', '@deepseek-ai', 'dsh')
    rmSync(link, { recursive: true })
    symlinkSync(outsideDsh, link, 'dir')
    const r = nodeRun([RESOLVER], { DSH_M5_DEPLOY_ROOT: f.deploy })
    expect(r.status).toBe(19)
  })
})

describe('verify-composition-anchor.mjs', () => {
  it('passes a clean anchor (slot-provided names resolve into the slot)', () => {
    const f = buildFixture()
    symlinkSync(join(f.install, 'node_modules', '@deepseek-ai', 'cordis'), join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis'), 'dir')
    const r = nodeRun([VERIFIER], verifierEnv(f))
    expect(r.status).toBe(0)
  })

  it('allows a profile-owned extension the slot does not provide', () => {
    const f = buildFixture()
    const ext = join(f.fakeHome, 'elsewhere', 'my-plugin')
    mkdirSync(ext, { recursive: true })
    symlinkSync(ext, join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'my-plugin'), 'dir')
    const r = nodeRun([VERIFIER], verifierEnv(f))
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('1 profile-owned extensions')
  })

  it('refuses (30) a global-NVM core lineage reachable from the profile', () => {
    const f = buildFixture()
    plantGlobalLeak(f, 'cordis')
    const r = nodeRun([VERIFIER], verifierEnv(f))
    expect(r.status).toBe(30)
    expect(r.stderr).toContain('REFUSED')
    expect(r.stderr).toContain('GLOBAL NVM')
  })

  it('refuses (30) a slot-provided name anchored elsewhere', () => {
    const f = buildFixture()
    const elsewhere = join(f.fakeHome, 'elsewhere', 'cordis')
    mkdirSync(elsewhere, { recursive: true })
    symlinkSync(elsewhere, join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis'), 'dir')
    const r = nodeRun([VERIFIER], verifierEnv(f))
    expect(r.status).toBe(30)
    expect(r.stderr).toContain('anchored to a different slot')
  })
})

describe.skipIf(!existsSync('/bin/zsh'))('anchor-watchdog.sh', () => {
  it('re-anchors a planted global-NVM leak and exits 0', () => {
    const f = buildFixture()
    plantGlobalLeak(f, 'cordis')
    const env = { ...verifierEnv(f), DSH_M5_NODE_BIN: NODE_BIN }

    const before = nodeRun([VERIFIER], env)
    expect(before.status).toBe(30)

    const wd = zshRun([WATCHDOG], env)
    expect(wd.status).toBe(0)
    expect(wd.stdout).toContain('re-anchored; verifier OK')

    expect(readlinkSync(join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis')))
      .toContain(join('active', 'install', 'node_modules', '@deepseek-ai', 'cordis'))
    expect(nodeRun([VERIFIER], env).status).toBe(0)
  })

  it('is silent and mutates nothing when the anchor is already healthy', () => {
    const f = buildFixture()
    symlinkSync(join(f.install, 'node_modules', '@deepseek-ai', 'cordis'), join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis'), 'dir')
    const before = readlinkSync(join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis'))
    const wd = zshRun([WATCHDOG], { ...verifierEnv(f), DSH_M5_NODE_BIN: NODE_BIN })
    expect(wd.status).toBe(0)
    expect(wd.stdout).toBe('')
    expect(readlinkSync(join(f.home, 'profiles', 'node_modules', '@deepseek-ai', 'cordis'))).toBe(before)
  })
})

describe.skipIf(!existsSync('/bin/zsh'))('dsh-m5-web-launch.sh', () => {
  it('fails closed (70) when the resolver is missing instead of starting any runtime', () => {
    const f = buildFixture()
    const r = zshRun([LAUNCHER], { DSH_M5_DEPLOY_ROOT: f.deploy, DSH_HOME: f.home, DSH_M5_NODE_BIN: NODE_BIN })
    expect(r.status).toBe(70)
    expect(r.stdout).toContain('FATAL')
  })
})
