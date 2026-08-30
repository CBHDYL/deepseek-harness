/**
 * Real-browser tests for the `browser` tool and its per-session manager:
 * goto/screenshot/click/fill/read_text against a local page, the agent-less
 * denial, and session-disposal closure. Skipped when no Chromium executable
 * is available on the host.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import { resolveBrowserExecutable } from '@deepseek-ai/dsh-tool-browser/manager'

const hasBrowser = resolveBrowserExecutable() !== undefined
const describeBrowser = hasBrowser ? describe : describe.skip

const screenshotDir = mkdtempSync(join(tmpdir(), 'dsh-browser-spec-'))
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolveResult => server.close(() => resolveResult()))))
})
rmSync(screenshotDir, { recursive: true, force: true })

/** A local page with a title, a button, and an input. */
function servePage(): Promise<{ server: Server; url: string }> {
  return new Promise((resolveResult) => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><title>Browser Spec</title><button id="b">clicked</button><input id="i"><div id="out"></div>')
    })
    server.listen(0, '127.0.0.1', () => {
      servers.push(server)
      const port = (server.address() as { port: number }).port
      resolveResult({ server, url: `http://127.0.0.1:${port}/` })
    })
  })
}

function agent(ctx: Context, sessionId: string) {
  const id = SessionId(sessionId)
  const fiber = ctx.plugin(() => {})
  return {
    id,
    ctx: fiber.ctx,
    session: { id, header: { version: 0, id, createdAt: 0 } },
  } as never
}

describeBrowser('browser tool', () => {
  async function harness() {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolBrowser, { screenshotDir })
    return ctx
  }

  const call = (ctx: Context, args: object, agentRef?: object) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: 'call-browser' as never,
    name: 'browser',
    arguments: args,
    ...agentRef !== undefined ? { agent: agentRef as never } : {},
  })

  const text = (result: { content: Array<{ type: string; text?: string }> }) =>
    result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')

  it('goto, read_text, click, fill, and screenshot round-trip', async () => {
    const ctx = await harness()
    const { url } = await servePage()
    const owner = agent(ctx, 'sess-browser')

    const loaded = await call(ctx, { action: 'goto', url }, owner)
    expect(loaded.isError).toBe(false)
    expect(text(loaded)).toContain('Browser Spec')

    const readText = await call(ctx, { action: 'read_text', selector: '#b' }, owner)
    expect(text(readText)).toBe('clicked')

    const clicked = await call(ctx, { action: 'click', selector: '#b' }, owner)
    expect(clicked.isError).toBe(false)

    const filled = await call(ctx, { action: 'fill', selector: '#i', value: 'hello' }, owner)
    expect(filled.isError).toBe(false)

    const shot = await call(ctx, { action: 'screenshot', screenshot_name: 'roundtrip.png' }, owner)
    expect(shot.isError).toBe(false)
    expect(text(shot)).toContain('roundtrip.png')
  })

  it('denies actions without an agent', async () => {
    const ctx = await harness()
    const result = await call(ctx, { action: 'goto', url: 'http://127.0.0.1/' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an agent')
  })

  it('closes the session page on session disposal', async () => {
    const ctx = await harness()
    const { url } = await servePage()
    const owner = agent(ctx, 'sess-browser-close')
    const loaded = await call(ctx, { action: 'goto', url }, owner)
    expect(loaded.isError).toBe(false)

    ctx.emit('session/disposed', (owner as { session: object }).session as never)
    await new Promise(resolveResult => setTimeout(resolveResult, 300))
    const listed = await call(ctx, { action: 'list' }, owner)
    expect(text(listed)).toBe('no live page')
  })
})
