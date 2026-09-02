/**
 * What this `dsh` artifact reports about the source it was built from.
 * @module @deepseek-ai/dsh/identity
 *
 * A version string alone cannot identify an installed artifact: two builds of
 * one version from different commits print the same thing. The release pack
 * step records its packing commit as `dsh.sourceRevision` in the published
 * manifest, and this module reads that record back out of the artifact's own
 * manifest — never out of a git checkout that happens to sit nearby, which
 * would describe the developer's tree instead of the running code.
 */

/** The identity an installed `dsh` artifact declares about itself. */
export interface RuntimeIdentity {
  /** Package version from this artifact's manifest. */
  readonly version: string
  /**
   * Commit the artifact was packed from, or `undefined` for an artifact built
   * outside the release pack step (a local `pnpm build`, or a release packed
   * before the stamp existed).
   */
  readonly sourceRevision: string | undefined
}

/** A 40-character lowercase hex git object name. */
const REVISION_PATTERN = /^[0-9a-f]{40}$/

/** Characters of the commit shown by `--version`, matching short-hash convention. */
const DISPLAY_LENGTH = 9

/**
 * Read the identity a parsed manifest declares.
 * @param manifest - this artifact's parsed `package.json`.
 * @returns The declared version and source revision. A manifest without a
 * usable version reports `0.0.0`, and a missing or malformed revision reports
 * `undefined` rather than a value callers could mistake for a real commit.
 */
export function runtimeIdentity(manifest: unknown): RuntimeIdentity {
  if (manifest === null || typeof manifest !== 'object') return { version: '0.0.0', sourceRevision: undefined }
  const record = manifest as Record<string, unknown>
  const version = typeof record['version'] === 'string' ? record['version'] : '0.0.0'
  const dsh = record['dsh']
  if (dsh === null || typeof dsh !== 'object') return { version, sourceRevision: undefined }
  const revision = (dsh as Record<string, unknown>)['sourceRevision']
  const sourceRevision = typeof revision === 'string' && REVISION_PATTERN.test(revision) ? revision : undefined
  return { version, sourceRevision }
}

/**
 * Render an identity for `--version`.
 * @param identity - the identity this artifact declares.
 * @returns The version, followed by the packing commit when the artifact
 * records one. Two artifacts sharing a version but built from different
 * commits render differently, which is the property that makes an installed
 * runtime traceable to its source.
 */
export function formatVersion(identity: RuntimeIdentity): string {
  if (identity.sourceRevision === undefined) return identity.version
  return `${identity.version} (source ${identity.sourceRevision.slice(0, DISPLAY_LENGTH)})`
}
