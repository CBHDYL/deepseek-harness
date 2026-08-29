import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as EscalationHider from '@deepseek-ai/dsh-escalation-hider'
import { shouldHideEscalation, stripEscalationParameters } from '@deepseek-ai/dsh-escalation-hider'

/** A bash-like tool with escalation fields, plus a plain tool that must never change. */
function sampleTools(): ToolSchema[] {
  return [
    {
      name: 'bash',
      description: 'run a command',
      parameters: {
        command: { type: 'string', required: true, description: 'cmd' },
        sandbox_permissions: { type: 'string', description: 'escalate' },
        justification: { type: 'string', description: 'why' },
      },
    },
    {
      name: 'pwsh',
      description: 'run a powershell command',
      parameters: {
        command: { type: 'string', required: true, description: 'cmd' },
        sandbox_permissions: { type: 'string', description: 'escalate' },
      },
    },
    {
      name: 'read',
      description: 'read a file',
      parameters: { path: { type: 'string', required: true, description: 'p' } },
    },
  ]
}

describe('shouldHideEscalation', () => {
  it('hides when the approval policy is never, regardless of mode', () => {
    expect(shouldHideEscalation('workspace-write', 'never', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: true })).toBe(true)
    expect(shouldHideEscalation(undefined, 'never', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: true })).toBe(true)
  })

  it('hides when the effective mode is at or above the configured ceiling', () => {
    expect(shouldHideEscalation('danger-full-access', 'ask', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: true })).toBe(true)
    expect(shouldHideEscalation('danger-full-access', 'ask', { hideAtOrAboveMode: 'workspace-write', hideWhenApprovalNever: true })).toBe(true)
  })

  it('does not hide when escalation can still succeed', () => {
    expect(shouldHideEscalation('workspace-write', 'ask', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: true })).toBe(false)
    expect(shouldHideEscalation('read-only', 'ask', { hideAtOrAboveMode: 'workspace-write', hideWhenApprovalNever: true })).toBe(false)
    expect(shouldHideEscalation(undefined, 'ask', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: true })).toBe(false)
  })

  it('respects hideWhenApprovalNever=false', () => {
    expect(shouldHideEscalation('workspace-write', 'never', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: false })).toBe(false)
    expect(shouldHideEscalation('danger-full-access', 'never', { hideAtOrAboveMode: 'danger-full-access', hideWhenApprovalNever: false })).toBe(true)
  })
})

describe('stripEscalationParameters', () => {
  it('strips escalation params from matching tools only, deeply preserving the rest', () => {
    const tools = sampleTools()
    const stripped = stripEscalationParameters(tools, ['bash', 'pwsh'])
    expect(stripped).toHaveLength(3)
    expect(stripped[0]!.parameters).toEqual({ command: { type: 'string', required: true, description: 'cmd' } })
    expect(stripped[1]!.parameters).toEqual({ command: { type: 'string', required: true, description: 'cmd' } })
    expect(stripped[2]!.parameters).toEqual({ path: { type: 'string', required: true, description: 'p' } })
    // Identical tool objects are not reconstructed unless a param was removed.
    expect(stripped[2]).toBe(tools[2])
  })

  it('honors wildcard patterns', () => {
    const tools = sampleTools()
    const stripped = stripEscalationParameters(tools, ['bash*'])
    expect(stripped[0]!.parameters).toEqual({ command: { type: 'string', required: true, description: 'cmd' } })
    expect(stripped[1]!.parameters).toHaveProperty('sandbox_permissions')
    expect(stripped[2]).toBe(tools[2])
  })

  it('empty patterns leave everything untouched', () => {
    const tools = sampleTools()
    expect(stripEscalationParameters(tools, [])).toBe(tools)
  })
})

describe('assembly wiring', () => {
  it('strips escalation params from the assembled tool schema for a danger-mode session', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(EscalationHider, {})
    // A fake agent whose session log declares the widest sandbox mode.
    const fakeAgent = {
      session: {
        events: [
          { seq: 0, type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
        ] as unknown[],
      },
    } as unknown as Agent
    ctx.systemPrompt.tools(() => ({
      schemas: sampleTools(),
      knownNames: ['bash', 'pwsh', 'read'],
    }))
    const fallback = () => Promise.resolve({
      sections: [],
      contexts: [],
      tools: sampleTools(),
      variables: {},
    })
    const assembly = await ctx.waterfall(
      scopeTarget(ctx.systemPrompt, undefined),
      'system-prompt/assemble',
      { sections: [], contexts: [], tools: sampleTools(), variables: {} },
      { agent: fakeAgent },
      fallback,
    )
    expect(assembly.tools[0]!.parameters).not.toHaveProperty('sandbox_permissions')
    expect(assembly.tools[1]!.parameters).not.toHaveProperty('sandbox_permissions')
    expect(assembly.tools[2]!.parameters).toEqual({ path: { type: 'string', required: true, description: 'p' } })
  })

  it('leaves the schema untouched for an ask-mode workspace session', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(EscalationHider, {})
    const fakeAgent = {
      session: {
        events: [
          { seq: 0, type: 'sandbox/mode', data: { mode: 'workspace-write' } },
          { seq: 1, type: 'approval/policy', data: { policy: 'ask' } },
        ] as unknown[],
      },
    } as unknown as Agent
    ctx.systemPrompt.tools(() => ({
      schemas: sampleTools(),
      knownNames: ['bash', 'pwsh', 'read'],
    }))
    const fallback = () => Promise.resolve({
      sections: [],
      contexts: [],
      tools: sampleTools(),
      variables: {},
    })
    const assembly = await ctx.waterfall(
      scopeTarget(ctx.systemPrompt, undefined),
      'system-prompt/assemble',
      { sections: [], contexts: [], tools: sampleTools(), variables: {} },
      { agent: fakeAgent },
      fallback,
    )
    expect(assembly.tools[0]!.parameters).toHaveProperty('sandbox_permissions')
    expect(assembly.tools[0]!.parameters).toHaveProperty('justification')
  })

  it('no-op without an agent in the assembly context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(EscalationHider, {})
    ctx.systemPrompt.tools(() => ({
      schemas: sampleTools(),
      knownNames: ['bash', 'pwsh', 'read'],
    }))
    const fallback = () => Promise.resolve({
      sections: [],
      contexts: [],
      tools: sampleTools(),
      variables: {},
    })
    const assembly = await ctx.waterfall(
      scopeTarget(ctx.systemPrompt, undefined),
      'system-prompt/assemble',
      { sections: [], contexts: [], tools: sampleTools(), variables: {} },
      {},
      fallback,
    )
    expect(assembly.tools[0]!.parameters).toHaveProperty('sandbox_permissions')
  })
})
