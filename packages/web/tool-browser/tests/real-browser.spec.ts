/**
 * Real-Chromium smoke tests over a local fixture server: goto/read_text/click/
 * fill/screenshot/close round-trip, durable attachment registration,
 * PRODUCT_FAILURE, INFRA_FAILURE (connection refused, navigation timeout),
 * POLICY_FAILURE (redirect to file://), and session-disposal closure. Skipped
 * when no Chromium executable is available on the host.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import * as ToolBrowserPlugin from '../src/index.ts'
import { resolveBrowserExecutable } from '../src/policy.ts'

const hasBrowser = resolveBrowserExecutable() !== undefined
const describeBrowser = hasBrowser ? describe : describe.skip

const scratchDirs: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One local fixture server serving the given handler; collects its port. */
function serve(handler: (res: ServerResponse) => void): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => { handler(res) })
    server.listen(0, '127.0.0.1', () => {
      servers.push(server)
      const port = (server.address() as { port: number }).port
      resolve({ server, url: `http://127.0.0.1:${port}/` })
    })
  })
}

/** The fixture page: a title, one visible sentence, a button, and an input. */
function pageHandler(res: ServerResponse): void {
  res.setHeader('content-type', 'text/html')
  res.end(
    '<!doctype html><title>Browser Smoke</title>'
    + '<p id="greeting">hello from the fixture</p>'
    + '<button id="b">clicked</button><input id="i"><div id="out"></div>',
  )
}

function agent(ctx: Context, sessionId: string): object {
  const id = SessionId(sessionId)
  const fiber = ctx.plugin(() => {})
  return { id, ctx: fiber.ctx, session: { id, header: { version: 0, id, createdAt: 0 }, append: () => {} } }
}

async function harness(
  config: ToolBrowserPlugin.Config,
  attachments = false,
): Promise<{ ctx: Context; call: (args: object, agentRef: object) => Promise<ToolExecutionResult> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (attachments) {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-browser-attach-'))
    scratchDirs.push(dshHome)
    await ctx.plugin(AttachmentLocal, { dshHome })
  }
  await ctx.plugin(ToolBrowserPlugin, config)
  let counter = 0
  const call = (args: object, agentRef: object) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`call-${++counter}`),
    name: 'browser',
    arguments: args,
    agent: agentRef as never,
  })
  return { ctx, call }
}

const text = (result: ToolExecutionResult): string =>
  result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')

describeBrowser('browser tool (real Chromium)', () => {
  it('goto, read_text, click, fill, viewport, screenshot, and close round-trip', async () => {
    const screenshotDir = mkdtempSync(join(tmpdir(), 'dsh-browser-smoke-'))
    scratchDirs.push(screenshotDir)
    const { ctx, call } = await harness({ screenshotDir })
    const { url } = await serve(pageHandler)
    const owner = agent(ctx, 'sess-smoke')

    const loaded = await call({ action: 'goto', url, viewport: { width: 800, height: 600 } }, owner)
    expect(loaded.isError).toBe(false)
    expect(text(loaded)).toContain('Browser Smoke')

    const readText = await call({ action: 'read_text', selector: '#greeting' }, owner)
    expect(text(readText)).toContain('hello from the fixture')

    const clicked = await call({ action: 'click', selector: '#b' }, owner)
    expect(clicked.isError).toBe(false)
    expect(text(clicked)).toContain('PASS')

    const filled = await call({ action: 'fill', selector: '#i', value: 'typed text' }, owner)
    expect(filled.isError).toBe(false)

    const shot = await call({ action: 'screenshot', screenshot_name: 'smoke.png' }, owner)
    expect(shot.isError).toBe(false)
    expect(readFileSync(join(screenshotDir, 'smoke.png')).length).toBeGreaterThan(0)

    const closed = await call({ action: 'close' }, owner)
    expect(text(closed)).toContain('page closed')
  })

  it('registers the screenshot as a durable, readable attachment', async () => {
    const screenshotDir = mkdtempSync(join(tmpdir(), 'dsh-browser-smoke-'))
    scratchDirs.push(screenshotDir)
    const { ctx, call } = await harness({ screenshotDir }, true)
    const { url } = await serve(pageHandler)

    const session = ctx.sessions.create()
    const owner = { id: session.id, session, status: 'idle', ctx } as Agent
    ctx.agents.register(owner)

    await call({ action: 'goto', url }, owner)
    const shot = await call({ action: 'screenshot', screenshot_name: 'attached.png' }, owner)
    expect(shot.isError).toBe(false)
    expect(text(shot)).toContain('(attachment ')

    // The durable reference travels with the browser/verify evidence; a
    // consumer reads the bytes back through the attachment service itself.
    const evidence = session.snapshotEvents()
      .filter(event => event.type === 'browser/verify')
      .at(-1)?.data
    expect(evidence?.attachment).toBeDefined()
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(evidence?.attachment?.attachmentId ?? ''),
      mediaType: 'image/png',
      width: evidence?.attachment?.width ?? 0,
      height: evidence?.attachment?.height ?? 0,
      bytes: evidence?.attachment?.bytes ?? 0,
    }
    const stored = await ctx.attachments.readImage(ref)
    expect(stored.data.byteLength).toBeGreaterThan(0)
    expect(stored.ref.mediaType).toBe('image/png')
  })

  it('reports PRODUCT_FAILURE when expect_text is missing', async () => {
    const { ctx, call } = await harness({})
    const { url } = await serve(pageHandler)
    const result = await call({ action: 'goto', url, expect_text: 'never rendered' }, agent(ctx, 'sess-product'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PRODUCT_FAILURE')
  })

  it('reports INFRA_FAILURE when the target is unreachable', async () => {
    const { ctx, call } = await harness({})
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 'sess-unreachable'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('reports INFRA_FAILURE when navigation times out', async () => {
    const { ctx, call } = await harness({ gotoTimeoutMs: 800 })
    const { url } = await serve(() => { /* never responds */ })
    const result = await call({ action: 'goto', url }, agent(ctx, 'sess-timeout'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('reports POLICY_FAILURE when a redirect lands on file://', async () => {
    const { ctx, call } = await harness({})
    const { url } = await serve((res) => {
      res.writeHead(302, { Location: 'file:///etc/hosts' })
      res.end()
    })
    const result = await call({ action: 'goto', url }, agent(ctx, 'sess-redirect'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('POLICY_FAILURE')
  })

  it('closes the session page on session disposal', async () => {
    const { ctx, call } = await harness({})
    const { url } = await serve(pageHandler)
    const owner = agent(ctx, 'sess-dispose')
    await call({ action: 'goto', url }, owner)

    ctx.emit('session/disposed', (owner as { session: object }).session as never)
    await new Promise(resolve => setTimeout(resolve, 300))

    const listed = await call({ action: 'list' }, owner)
    expect(text(listed)).toContain('no live page')
  })
})
