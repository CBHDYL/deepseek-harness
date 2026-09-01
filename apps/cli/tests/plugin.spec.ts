import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { injectWorkspaceRootFlag, isWorkspaceRootProfile } from '../src/plugin.ts'

function tempProfile(workspace?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-'))
  mkdirSync(join(dir, 'profiles', 'web'), { recursive: true })
  if (workspace !== undefined) writeFileSync(join(dir, 'profiles', 'web', 'pnpm-workspace.yaml'), workspace)
  return join(dir, 'profiles', 'web')
}

describe('isWorkspaceRootProfile', () => {
  it('detects a profile-template workspace root (packages: [.])', () => {
    const dir = tempProfile('packages:\n  - .\n\nnodeLinker: hoisted\n')
    expect(isWorkspaceRootProfile(dir)).toBe(true)
    rmSync(dirname(dirname(dir)), { recursive: true, force: true })
  })

  it('returns false for a profile without a packages workspace list', () => {
    const dir = tempProfile('nodeLinker: hoisted\n')
    expect(isWorkspaceRootProfile(dir)).toBe(false)
    rmSync(dirname(dirname(dir)), { recursive: true, force: true })
  })
})

describe('injectWorkspaceRootFlag', () => {
  it('appends -w for add on a workspace-root profile', () => {
    const dir = tempProfile('packages:\n  - .\n')
    expect(injectWorkspaceRootFlag(['add', '@x/y@1.0.0'], dir)).toEqual(['add', '@x/y@1.0.0', '-w'])
    rmSync(dirname(dirname(dir)), { recursive: true, force: true })
  })

  it('does not inject -w for a read-only command (why) or a non-workspace profile', () => {
    const ws = tempProfile('packages:\n  - .\n')
    expect(injectWorkspaceRootFlag(['why', '@x/y'], ws)).toEqual(['why', '@x/y'])
    rmSync(dirname(dirname(ws)), { recursive: true, force: true })
    const plain = tempProfile('nodeLinker: hoisted\n')
    expect(injectWorkspaceRootFlag(['add', '@x/y'], plain)).toEqual(['add', '@x/y'])
    rmSync(dirname(dirname(plain)), { recursive: true, force: true })
  })

  it('respects an explicit -w', () => {
    const dir = tempProfile('packages:\n  - .\n')
    expect(injectWorkspaceRootFlag(['add', '-w', '@x/y'], dir)).toEqual(['add', '-w', '@x/y'])
    rmSync(dirname(dirname(dir)), { recursive: true, force: true })
  })
})
