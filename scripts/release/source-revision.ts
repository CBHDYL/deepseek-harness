/**
 * Stamping the source commit a release artifact was packed from.
 *
 * A package version alone cannot identify the code inside an artifact: two
 * builds of the same version from different commits are indistinguishable once
 * installed. The pack step therefore records the packing commit in each member
 * manifest as `dsh.sourceRevision`, so an installed artifact answers "which
 * source produced this" from its own bytes rather than from whatever checkout
 * happens to sit next to it at runtime.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { capture } from './process.ts'

/** Manifest key carrying the packing commit under the manifest's `dsh` block. */
export const SOURCE_REVISION_KEY = 'sourceRevision'

/** A 40-character lowercase hex git object name. */
const REVISION_PATTERN = /^[0-9a-f]{40}$/

/**
 * Read the commit a pack run is packing from.
 * @param root - repository root.
 * @returns The full commit hash `HEAD` resolves to.
 * @throws When the checkout reports no usable commit, so a release can never
 * silently stamp an empty or abbreviated revision.
 */
export function packingRevision(root: string): string {
  const revision = capture('git', ['-C', root, 'rev-parse', 'HEAD']).trim()
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error(`release pack: HEAD did not resolve to a full commit hash, got ${JSON.stringify(revision)}`)
  }
  return revision
}

/**
 * Write `dsh.sourceRevision` into one member manifest.
 *
 * The stamp is applied to the checked-in manifest immediately before `pnpm
 * pack` reads it, because npm packs the manifest as it finds it on disk.
 * Callers restore the original bytes once the tarball exists.
 * @param directory - absolute member directory holding `package.json`.
 * @param revision - the packing commit to record.
 * @returns The manifest bytes as they were before stamping.
 */
export function stampSourceRevision(directory: string, revision: string): string {
  const manifestPath = join(directory, 'package.json')
  const original = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(original) as Record<string, unknown>
  const existing = manifest['dsh']
  const dsh = existing === undefined ? {} : (existing as Record<string, unknown>)
  manifest['dsh'] = { ...dsh, [SOURCE_REVISION_KEY]: revision }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  return original
}

/**
 * Restore a manifest stamped by {@link stampSourceRevision}.
 * @param directory - absolute member directory holding `package.json`.
 * @param original - the bytes returned by the matching stamp call.
 */
export function restoreManifest(directory: string, original: string): void {
  writeFileSync(join(directory, 'package.json'), original)
}

/**
 * Read the source revision an installed or packed manifest declares.
 * @param manifest - a parsed `package.json`.
 * @returns The recorded commit, or `undefined` for an artifact packed before
 * this stamp existed or produced outside the release pack step.
 */
export function declaredSourceRevision(manifest: unknown): string | undefined {
  if (manifest === null || typeof manifest !== 'object') return undefined
  const dsh = (manifest as Record<string, unknown>)['dsh']
  if (dsh === null || typeof dsh !== 'object') return undefined
  const revision = (dsh as Record<string, unknown>)[SOURCE_REVISION_KEY]
  return typeof revision === 'string' && REVISION_PATTERN.test(revision) ? revision : undefined
}
