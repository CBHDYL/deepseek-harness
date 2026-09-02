import { describe, expect, it } from 'vitest'
import { formatVersion, runtimeIdentity } from '../src/identity.ts'

const REVISION_A = '56281b8d56898fc525adb8831508ee1144fd1de1'
const REVISION_B = 'dd6322d60aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('runtime identity', () => {
  it('reads the version and packed source revision an artifact declares', () => {
    const identity = runtimeIdentity({ version: '0.1.2-alpha.3', dsh: { sourceRevision: REVISION_A } })
    expect(identity).toEqual({ version: '0.1.2-alpha.3', sourceRevision: REVISION_A })
  })

  it('reports no revision for an artifact built outside the release pack step', () => {
    expect(runtimeIdentity({ version: '0.1.2-alpha.3' }).sourceRevision).toBeUndefined()
    expect(runtimeIdentity({ version: '0.1.2-alpha.3', dsh: {} }).sourceRevision).toBeUndefined()
    expect(runtimeIdentity({ version: '0.1.2-alpha.3', dsh: null }).sourceRevision).toBeUndefined()
  })

  it('refuses a malformed revision instead of reporting it as a commit', () => {
    for (const revision of ['', 'HEAD', '56281b8', REVISION_A.toUpperCase(), `${REVISION_A}0`, 42]) {
      expect(runtimeIdentity({ version: '1.0.0', dsh: { sourceRevision: revision } }).sourceRevision).toBeUndefined()
    }
  })

  it('falls back to 0.0.0 rather than throwing on an unusable manifest', () => {
    expect(runtimeIdentity(null).version).toBe('0.0.0')
    expect(runtimeIdentity('package.json').version).toBe('0.0.0')
    expect(runtimeIdentity({ dsh: { sourceRevision: REVISION_A } }).version).toBe('0.0.0')
  })

  // The B1 regression oracle: version-only identity cannot separate two builds
  // of one version from different commits, so `--version` must not either.
  it('distinguishes same-version artifacts built from different sources', () => {
    const rendered = [REVISION_A, REVISION_B].map(sourceRevision =>
      formatVersion(runtimeIdentity({ version: '0.1.2-alpha.3', dsh: { sourceRevision } })))

    expect(rendered[0]).not.toBe(rendered[1])
    expect(rendered[0]).toContain('56281b8d5')
    expect(rendered[1]).toContain('dd6322d60')
  })

  it('separates a stamped artifact from an unstamped one at the same version', () => {
    const stamped = formatVersion(runtimeIdentity({ version: '0.1.2-alpha.3', dsh: { sourceRevision: REVISION_A } }))
    const unstamped = formatVersion(runtimeIdentity({ version: '0.1.2-alpha.3' }))

    expect(stamped).not.toBe(unstamped)
    expect(unstamped).toBe('0.1.2-alpha.3')
  })
})
