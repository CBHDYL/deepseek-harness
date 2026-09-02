/**
 * Report where an already-installed `dsh` loads its authority-sensitive
 * packages from, and fail when that lineage is not acceptable.
 *
 * The pack job gates a candidate before it ships; this entry answers the same
 * provenance question about a runtime that is already on a machine, which is
 * the case a pack-time gate structurally cannot cover: an install that was
 * later overwritten, upgraded in place, or assembled from more than one
 * release. It reads manifests and resolves specifiers — it starts no runtime,
 * loads no plugin, and changes nothing.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  checkCriticalResolutions, expectedCoreLineage, resolutionsAcceptable, subprocessResolver,
} from './critical-resolution.ts'
import { isEntry } from './process.ts'

/**
 * Environment for the resolving child: no host module loader may answer a
 * provenance question, or a source checkout could stand in for the install.
 * @returns The child environment.
 */
function resolutionEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  return environment
}

/** Check one installed core runtime and exit non-zero when its lineage is unacceptable. */
function main(): void {
  const { values } = parseArgs({
    options: { install: { type: 'string' }, entry: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.install === undefined) {
    throw new Error('usage: verify-critical-resolution.ts --install <installed package root> [--entry <file inside it>]')
  }

  const installedRoot = resolve(process.cwd(), values.install)
  const manifestPath = join(installedRoot, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} does not exist`)
  const entryPath = values.entry === undefined ? join(installedRoot, 'package.json') : resolve(installedRoot, values.entry)

  const lineage = expectedCoreLineage(manifestPath)
  console.log(`release verify-critical-resolution: candidate ${lineage.version} at ${lineage.root}`)
  console.log(`release verify-critical-resolution: source revision ${lineage.sourceRevision ?? '(unstamped)'}`)

  const resolutions = checkCriticalResolutions(subprocessResolver(entryPath, resolutionEnvironment()), lineage)
  for (const resolution of resolutions) {
    console.log(`  ${resolution.status.padEnd(21)} ${resolution.package} — ${resolution.detail}`)
  }

  if (!resolutionsAcceptable(resolutions)) {
    const offenders = resolutions.filter(entry => entry.status !== 'MATCH' && entry.status !== 'ALLOWED_COMPATIBILITY')
    throw new Error(`critical dependency lineage is not acceptable: ${String(offenders.length)} of ${String(resolutions.length)} package(s) failed`)
  }
  console.log(`release verify-critical-resolution: acceptable (${String(resolutions.length)} package(s))`)
}

if (isEntry(import.meta.url)) main()
