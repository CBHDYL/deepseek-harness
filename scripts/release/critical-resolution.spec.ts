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
  subprocessResolver,
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

/** A child environment with every module-loader hook removed. */
function scrubbedEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  return environment
}

/** A manifest for a member package at one version and optionally one revision. */
function member(version: string, revision?: string): Record<string, unknown> {
  return { name: TOOLS, version, ...(revision === undefined ? {} : { dsh: { sourceRevision: revision } }) }
}

/**
 * An install root whose core package sits in its own `node_modules` scope,
 * mirroring the layouts the checker meets: global installs nest the whole
 * dependency set inside the core package, the packed-install consumer hoists
 * every member beside the core, and a broken install can let the core's walk
 * ascend to an ancestor level above the install.
 */
function installation(options: {
  readonly coreRevision?: string | undefined
  /** Extra path depth under the install root, placing the core deeper. */
  readonly coreSuffix?: string | undefined
  /** The core package's own nested copy, as a global install would have it. */
  readonly nested?: { readonly version: string; readonly revision?: string | undefined } | undefined
  /** A copy hoisted beside the core in the same node_modules level. */
  readonly hoisted?: { readonly version: string; readonly revision?: string | undefined } | undefined
  /** A copy at an ancestor node_modules level above the core's install. */
  readonly ancestor?: { readonly version: string; readonly revision?: string | undefined } | undefined
  /** A copy inside a sibling plugin's own node_modules. */
  readonly sibling?: { readonly version: string } | undefined
}): {
  readonly coreManifest: string
  readonly resolve: ManifestResolver
  readonly siblingResolve: ManifestResolver
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-resolution-'))
  roots.push(root)

  const coreRoot = join(root, ...(options.coreSuffix === undefined ? [] : options.coreSuffix.split('/')), 'node_modules', '@deepseek-ai', 'dsh')
  const coreManifest = manifest(coreRoot, {
    name: '@deepseek-ai/dsh',
    version: VERSION,
    ...(options.coreRevision === undefined ? {} : { dsh: { sourceRevision: options.coreRevision } }),
  })
  writeFileSync(join(coreRoot, 'bin.js'), '\n')

  if (options.nested !== undefined) {
    manifest(join(coreRoot, 'node_modules', '@deepseek-ai', 'dsh-tools'), member(options.nested.version, options.nested.revision))
  }
  if (options.hoisted !== undefined) {
    const hoistLevel = options.coreSuffix === undefined
      ? root
      : join(root, ...options.coreSuffix.split('/'))
    manifest(join(hoistLevel, 'node_modules', '@deepseek-ai', 'dsh-tools'), member(options.hoisted.version, options.hoisted.revision))
  }
  if (options.ancestor !== undefined) {
    manifest(join(root, 'node_modules', '@deepseek-ai', 'dsh-tools'), member(options.ancestor.version, options.ancestor.revision))
  }
  if (options.sibling !== undefined) {
    const siblingRoot = join(root, 'node_modules', '@linxin666', 'dsh-web-all')
    manifest(siblingRoot, { name: '@linxin666/dsh-web-all', version: '0.3.12' })
    manifest(join(siblingRoot, 'node_modules', '@deepseek-ai', 'dsh-tools'), member(options.sibling.version))
    writeFileSync(join(siblingRoot, 'entry.js'), '\n')
  }

  return {
    coreManifest,
    resolve: resolverFrom(join(coreRoot, 'bin.js')),
    siblingResolve: resolverFrom(join(root, 'node_modules', '@linxin666', 'dsh-web-all', 'entry.js')),
  }
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

  // The packed-install consumer shape: the core package has no nested copy, so
  // its resolution walk lands on the hoisted sibling. That copy must still be
  // judged against the candidate lineage — the vacuous pass this spec closes.
  it('accepts a hoisted sibling on the candidate lineage', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      hoisted: { version: VERSION, revision: CANDIDATE },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(resolutionsAcceptable([result])).toBe(true)
  })

  it('rejects a hoisted sibling of the same version packed from a different source', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      hoisted: { version: VERSION, revision: OTHER },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MISMATCH')
    expect(result.domain).toBe('core-runtime')
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  it('fails an unstamped hoisted sibling exactly like a wrong one', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      hoisted: { version: VERSION },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('UNKNOWN')
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  // The P1 this suite pins: when the core lacks its own member, Node's walk
  // ascends to ancestor node_modules levels, so an ancestor copy supplies the
  // core runtime and must be lineage-checked, never accepted as plugin-private.
  it('accepts an ancestor-level copy on the candidate lineage', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      coreSuffix: 'a/b',
      ancestor: { version: VERSION, revision: CANDIDATE },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(resolutionsAcceptable([result])).toBe(true)
  })

  it('rejects an ancestor-level copy of the same version packed from a different source', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      coreSuffix: 'a/b',
      ancestor: { version: VERSION, revision: OTHER },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MISMATCH')
    expect(result.domain).toBe('core-runtime')
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  it('fails an unstamped ancestor-level copy exactly like a wrong one', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      coreSuffix: 'a/b',
      ancestor: { version: VERSION },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('UNKNOWN')
    expect(resolutionsAcceptable([result])).toBe(false)
  })

  it('prefers the core nested copy over an ancestor-level wrong copy', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      coreSuffix: 'a/b',
      nested: { version: VERSION, revision: CANDIDATE },
      ancestor: { version: VERSION, revision: OTHER },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(result.resolvedSourceRevision).toBe(CANDIDATE)
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

  it('accepts a sibling-plugin private copy as a compatibility pin without a lineage requirement', () => {
    const { coreManifest, siblingResolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: VERSION, revision: CANDIDATE },
      sibling: { version: '0.1.1-rc.2' },
    })

    const result = checkCriticalPackage(TOOLS, siblingResolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('ALLOWED_COMPATIBILITY')
    expect(result.domain).toBe('plugin-private')
    expect(result.resolvedVersion).toBe('0.1.1-rc.2')
    expect(resolutionsAcceptable([result])).toBe(true)
  })

  // False-positive guard: a legitimate sibling copy must not make the core RED.
  it('does not let a sibling-plugin pin shadow the core runtime', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      nested: { version: VERSION, revision: CANDIDATE },
      sibling: { version: '0.1.1-rc.2' },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(result.resolvedVersion).toBe(VERSION)
  })

  it('prefers the hoisted sibling over a sibling-plugin pin when the core nests no copy', () => {
    const { coreManifest, resolve } = installation({
      coreRevision: CANDIDATE,
      hoisted: { version: VERSION, revision: CANDIDATE },
      sibling: { version: '0.1.1-rc.2' },
    })

    const result = checkCriticalPackage(TOOLS, resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('MATCH')
    expect(result.domain).toBe('core-runtime')
    expect(result.resolvedVersion).toBe(VERSION)
  })

  it('resolves through a child process, so no loader in this process can answer', () => {
    const { coreManifest } = installation({ coreRevision: CANDIDATE, nested: { version: VERSION, revision: CANDIDATE } })
    const entry = coreManifest.slice(0, coreManifest.length - '/package.json'.length)
    const resolve = subprocessResolver(join(entry, 'lib', 'bin.js'), scrubbedEnvironment())

    expect(resolve(`${TOOLS}/package.json`)).toContain(TOOLS)
  })

  it('throws from the child when a package does not resolve, which is the UNKNOWN verdict', () => {
    const { coreManifest } = installation({ coreRevision: CANDIDATE })
    const entry = coreManifest.slice(0, coreManifest.length - '/package.json'.length)
    const resolve = subprocessResolver(join(entry, 'lib', 'bin.js'), scrubbedEnvironment())

    const result = checkCriticalPackage('@deepseek-ai/dsh-absent-package', resolve, expectedCoreLineage(coreManifest))

    expect(result.status).toBe('UNKNOWN')
    expect(result.detail).toBe('package did not resolve from this runtime')
    expect(result.resolvedPath).toBeUndefined()
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
