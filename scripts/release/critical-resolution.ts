/**
 * Where an installed `dsh` actually loads its authority-sensitive packages from.
 *
 * This answers a provenance question, never a behavioural one: which artifact
 * supplies each critical package, and does it belong to the candidate lineage
 * the core runtime was packed as. The security semantics inside those packages
 * are owned by their own implementations and tests; nothing here inspects or
 * re-decides them.
 *
 * Two resolution domains matter and must not be conflated. A copy is part of
 * the core runtime when the core's own resolution walk can reach it as its
 * dependency: either nested inside the installed `dsh` package (a global
 * install), or hoisted beside the core package in the same `node_modules` level
 * (the packed-install consumer). Plugin subtrees may legitimately keep older
 * copies to satisfy a plugin's declared peer range; those copies live under
 * some other package's own `node_modules` and cannot supply the core runtime,
 * because the core's resolution walk never descends into them.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'
import { declaredSourceRevision } from './source-revision.ts'

/**
 * Packages whose loaded copy decides an authority-sensitive runtime path.
 *
 * Membership is a provenance judgement — "a wrong copy here changes who holds
 * authority" — and deliberately excludes packages whose drift is only a feature
 * difference.
 */
export const CRITICAL_PACKAGES = [
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-action-policy-guard',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-compaction-basic',
] as const

/** Which installation owns a resolved copy. */
export type ResolutionDomain = 'core-runtime' | 'plugin-private' | 'unknown'

/** Verdict for one critical package's resolved copy. */
export type ResolutionStatus = 'MATCH' | 'ALLOWED_COMPATIBILITY' | 'MISMATCH' | 'UNKNOWN'

/** What one critical package resolved to, and whether that is acceptable. */
export interface CriticalResolution {
  /** Package name that was resolved. */
  readonly package: string
  /** Absolute path of the resolved manifest, or `undefined` when unresolvable. */
  readonly resolvedPath: string | undefined
  /** Version the resolved manifest declares. */
  readonly resolvedVersion: string | undefined
  /** Source revision the resolved artifact was packed from, when stamped. */
  readonly resolvedSourceRevision: string | undefined
  /** Which installation supplied the copy. */
  readonly domain: ResolutionDomain
  /** Verdict for this package. */
  readonly status: ResolutionStatus
  /** Why the status was assigned. */
  readonly detail: string
}

/** The candidate lineage a core runtime is expected to resolve within. */
export interface ExpectedCore {
  /** Absolute real path of the installed core package root. */
  readonly root: string
  /** The `node_modules` directory that directly holds the core package. */
  readonly hoist: string
  /** Version the core manifest declares. */
  readonly version: string
  /** Source revision the core artifact was packed from, when stamped. */
  readonly sourceRevision: string | undefined
}

/** A resolver for one installation; `createRequire` in production. */
export type ManifestResolver = (specifier: string) => string

function readManifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

/**
 * Resolve symlinks so a containment test compares like with like.
 *
 * Node resolves module paths through their real locations, and installation
 * roots routinely sit behind a symlink (`/var` on macOS, pnpm store links), so
 * comparing a resolved path against an unresolved root would misread a core
 * copy as foreign.
 * @param path - path to canonicalize.
 * @returns The real path, or the input when it cannot be canonicalized.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    // A path that no longer exists cannot be canonicalized; comparing the
    // literal form still yields a defined, conservative domain verdict.
    return path
  }
}

/**
 * Read the expected lineage from an installed core package.
 * @param coreManifestPath - absolute path of the core `package.json`.
 * @returns The lineage every core-runtime resolution is checked against.
 */
export function expectedCoreLineage(coreManifestPath: string): ExpectedCore {
  const manifest = readManifest(coreManifestPath)
  const version = typeof manifest['version'] === 'string' ? manifest['version'] : ''
  const root = canonical(coreManifestPath.slice(0, coreManifestPath.length - '/package.json'.length))
  // Walk up from the core package until the node_modules level that holds it.
  let hoist = root
  while (true) {
    const parent = dirname(hoist)
    if (parent === hoist) break
    hoist = parent
    if (hoist.endsWith(`${sep}node_modules`)) break
  }
  return { root, hoist: canonical(hoist), version, sourceRevision: declaredSourceRevision(manifest) }
}

/**
 * Classify which installation a resolved manifest belongs to.
 * @param resolvedPath - absolute path of the resolved manifest.
 * @param expected - the expected core lineage.
 * @returns `core-runtime` when the core's own resolution walk supplies the
 * copy — nested inside the core package, or hoisted beside it in the same
 * `node_modules` level — and `plugin-private` when the copy sits inside some
 * other package's own `node_modules`.
 */
export function resolutionDomain(resolvedPath: string, expected: ExpectedCore): ResolutionDomain {
  const real = canonical(resolvedPath)
  if (real.startsWith(`${expected.root}/`)) return 'core-runtime'
  if (real.startsWith(`${expected.hoist}/`)) {
    // Inside the core's install level but outside the core package: either a
    // direct hoist beside the core, or nested under a sibling package's own
    // node_modules. Only the direct hoist is what the core would load.
    const relative = real.slice(expected.hoist.length + 1)
    return relative.includes('/node_modules/') ? 'plugin-private' : 'core-runtime'
  }
  if (real.includes('/node_modules/')) return 'plugin-private'
  return 'unknown'
}

/**
 * Check one critical package against the expected core lineage.
 *
 * A core-runtime copy must carry the core's version and, when the core records
 * one, the same source revision: two artifacts of one version packed from
 * different commits are different code, so version equality alone never
 * establishes a match. A plugin-private copy is reported as an accepted
 * compatibility pin without any lineage requirement, because it cannot supply
 * the core runtime.
 * @param specifier - the package to resolve.
 * @param resolve - resolver rooted at the runtime being checked.
 * @param expected - the expected core lineage.
 * @returns The resolution and its verdict.
 */
export function checkCriticalPackage(
  specifier: string,
  resolve: ManifestResolver,
  expected: ExpectedCore,
): CriticalResolution {
  let resolvedPath: string
  try {
    resolvedPath = resolve(`${specifier}/package.json`)
  } catch {
    return {
      package: specifier,
      resolvedPath: undefined,
      resolvedVersion: undefined,
      resolvedSourceRevision: undefined,
      domain: 'unknown',
      status: 'UNKNOWN',
      detail: 'package did not resolve from this runtime',
    }
  }

  const manifest = readManifest(resolvedPath)
  const resolvedVersion = typeof manifest['version'] === 'string' ? manifest['version'] : undefined
  const resolvedSourceRevision = declaredSourceRevision(manifest)
  const domain = resolutionDomain(resolvedPath, expected)
  const base = { package: specifier, resolvedPath, resolvedVersion, resolvedSourceRevision, domain } as const

  if (domain !== 'core-runtime') {
    return {
      ...base,
      status: 'ALLOWED_COMPATIBILITY',
      detail: 'private to a plugin subtree; cannot supply the core runtime',
    }
  }
  if (resolvedVersion !== expected.version) {
    return {
      ...base,
      status: 'MISMATCH',
      detail: `core runtime resolved version ${String(resolvedVersion)}, expected ${expected.version}`,
    }
  }
  if (expected.sourceRevision === undefined) {
    return { ...base, status: 'UNKNOWN', detail: 'core artifact records no source revision to check against' }
  }
  if (resolvedSourceRevision === undefined) {
    return { ...base, status: 'UNKNOWN', detail: 'resolved core copy records no source revision' }
  }
  if (resolvedSourceRevision !== expected.sourceRevision) {
    return {
      ...base,
      status: 'MISMATCH',
      detail: `same version ${expected.version} but source ${resolvedSourceRevision} != ${expected.sourceRevision}`,
    }
  }
  return { ...base, status: 'MATCH', detail: 'core lineage matches the installed candidate' }
}

/**
 * Check every critical package against one installed core runtime.
 * @param resolve - resolver rooted at the runtime being checked.
 * @param expected - the expected core lineage.
 * @param packages - packages to check; defaults to {@link CRITICAL_PACKAGES}.
 * @returns One resolution per package, in the order given.
 */
export function checkCriticalResolutions(
  resolve: ManifestResolver,
  expected: ExpectedCore,
  packages: readonly string[] = CRITICAL_PACKAGES,
): CriticalResolution[] {
  return packages.map(specifier => checkCriticalPackage(specifier, resolve, expected))
}

/**
 * Whether a set of resolutions may boot an authority-sensitive runtime.
 * @param resolutions - resolutions to judge.
 * @returns `true` only when no core-runtime resolution is `MISMATCH` or
 * `UNKNOWN`; an unproven lineage fails exactly like a wrong one.
 */
export function resolutionsAcceptable(resolutions: readonly CriticalResolution[]): boolean {
  return resolutions.every(entry => entry.status === 'MATCH' || entry.status === 'ALLOWED_COMPATIBILITY')
}

/**
 * Build a resolver rooted at an installed package entry point.
 * @param entryPath - absolute path of a file inside the installation.
 * @returns A resolver that follows that installation's resolution order.
 */
export function resolverFrom(entryPath: string): ManifestResolver {
  const require = createRequire(entryPath)
  return specifier => require.resolve(specifier)
}

/**
 * Build a resolver that answers from a plain Node child process.
 *
 * Provenance must be decided by Node's own resolver and nothing else. The
 * release scripts run under a TypeScript loader inside this workspace, and that
 * loader answers bare specifiers from `tsconfig` path mappings — a source
 * checkout would then stand in for the installed copy and report a package the
 * installation does not actually carry. The child is started without the
 * loader (`NODE_OPTIONS`/`NODE_PATH` scrubbed by the caller's environment), so
 * only the installation's own directory chain can answer.
 * @param entryPath - absolute path of a file inside the installation.
 * @param env - child environment; must not reinstate a module loader.
 * @returns A resolver that follows that installation's resolution order.
 */
export function subprocessResolver(entryPath: string, env: NodeJS.ProcessEnv): ManifestResolver {
  return (specifier) => {
    const source = 'import{createRequire}from\'node:module\';'
      + `process.stdout.write(createRequire(${JSON.stringify(entryPath)}).resolve(${JSON.stringify(specifier)}))`
    // A non-zero exit means the specifier did not resolve, which is the
    // `UNKNOWN` verdict callers expect from a throwing resolver.
    return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  }
}
