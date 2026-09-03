/**
 * P-SANDBOX authority invariants: the deployment ceiling and the minted
 * provenance of every resolved policy.
 *
 * Only policies the SandboxPolicyService minted carry authority. Forging by
 * constructing, spreading, cloning, or JSON-round-tripping a policy selects
 * the deployment default instead of the claimed mode, and no resolved mode —
 * session override, tool request, or approved escalation — exceeds maxMode.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicyService, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'

type Mode = SandboxMode

async function mounted(config: { mode?: Mode; maxMode?: Mode; workspaceRoot?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, config)
  return ctx
}

function session(id: string): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, { version: 0, id: sessionId, createdAt: 0, isSeeded: false })
}

describe('sandbox authority (P-SANDBOX)', () => {
  it('mints every resolved policy: frozen and owner-registered', async () => {
    const ctx = await mounted({ mode: 'read-only' })
    const policy = ctx.sandboxPolicy.resolve()
    expect(ctx.sandboxPolicy.isMinted(policy)).toBe(true)
    expect(Object.isFrozen(policy)).toBe(true)
  })

  it('refuses a caller-constructed plain object as authority', async () => {
    const ctx = await mounted()
    const forged: SandboxExecutionPolicy = { mode: 'danger-full-access', workspaceRoot: '/' }
    expect(ctx.sandboxPolicy.isMinted(forged)).toBe(false)
  })

  it('refuses a spread clone of a minted policy', async () => {
    const ctx = await mounted({ mode: 'read-only' })
    const minted = ctx.sandboxPolicy.resolve()
    const clone = { ...minted }
    expect(ctx.sandboxPolicy.isMinted(minted)).toBe(true)
    expect(ctx.sandboxPolicy.isMinted(clone)).toBe(false)
  })

  it('refuses a JSON round-trip of a minted policy', async () => {
    const ctx = await mounted({ mode: 'read-only' })
    const roundTripped = JSON.parse(JSON.stringify(ctx.sandboxPolicy.resolve())) as SandboxExecutionPolicy
    expect(ctx.sandboxPolicy.isMinted(roundTripped)).toBe(false)
  })

  it('caps the deployment default at maxMode', async () => {
    const ctx = await mounted({ mode: 'danger-full-access', maxMode: 'workspace-write' })
    expect(ctx.sandboxPolicy.resolve().mode).toBe('workspace-write')
  })

  it('caps an explicit caller mode at maxMode', async () => {
    const ctx = await mounted({ mode: 'read-only', maxMode: 'workspace-write' })
    expect(ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' }).mode).toBe('workspace-write')
  })

  it('caps a session override at maxMode', async () => {
    const ctx = await mounted({ mode: 'read-only', maxMode: 'workspace-write' })
    const activeSession = session('ceiling-session')
    setSandboxMode(activeSession, 'danger-full-access')
    expect(ctx.sandboxPolicy.resolve({ session: activeSession }).mode).toBe('workspace-write')
  })

  it('re-mints a legal escalation through the owner and keeps lower/equal modes', async () => {
    const ctx = await mounted({ mode: 'read-only', maxMode: 'danger-full-access' })
    const activeSession = session('escalation-session')
    const escalated = ctx.sandboxPolicy.resolve({ session: activeSession, mode: 'workspace-write' })
    expect(escalated.mode).toBe('workspace-write')
    expect(ctx.sandboxPolicy.isMinted(escalated)).toBe(true)
    const equal = ctx.sandboxPolicy.resolve({ session: activeSession, mode: 'workspace-write' })
    expect(equal.mode).toBe('workspace-write')
    const lower = ctx.sandboxPolicy.resolve({ session: activeSession, mode: 'read-only' })
    expect(lower.mode).toBe('read-only')
  })

  it('fails loud on an invalid maxMode at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await expect(ctx.plugin(SandboxPolicyService, { maxMode: 'not-a-mode' as unknown as Mode })).rejects.toThrow()
  })
})
