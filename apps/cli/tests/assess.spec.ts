import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAssess } from '../src/assess.ts'

/** Run {@link runAssess} against a throwaway profile under a temp DSH_HOME. */
async function withProfile(profile: string, body: (dir: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-assess-'))
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: `profile-${profile}`,
    version: '1.0.0',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# a valid patch list\n- insert:\n    - id: test\n      name: example\n')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await body(home)
  } finally {
    process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

afterEach(() => { delete process.env.DSH_HOME })

describe('runAssess', () => {
  it('builds a runtime identity for a present profile without writing to it', async () => {
    await withProfile('test', async (home) => {
      const report = await runAssess({ profile: 'test', port: 3080, json: false })
      expect(report.identity.schemaVersion).toBe('0.1.0')
      expect(report.identity.profile).toBe('test')
      expect(report.identity.profilePresent).toBe(true)
      expect(report.identity.bundleCount).toBe(1)
      expect(report.identity.profilePatchDigest).toMatch(/^[0-9a-f]{12}$/)
      expect(report.identity.profileDir).toBe(join(home, 'profiles', 'test'))
      expect(report.identity.dshVersion).toBeTruthy()
      const ids = report.checks.map(c => c.id)
      expect(ids).toContain('identity.complete')
      expect(ids).toContain('profile.patches')
      expect(report.schemaVersion).toBe('0.1.0')
      // The profile is present and its patch layer parses, so these never BLOCK.
      expect(report.checks.find(c => c.id === 'profile.patches')?.status).not.toBe('BLOCK')
      expect(report.checks.find(c => c.id === 'readiness.files')?.status).toBe('PASS')
    })
  })

  it('reports a missing profile directory as not present', async () => {
    const previous = process.env.DSH_HOME
    const home = mkdtempSync(join(tmpdir(), 'dsh-assess-missing-'))
    process.env.DSH_HOME = home
    try {
      const report = await runAssess({ profile: 'nope', port: 3080, json: true })
      expect(report.identity.profilePresent).toBe(false)
      expect(report.checks.find(c => c.id === 'identity.complete')?.status).toBe('WARN')
    } finally {
      process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })
})
