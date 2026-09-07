/**
 * Tool-level tests over a stubbed manager: every action, every outcome class,
 * the agent requirement, and plugin registration/disposal. No real browser is
 * needed; the real-Chromium smoke lives in real-browser.spec.ts.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { BrowserManager } from '../src/manager.ts'
import * as ToolBrowserPlugin from '../src/index.ts'
import { createBrowserTool, renderBrowserResult, resolveConfig } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const scratchDirs: string[] = []
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-browser-spec-'))
  scratchDirs.push(dir)
  return dir
}

/** One fake page whose behaviors are per-test stubs. */
function stubPage(behavior: {
  goto?: (url: string) => Promise<void>
  url?: () => string
  title?: () => Promise<string>
  innerText?: (selector: string) => Promise<string>
  click?: (selector: string) => Promise<void>
  fill?: (selector: string, value: string) => Promise<void>
  setViewportSize?: (size: { width: number; height: number }) => Promise<void>
  screenshot?: () => Promise<Buffer>
  close?: () => Promise<void>
} = {}): never {
  const innerText = behavior.innerText ?? (async () => '')
  let currentUrl = 'about:blank'
  const page = {
    goto: behavior.goto ?? (async (url: string) => { currentUrl = url }),
    url: behavior.url ?? (() => currentUrl),
    title: behavior.title ?? (async () => 'Stub Page'),
    locator: (selector: string) => ({ innerText: () => innerText(selector) }),
    click: behavior.click ?? (async () => {}),
    fill: behavior.fill ?? (async () => {}),
    setViewportSize: behavior.setViewportSize ?? (async () => {}),
    screenshot: behavior.screenshot ?? (async () => Buffer.from('fake-png')),
    close: behavior.close ?? (async () => {}),
  }
  return page as never
}

/** One manager whose launcher/resolver are stubbed; records launches. */
function stubManager(options: {
  page?: never
  launchError?: Error
  resolver?: () => string | undefined
} = {}): { manager: BrowserManager; launches: () => number } {
  let launches = 0
  const page = options.page ?? stubPage()
  const manager = new BrowserManager(
    async () => {
      if (options.launchError !== undefined) throw options.launchError
      launches++
      return {
        isConnected: () => true,
        newPage: async () => page,
        close: async () => {},
      } as never
    },
    options.resolver ?? (() => '/fake/chrome'),
  )
  return { manager, launches: () => launches }
}

function agent(ctx: Context, sessionId: string, append: (type: string, data: unknown) => void = () => {}): object {
  const id = SessionId(sessionId)
  const fiber = ctx.plugin(() => {})
  return { id, ctx: fiber.ctx, session: { id, header: { version: 0, id, createdAt: 0 }, append } }
}

async function mount(
  manager: BrowserManager,
  config: Config = {},
  attachments?: unknown,
): Promise<{ ctx: Context; call: (args: object, agentRef?: object, signal?: AbortSignal) => Promise<ToolExecutionResult> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(createBrowserTool(manager, resolveConfig(config), (() => attachments) as never))
  let counter = 0
  const call = (args: object, agentRef?: object, signal?: AbortSignal) => ctx.tools.execute({
    signal: signal ?? new AbortController().signal,
    callId: ToolCallId(`call-${++counter}`),
    name: 'browser',
    arguments: args,
    ...(agentRef === undefined ? {} : { agent: agentRef as never }),
  })
  return { ctx, call }
}

const text = (result: ToolExecutionResult): string =>
  result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')

describe('browser tool (stubbed browser)', () => {
  it('goto round-trips a PASS with url and title', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PASS')
    expect(text(result)).toContain('Stub Page')
    expect(JSON.stringify(result.content)).toContain('http://127.0.0.1:1/')
  })

  it('appends one durable evidence event per classified outcome', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => 'Stub content' }) })
    const { ctx, call } = await mount(manager)
    const appends: Array<{ type: string; data: unknown }> = []
    const result = await call(
      { action: 'goto', url: 'http://127.0.0.1:1/', expect_text: 'Stub' },
      agent(ctx, 's1', (type, data) => { appends.push({ type, data }) }),
    )
    expect(result.isError).toBe(false)
    expect(appends).toEqual([{
      type: 'browser/verify',
      data: {
        action: 'goto',
        outcome: 'PASS',
        url: 'http://127.0.0.1:1/',
        title: 'Stub Page',
        truncated: false,
        text_length: 12,
      },
    }])
  })

  it('records a policy denial as evidence, not a product failure', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const appends: Array<{ type: string; data: unknown }> = []
    const result = await call(
      { action: 'goto', url: 'file:///etc/passwd' },
      agent(ctx, 's1', (type, data) => { appends.push({ type, data }) }),
    )
    expect(result.isError).toBe(false)
    expect(appends).toHaveLength(1)
    expect(appends[0]?.type).toBe('browser/verify')
    const evidence = (appends[0] as { data: Record<string, unknown> }).data
    expect(evidence).toMatchObject({ action: 'goto', outcome: 'POLICY_FAILURE' })
    expect(String(evidence.reason)).toContain('unsupported URL scheme')
  })

  it('goto with a matching expect_text returns PASS and bounded text', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => 'hello world' }) })
    const { ctx, call } = await mount(manager, { maxTextChars: 100 })
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/', expect_text: 'world' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('hello world')
  })

  it('goto with an unmet expect_text returns PRODUCT_FAILURE', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => 'hello world' }) })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/', expect_text: 'absent' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PRODUCT_FAILURE')
    expect(text(result)).toContain('not found')
  })

  it('goto with an empty expect_text is an argument error', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/', expect_text: '  ' }, agent(ctx, 's1'))
    expect(result.isError).toBe(true)
  })

  it('goto rejects disallowed schemes as POLICY_FAILURE without launching', async () => {
    const { manager, launches } = stubManager()
    const { ctx, call } = await mount(manager)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x']) {
      const result = await call({ action: 'goto', url }, agent(ctx, 's1'))
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('POLICY_FAILURE')
    }
    expect(launches()).toBe(0)
  })

  it('goto classifies a final target on a disallowed scheme as POLICY_FAILURE', async () => {
    const close = { calls: 0 }
    const { manager } = stubManager({
      page: stubPage({
        url: () => 'file:///etc/hosts',
        close: async () => { close.calls++ },
      }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('POLICY_FAILURE')
    expect(close.calls).toBe(1)
  })

  it('goto classifies an unparseable final URL as POLICY_FAILURE', async () => {
    const { manager } = stubManager({ page: stubPage({ url: () => 'not a url' }) })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('POLICY_FAILURE')
  })

  it('goto classifies an unsafe redirect as POLICY_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ goto: async () => { throw new Error('page.goto: net::ERR_UNSAFE_REDIRECT') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('POLICY_FAILURE')
  })

  it('goto classifies a transport failure as INFRA_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('goto stringifies a non-Error transport failure', async () => {
    const { manager } = stubManager({
      page: stubPage({ goto: async () => { throw 'boom' } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE: boom')
  })

  it('goto classifies launch and executable failures as INFRA_FAILURE', async () => {
    const launchFailing = stubManager({ launchError: new Error('launch exploded') })
    const launchMounted = await mount(launchFailing.manager)
    const launchResult = await launchMounted.call(
      { action: 'goto', url: 'http://127.0.0.1:1/' },
      agent(launchMounted.ctx, 's1'),
    )
    expect(launchResult.isError).toBe(false)
    expect(text(launchResult)).toContain('INFRA_FAILURE')

    const resolverFailing = stubManager({ resolver: () => undefined })
    const resolverMounted = await mount(resolverFailing.manager)
    const resolverResult = await resolverMounted.call(
      { action: 'goto', url: 'http://127.0.0.1:1/' },
      agent(resolverMounted.ctx, 's1'),
    )
    expect(resolverResult.isError).toBe(false)
    expect(text(resolverResult)).toContain('INFRA_FAILURE')
  })

  it('goto classifies a failing title fetch as INFRA_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ title: async () => { throw new Error('title exploded') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('goto classifies a failing text fetch as INFRA_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ innerText: async () => { throw new Error('innerText exploded') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/', expect_text: 'x' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('goto classifies a hanging text fetch as INFRA_FAILURE', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => new Promise(() => {}) }) })
    const { ctx, call } = await mount(manager, { actionTimeoutMs: 50 })
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/', expect_text: 'x' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('read_text returns bounded text with url and title', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => 'hello world' }) })
    const { ctx, call } = await mount(manager, { maxTextChars: 100 })
    const result = await call({ action: 'read_text' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('hello world')
  })

  it('read_text scopes to a selector', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async selector => (selector === '#b' ? 'clicked' : 'all') }) })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'read_text', selector: '#b' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('clicked')
  })

  it('read_text truncates oversized text with metadata', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => 'hello world' }) })
    const { ctx, call } = await mount(manager, { maxTextChars: 5 })
    const result = await call({ action: 'read_text' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('hello')
    expect(text(result)).not.toContain('world')
  })

  it('read_text classifies fetch failures as INFRA_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ innerText: async () => { throw new Error('innerText exploded') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'read_text' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('read_text classifies launch failures as INFRA_FAILURE', async () => {
    const { manager } = stubManager({ launchError: new Error('launch exploded') })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'read_text' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('an aborted call settles promptly instead of hanging until the deadline', async () => {
    const { manager } = stubManager({ page: stubPage({ innerText: async () => new Promise(() => {}) }) })
    const { ctx, call } = await mount(manager, { actionTimeoutMs: 5000 })
    const controller = new AbortController()
    const started = Date.now()
    const pending = call({ action: 'read_text' }, agent(ctx, 's1'), controller.signal)
    await new Promise(resolve => setTimeout(resolve, 50))
    controller.abort()
    // Caller cancellation is registry-owned (isError); the tool's cooperative
    // deadline is what lets the body settle well before the 5000ms deadline.
    const result = await pending
    expect(result.isError).toBe(true)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('screenshot saves a safely named file under the bounded directory', async () => {
    const dir = scratchDir()
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager, { screenshotDir: dir })
    const result = await call({ action: 'screenshot', screenshot_name: 'shot.png' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PASS')
    expect(readFileSync(join(dir, 'shot.png'))).toEqual(Buffer.from('fake-png'))
  })

  it('screenshot defaults the file name', async () => {
    const dir = scratchDir()
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager, { screenshotDir: dir })
    const result = await call({ action: 'screenshot' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain(join(dir, 'page-'))
  })

  it('screenshot rejects an unsafe name as POLICY_FAILURE without capturing', async () => {
    const dir = scratchDir()
    const screenshot = { calls: 0 }
    const { manager } = stubManager({
      page: stubPage({ screenshot: async () => { screenshot.calls++; return Buffer.from('fake-png') } }),
    })
    const { ctx, call } = await mount(manager, { screenshotDir: dir })
    const result = await call({ action: 'screenshot', screenshot_name: '../escape.png' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('POLICY_FAILURE')
    expect(screenshot.calls).toBe(0)
  })

  it('screenshot classifies launch failures as INFRA_FAILURE', async () => {
    const dir = scratchDir()
    const { manager } = stubManager({ launchError: new Error('launch exploded') })
    const { ctx, call } = await mount(manager, { screenshotDir: dir })
    const result = await call({ action: 'screenshot' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('screenshot classifies a capture failure as INFRA_FAILURE', async () => {
    const dir = scratchDir()
    const { manager } = stubManager({
      page: stubPage({ screenshot: async () => { throw new Error('screenshot exploded') } }),
    })
    const { ctx, call } = await mount(manager, { screenshotDir: dir })
    const result = await call({ action: 'screenshot', screenshot_name: 'shot.png' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('screenshot classifies a write failure as INFRA_FAILURE', async () => {
    const notADir = join(scratchDir(), 'file')
    writeFileSync(notADir, 'x')
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager, { screenshotDir: notADir })
    const result = await call({ action: 'screenshot', screenshot_name: 'shot.png' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('close closes the page and list reports no live page afterwards', async () => {
    const close = { calls: 0 }
    const { manager } = stubManager({ page: stubPage({ close: async () => { close.calls++ } }) })
    const { ctx, call } = await mount(manager)
    await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    const closed = await call({ action: 'close' }, agent(ctx, 's1'))
    expect(closed.isError).toBe(false)
    expect(text(closed)).toContain('page closed')
    expect(close.calls).toBe(1)
    const listed = await call({ action: 'list' }, agent(ctx, 's1'))
    expect(text(listed)).toContain('no live page')
  })

  it('close without a page is a no-op PASS', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'close' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('page closed')
  })

  it('list reports the live page url', async () => {
    const { manager } = stubManager({ page: stubPage({ url: () => 'http://127.0.0.1:1/' }) })
    const { ctx, call } = await mount(manager)
    await call({ action: 'goto', url: 'http://127.0.0.1:1/' }, agent(ctx, 's1'))
    const listed = await call({ action: 'list' }, agent(ctx, 's1'))
    expect(text(listed)).toContain('http://127.0.0.1:1/')
  })

  it('list reports no live page after a failed launch', async () => {
    const { manager } = stubManager({ launchError: new Error('launch exploded') })
    const { ctx, call } = await mount(manager)
    const listed = await call({ action: 'list' }, agent(ctx, 's1'))
    expect(text(listed)).toContain('no live page')
  })

  it('goto without a url is an argument error', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'goto' }, agent(ctx, 's1'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('goto requires url')
  })

  it('screenshot registers a durable attachment reference when the service is mounted', async () => {
    const dir = scratchDir()
    const { manager } = stubManager()
    const attachments = {
      saveImage: async (input: { data: Uint8Array; mediaType: string; name?: string }) => ({
        attachmentId: 'att-1',
        mediaType: input.mediaType,
        width: 8,
        height: 4,
        bytes: input.data.byteLength,
      }),
    }
    const { ctx, call } = await mount(manager, { screenshotDir: dir }, attachments)
    const result = await call({ action: 'screenshot', screenshot_name: 'shot.png' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('attachment att-1')
  })

  it('screenshot classifies an attachment-save failure as INFRA_FAILURE', async () => {
    const dir = scratchDir()
    const { manager } = stubManager()
    const attachments = {
      saveImage: async () => { throw new Error('attachment backend down') },
    }
    const { ctx, call } = await mount(manager, { screenshotDir: dir }, attachments)
    const result = await call({ action: 'screenshot' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('click clicks a selector and records PASS evidence', async () => {
    const clicked: string[] = []
    const { manager } = stubManager({
      page: stubPage({ click: async (selector) => { clicked.push(selector) } }),
    })
    const { ctx, call } = await mount(manager)
    const appends: Array<{ type: string; data: unknown }> = []
    const result = await call(
      { action: 'click', selector: '#b' },
      agent(ctx, 's1', (type, data) => { appends.push({ type, data }) }),
    )
    expect(result.isError).toBe(false)
    expect(clicked).toEqual(['#b'])
    expect(appends).toEqual([{ type: 'browser/verify', data: { action: 'click', outcome: 'PASS' } }])
  })

  it('click rejects an empty selector as an argument error', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'click', selector: '  ' }, agent(ctx, 's1'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('non-empty selector')
  })

  it('click classifies a failing selector as INFRA_FAILURE, never PRODUCT_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ click: async () => { throw new Error('selector not found') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'click', selector: '#missing' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
    expect(text(result)).not.toContain('PRODUCT_FAILURE')
  })

  it('click classifies launch failures as INFRA_FAILURE', async () => {
    const { manager } = stubManager({ launchError: new Error('launch exploded') })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'click', selector: '#b' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('fill fills a selector with text', async () => {
    const filled: Array<{ selector: string; value: string }> = []
    const { manager } = stubManager({
      page: stubPage({ fill: async (selector, value) => { filled.push({ selector, value }) } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'fill', selector: '#i', value: 'hello' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(filled).toEqual([{ selector: '#i', value: 'hello' }])
  })

  it('fill rejects a missing value as an argument error', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'fill', selector: '#i' }, agent(ctx, 's1'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('fill requires value')
  })

  it('fill rejects an empty selector as an argument error', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'fill', selector: ' ', value: 'x' }, agent(ctx, 's1'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('non-empty selector')
  })

  it('fill classifies launch failures as INFRA_FAILURE', async () => {
    const { manager } = stubManager({ launchError: new Error('launch exploded') })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'fill', selector: '#i', value: 'x' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('fill classifies a failing selector as INFRA_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ fill: async () => { throw new Error('selector not found') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call({ action: 'fill', selector: '#missing', value: 'x' }, agent(ctx, 's1'))
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('goto applies a requested viewport before navigation', async () => {
    const viewports: Array<{ width: number; height: number }> = []
    const { manager } = stubManager({
      page: stubPage({ setViewportSize: async (size) => { viewports.push(size) } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call(
      { action: 'goto', url: 'http://127.0.0.1:1/', viewport: { width: 375, height: 667 } },
      agent(ctx, 's1'),
    )
    expect(result.isError).toBe(false)
    expect(viewports).toEqual([{ width: 375, height: 667 }])
  })

  it('goto rejects a non-positive viewport as an argument error', async () => {
    const { manager } = stubManager()
    const { ctx, call } = await mount(manager)
    const result = await call(
      { action: 'goto', url: 'http://127.0.0.1:1/', viewport: { width: 0, height: 667 } },
      agent(ctx, 's1'),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('positive integers')
  })

  it('goto classifies a viewport failure as INFRA_FAILURE', async () => {
    const { manager } = stubManager({
      page: stubPage({ setViewportSize: async () => { throw new Error('viewport exploded') } }),
    })
    const { ctx, call } = await mount(manager)
    const result = await call(
      { action: 'goto', url: 'http://127.0.0.1:1/', viewport: { width: 375, height: 667 } },
      agent(ctx, 's1'),
    )
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('INFRA_FAILURE')
  })

  it('rejects calls without an agent', async () => {
    const { manager, launches } = stubManager()
    const { call } = await mount(manager)
    const result = await call({ action: 'goto', url: 'http://127.0.0.1:1/' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an agent')
    expect(launches()).toBe(0)
  })
})

describe('tool-browser plugin', () => {
  it('registers the tool, closes on session disposal, and cleans up on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(ToolBrowserPlugin, {})

    const registered = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-registered'),
      name: 'browser',
      arguments: { action: 'list' },
    })
    expect(registered.isError).toBe(true)
    expect(text(registered)).toContain('requires an agent')

    // Disposing a session that never used the browser is a safe no-op.
    const id = SessionId('sess-no-page')
    ctx.emit('session/disposed', { id, header: { version: 0, id, createdAt: 0 } } as never)
    await fiber.dispose()
  })
})

describe('renderBrowserResult', () => {
  it('renders a list failure without pages', () => {
    const rendered = renderBrowserResult(
      { action: 'list' },
      { outcome: 'INFRA_FAILURE', reason: 'launch exploded' },
    )
    expect(rendered[0]?.type).toBe('text')
    expect((rendered[0] as { text?: string }).text).toContain('no live page')
  })

  it('renders a screenshot failure without a path', () => {
    const rendered = renderBrowserResult(
      { action: 'screenshot' },
      { outcome: 'POLICY_FAILURE', reason: 'unsafe name' },
    )
    expect((rendered[0] as { text?: string }).text).toBe('POLICY_FAILURE: unsafe name')
  })

  it('renders a read_text result without text', () => {
    const rendered = renderBrowserResult(
      { action: 'read_text' },
      { outcome: 'INFRA_FAILURE', reason: 'boom' },
    )
    expect((rendered[0] as { text?: string }).text).toBe('INFRA_FAILURE: boom\n')
  })
})
