import { describe, expect, it } from 'vitest'
import { type CriticalResolution } from './release/critical-resolution.ts'
import { assessHealth, type HealthInput } from './verify-health.ts'

const CANDIDATE = '70dca4e50af032293bbd7e7b1458a7f9c7615dd9'
const OTHER = 'dd6322d60aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

/** The mutable shape a test assembles; structurally satisfies {@link HealthInput}. */
interface Fixture {
  identity: { version: string | undefined; sourceRevision: string | undefined }
  lineage: CriticalResolution[]
  profiles: { name: string; composes: boolean; criticalAtTopLevel: string[] }[]
  prerequisites: { pythonOk: boolean; pythonDetail: string; ptyAvailable: boolean | undefined }
}

/** A healthy aggregation input; tests override one surface at a time. */
function healthyInput(): Fixture {
  return {
    identity: { version: '0.1.2-alpha.5', sourceRevision: CANDIDATE },
    lineage: [],
    profiles: [{ name: 'web', composes: true, criticalAtTopLevel: [] }],
    prerequisites: { pythonOk: true, pythonDetail: 'python3 = 3.10', ptyAvailable: true },
  }
}

/** A critical-lineage MATCH entry for one package. */
function match(name: string): CriticalResolution {
  return {
    package: name,
    resolvedPath: '/install/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/package.json',
    resolvedVersion: '0.1.2-alpha.5',
    resolvedSourceRevision: CANDIDATE,
    domain: 'core-runtime',
    status: 'MATCH',
    detail: 'core lineage matches the installed candidate',
  }
}

function verdict(input: HealthInput): string {
  return assessHealth(input).status
}

describe('assessHealth aggregation', () => {
  it('reports PASS for a healthy verified environment', () => {
    const input = healthyInput()
    input.lineage = [
      match('@deepseek-ai/dsh-tools'),
      { ...match('@deepseek-ai/dsh-session-projection'), package: '@deepseek-ai/dsh-session-projection' },
    ]

    const result = assessHealth(input)

    expect(result.status).toBe('PASS')
    expect(result.signals.find(signal => signal.name === 'lineage')?.status).toBe('PASS')
  })

  it('reports BLOCK when a critical package is on the wrong lineage', () => {
    const input = healthyInput()
    input.lineage = [{ ...match('@deepseek-ai/dsh-tools'), resolvedSourceRevision: OTHER, status: 'MISMATCH', detail: 'same version, different source' }]

    expect(verdict(input)).toBe('BLOCK')
  })

  it('reports BLOCK when a critical package has no provenance', () => {
    const input = healthyInput()
    input.lineage = [{ ...match('@deepseek-ai/dsh-tools'), resolvedSourceRevision: undefined, status: 'UNKNOWN', detail: 'no source revision' }]

    expect(verdict(input)).toBe('BLOCK')
  })

  it('reports WARN for non-blocking environment debt', () => {
    const input = healthyInput()
    input.prerequisites = { pythonOk: false, pythonDetail: 'python3 = 3.9', ptyAvailable: false }

    const result = assessHealth(input)

    expect(result.status).toBe('WARN')
    expect(result.signals.find(signal => signal.name === 'prerequisite:python')?.status).toBe('WARN')
    expect(result.signals.find(signal => signal.name === 'prerequisite:pty')?.status).toBe('WARN')
  })

  it('never misjudges a plugin-private compatibility pin as BLOCK', () => {
    const input = healthyInput()
    input.lineage = [{
      ...match('@deepseek-ai/dsh-tools'),
      resolvedPath: '/profile/node_modules/@linxin666/dsh-web-all/node_modules/@deepseek-ai/dsh-tools/package.json',
      resolvedVersion: '0.1.1-rc.2',
      resolvedSourceRevision: undefined,
      domain: 'plugin-private',
      status: 'ALLOWED_COMPATIBILITY',
      detail: 'private to a plugin subtree; cannot supply the core runtime',
    }]

    const result = assessHealth(input)

    expect(result.status).not.toBe('BLOCK')
    expect(result.signals.find(signal => signal.name === 'lineage')?.status).toBe('PASS')
  })

  it('reports BLOCK when a profile cannot compose', () => {
    const input = healthyInput()
    input.profiles = [{ name: 'broken', composes: false, criticalAtTopLevel: [] }]

    expect(verdict(input)).toBe('BLOCK')
  })

  it('reports WARN for a critical package hoisted at profile top level, not BLOCK', () => {
    const input = healthyInput()
    input.profiles = [{ name: 'web', composes: true, criticalAtTopLevel: ['@deepseek-ai/dsh-tools'] }]

    const result = assessHealth(input)

    expect(result.status).toBe('WARN')
    expect(result.signals.find(signal => signal.name === 'profile:web')?.status).toBe('WARN')
  })

  it('reports WARN for an unstamped identity without blocking', () => {
    const input = healthyInput()
    input.identity = { version: '0.1.2-alpha.5', sourceRevision: undefined }

    expect(verdict(input)).toBe('WARN')
  })
})
