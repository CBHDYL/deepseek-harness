import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkCriticalPackage,
  checkCriticalResolutions,
  expectedCoreLineage,
  resolutionsAcceptable,
  resolverFrom,
  type ManifestResolver,
} from './critical-resolution.ts'

const CANDIDATE = '56281b8d56898fc525adb8831508ee1144fd1de1'
const OTHER = 'dd6322d60aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const VERSION = '0.1.2-alpha.3'
const TOOLS = '@deepseek-ai/dsh-tools'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Write a manifest and return its path. */
function manifest(directory: string, body: Record<string, unknown>): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'package.json')
  writeFileSync(path, `${JSON.stringify(body, undefined, 2)}\n`)
  return path
}

/**
 * Build an installation whose core package nests its own dependency copies,
 * mirroring how the published `dsh` artifact carries its whole set.
 */
function installation(options: {
  readonly coreRevision?: string | undefined
  readonly nested?: { readonly version: string; readonly revision?: string | undefined } | undefined
  readonly pluginPin?: string | undefined
}): { coreManifest: string; resolve: ManifestResolver } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-resolution-'))
  roots.push(root)

  const coreRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const coreManifest = manifest(coreRoot, {
    name: '@deepseek-ai/dsh',
    version: VERSION,
    ...(options.coreRevision === undefined ? {} : { dsh: { sourceRevision: options.coreRevision } }),
  })
  writeFileSync(join(coreRoot, 'bin.js'), '\n')

  if (options.nested !== undefined) {
    manifest(join(coreRoot, 'node_modules', '@deepseek-ai', 'dsh-tools'), {
      name: TOOLS,
      version: options.nested.version,
      ...(options.nested.revision === undefined ? {} : { dsh: { sourceRevision: options.nested.revision } }),
    })
  }
  if (options.pluginPin !== undefined) {
    manifest(join(root, 'node_modules', '@deepseek-ai', 'dsh-tools'), { name: TOOLS, version: options.pluginPin })
  }

  return { coreManifest, resolve: resolverFrom(join(coreRoot, 'bin.js')) }
}

describe('critical dependency resolution', () => {
  it('accepts a core copy on the candidate lineage', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: VERSION, revision: CANDIDATE },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(result.resolvedSourceRevision).toBe(CANDIDATE)
    expect(resolutionsAcceptable([result])).toBe(true)
  })

  it('rejects a core copy from an older version lineage', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: '0.1.1-rc.2', revision: OTHER },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MISMATCH')
    expect(result.domain).toBe('core-runtime')
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  // The B1 property applied to dependencies: equal versions are not equal code.
  it('rejects a core copy of the same version packed from a different source', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: VERSION, revision: OTHER },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MISMATCH')
    expect(result.detail).toContain('same version')
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  it('fails an unproven core lineage exactly like a wrong one', () => {
    const unstampedCopy = installation({ coreRevision: CANDIDATE, nested: { version: VERSION } })
    const unstampedCore = installation({ nested: { version: VERSION, revision: CANDIDATE } })

    for (const { coreManifest, resolve } of [unstampedCopy, unstampedCore]) {
      const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))
      expect(result.status).toBe('UNKNOWN')
      expect(resolutionsAcceptable([result])).toBe(false)
    }
  })

  it('reports an unresolvable critical package as UNKNOWN rather than passing it', () => {
    const { coreManifest } = installation({ coreRevision: CANDIDATE })
    // Own the resolver rather than reaching for the ambient installation: this
    // spec runs inside a workspace where the real package resolves.
    const missing: ManifestResolver = (specifier) => {
      throw new Error(`Cannot find module '${specifier}'`)
    }

    const result = checkCriticalPackage(TOOLS, missing, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('UNKNOWN')
    expect(result.resolvedPath).toBeUndefined()
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  it('accepts a plugin-private compatibility pin without a lineage requirement', () => {
    const { coreManifest } = installation({
      coreRevision: CANDIDATE,
      nested: { version: VERSION, revision: CANDIDATE },
      pluginPin: '0.1.1-rc.2',
    })
    const expected = expectedCoreLineage(coreManifest)
    // Resolve as the plugin subtree would: the outer copy, not the core's.
    const pluginResolve: ManifestResolver = () => join(
      coreManifest.slice(0, coreManifest.lastIndexOf('/node_modules/@deepseek-ai/dsh')),
      'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json',
    )

    const result = checkCriticalPackage(TOOLS, pluginResolve, expected)

    expect(result.status).toBe('ALLOWED_COMPATIBILITY')
    expect(result.domain).toBe('plugin-private')
    expect(result.resolvedVersion).toBe('0.1.1-rc.2')
    expect(resolutionsAcceptable([result])).toBe(true)
  })

  // False-positive guard: a legitimate outer pin must not make the core RED.
  it('does not let a plugin-private pin shadow the core runtime', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: VERSION, revision: CANDIDATE },
      pluginPin: '0.1.1-rc.2',
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(result.resolvedVersion).toBe(VERSION)
  })

  it('checks every critical package and fails the set on one bad core copy', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: '0.1.1-rc.2', revision: OTHER },
    })

    const results = checkCriticalResolutions(resolve, expectedCoreLineage(coreManifest), [TOOLS])

    expect(results).toHaveLength(1)
    expect(resolutionsAcceptable(results)).toBe(false)
  })
})
