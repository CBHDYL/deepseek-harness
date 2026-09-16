import { describe, expect, it } from 'vitest'
import { findSandboxAuthorityViolations, SANDBOX_CONFINE_CALLERS, sourcePlaneFiles } from './verify-sandbox-authority.ts'

describe('sandbox authority manifest', () => {
  it('rejects a confinement consumer that no manifest entry accounts for', () => {
    const sources = new Map([
      ['packages/x/y/src/index.ts', 'const confined = await this.ctx.sandbox.confine(argv, policy, signal)'],
    ])
    expect(findSandboxAuthorityViolations(sources, {})).toEqual([
      { file: 'packages/x/y/src/index.ts', kind: 'unlisted-caller' },
    ])
  })

  // The PTC runtime read `request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()`,
  // which satisfies any check for a resolved owner policy while still forwarding a
  // forged one. A manifest entry is the only evidence this gate accepts.
  it('rejects a consumer that resolves an owner policy only as a fallback', () => {
    const sources = new Map([
      ['packages/x/y/src/index.ts', [
        'const policy = request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()',
        'const confined = await this.ctx.sandbox.confine(argv, policy, signal)',
      ].join('\n')],
    ])
    expect(findSandboxAuthorityViolations(sources, {})).toEqual([
      { file: 'packages/x/y/src/index.ts', kind: 'unlisted-caller' },
    ])
  })

  it('accepts an admitted consumer and rejects a stale entry', () => {
    const admitted = 'packages/x/y/src/index.ts'
    const listed = { [admitted]: 'states the policy origin' }
    expect(findSandboxAuthorityViolations(new Map([[admitted, 'await this.ctx.sandbox.confine(argv, policy)']]), listed)).toEqual([])
    expect(findSandboxAuthorityViolations(new Map([[admitted, 'const policy = resolve()']]), listed)).toEqual([
      { file: admitted, kind: 'stale-entry' },
    ])
    expect(findSandboxAuthorityViolations(new Map(), listed)).toEqual([
      { file: admitted, kind: 'stale-entry' },
    ])
  })

  it('keeps the manifest in step with the source plane', () => {
    const sources = sourcePlaneFiles(process.cwd())
    expect(sources.size).toBeGreaterThan(100)
    expect(findSandboxAuthorityViolations(sources)).toEqual([])
    expect(Object.keys(SANDBOX_CONFINE_CALLERS)).toHaveLength(6)
  })
})
