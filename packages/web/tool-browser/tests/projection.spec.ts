/**
 * The `browserVerify` projection provider: mounting tool-browser beside the
 * registry serves the latest browser/verify evidence of the current turn
 * (null before the first attempt or after the next turn/start); a composition
 * without tool-browser has no `browserVerify` key; unmounting tool-browser
 * removes it (HMR safety). Executing the tool through a real session appends
 * the durable evidence event end-to-end.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import type { BrowserVerificationEvidence } from '@deepseek-ai/dsh-tool-browser'

interface Bench {
  ctx: Context
  session: Session
  agent: Agent
  tailProjections(): Promise<{ asOfSeq: number; values: Record<string, unknown> } | undefined>
}

async function harness(withBrowserTool: boolean): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withBrowserTool) await ctx.plugin(ToolBrowser, {})
  const session = ctx.sessions.create()
  const agent = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  return {
    ctx,
    session,
    agent,
    async tailProjections() {
      return ctx.sessionProjections.snapshot(session)
    },
  }
}

/** One paginable message so the tail page is non-degenerate. */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('browserVerify projection provider', () => {
  it('serves null before the first browser/verify', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections?.values.browserVerify).toBeNull()
    expect(projections?.asOfSeq).toBe(bench.session.seq - 1)
  })

  it('serves the latest evidence after appends, asOfSeq = last event seq', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    const first: BrowserVerificationEvidence = { action: 'goto', outcome: 'PASS', url: 'http://127.0.0.1:1/', title: 'First' }
    const second: BrowserVerificationEvidence = {
      action: 'goto',
      outcome: 'PRODUCT_FAILURE',
      reason: 'expected text "x" not found on the page',
      url: 'http://127.0.0.1:1/',
    }
    session.append('turn/start', { turn: 1 })
    session.append('browser/verify', first)
    session.append('browser/verify', second)
    const projections = await bench.tailProjections()
    expect(projections?.values.browserVerify).toEqual(second)
    expect(projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('clears the standing evidence on the next turn/start (turn/end keeps it)', async () => {
    const bench = await harness(true)
    const session = bench.session
    seedMessage(session)
    const evidence: BrowserVerificationEvidence = { action: 'screenshot', outcome: 'PASS', screenshot_path: '/tmp/x.png' }
    session.append('turn/start', { turn: 1 })
    session.append('browser/verify', evidence)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await bench.tailProjections())?.values.browserVerify).toEqual(evidence)
    session.append('turn/start', { turn: 2 })
    const cleared = await bench.tailProjections()
    expect(cleared?.values.browserVerify).toBeNull()
    expect(cleared?.asOfSeq).toBe(session.seq - 1)
  })

  it('has no browserVerify key when tool-browser is not composed', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const projections = await bench.tailProjections()
    expect(projections).toBeDefined()
    expect('browserVerify' in (projections?.values ?? {})).toBe(false)
  })

  it('drops the key when the tool-browser fiber unloads (HMR safety)', async () => {
    const bench = await harness(false)
    seedMessage(bench.session)
    const fiber = await bench.ctx.plugin(ToolBrowser, {})
    expect((await bench.tailProjections())?.values.browserVerify).toBeNull()
    await fiber.dispose()
    expect('browserVerify' in ((await bench.tailProjections())?.values ?? {})).toBe(false)
  })

  it('appends durable evidence when the tool executes on a real session', async () => {
    const bench = await harness(true)
    seedMessage(bench.session)
    const result = await bench.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-evidence'),
      name: 'browser',
      arguments: { action: 'list' },
      agent: bench.agent,
    })
    expect(result.isError).toBe(false)
    const projections = await bench.tailProjections()
    expect(projections?.values.browserVerify).toEqual({ action: 'list', outcome: 'PASS' })
  })
})
