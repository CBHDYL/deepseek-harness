import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { declaredSourceRevision, restoreManifest, stampSourceRevision } from './source-revision.ts'

const REVISION = '56281b8d56898fc525adb8831508ee1144fd1de1'

const directories: string[] = []

function memberDirectory(manifest: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-source-revision-'))
  directories.push(directory)
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  return directory
}

function readManifest(directory: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('source revision stamping', () => {
  it('records the packing commit under the manifest dsh block', () => {
    const directory = memberDirectory({ name: '@deepseek-ai/dsh', version: '0.1.2-alpha.3' })

    stampSourceRevision(directory, REVISION)

    expect(declaredSourceRevision(readManifest(directory))).toBe(REVISION)
  })

  it('keeps the member existing dsh declarations', () => {
    const directory = memberDirectory({
      name: '@deepseek-ai/dsh',
      version: '0.1.2-alpha.3',
      dsh: { configTrees: [{ mount: 'config/agent-presets' }] },
    })

    stampSourceRevision(directory, REVISION)

    const dsh = readManifest(directory)['dsh'] as Record<string, unknown>
    expect(dsh['configTrees']).toEqual([{ mount: 'config/agent-presets' }])
    expect(dsh['sourceRevision']).toBe(REVISION)
  })

  it('restores the checked-in bytes exactly', () => {
    const directory = memberDirectory({ name: '@deepseek-ai/dsh', version: '0.1.2-alpha.3' })
    const before = readFileSync(join(directory, 'package.json'), 'utf8')

    const original = stampSourceRevision(directory, REVISION)
    restoreManifest(directory, original)

    expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe(before)
    expect(declaredSourceRevision(readManifest(directory))).toBeUndefined()
  })

  it('reads no revision from an unstamped or malformed manifest', () => {
    expect(declaredSourceRevision({ version: '1.0.0' })).toBeUndefined()
    expect(declaredSourceRevision({ dsh: { sourceRevision: 'HEAD' } })).toBeUndefined()
    expect(declaredSourceRevision({ dsh: { sourceRevision: '56281b8' } })).toBeUndefined()
    expect(declaredSourceRevision(null)).toBeUndefined()
  })
})
