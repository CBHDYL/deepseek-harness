/**
 * Model-facing `browser` tool: smoke-level page automation over one headless
 * Chromium page per session — goto, screenshot, click, fill, read_text,
 * close, list. The page (and its browser) is closed when the owning session
 * disposes or the plugin unloads, so a UI-verification session never leaks a
 * browser process.
 * @module @deepseek-ai/dsh-tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager } from './manager.ts'

export const name = 'tool-browser'
export const inject = ['tools', 'systemPrompt']

/** Plugin config. */
export interface Config {
  /** Directory for screenshots (default: OS temp dir). */
  screenshotDir?: string
  /** `goto` navigation timeout in ms (default 30000). */
  gotoTimeoutMs?: number
  /** CSS selector action (`click`/`fill`/`read_text`) timeout in ms (default 10000). */
  actionTimeoutMs?: number
}

/** Runtime schema for the plugin config. */
export const Config: z<Config> = z.object({
  screenshotDir: z.string().default(''),
  gotoTimeoutMs: z.number().min(1).default(30000),
  actionTimeoutMs: z.number().min(1).default(10000),
})

/** The closed action vocabulary. */
export type BrowserAction = 'goto' | 'screenshot' | 'click' | 'fill' | 'read_text' | 'close' | 'list'

/**
 * Install the `browser` tool and its guidance.
 * @param ctx - plugin context; registrations are effects scoped to it, and the browser closes on disposal.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const screenshotDir = config.screenshotDir === undefined || config.screenshotDir === '' ? join(tmpdir(), 'dsh-browser') : config.screenshotDir
  const gotoTimeoutMs = config.gotoTimeoutMs ?? 30000
  const actionTimeoutMs = config.actionTimeoutMs ?? 10000
  const manager = new BrowserManager()

  ctx.effect(() => () => { void manager.closeAll() }, 'tool-browser teardown')
  ctx.on('session/disposed', (session) => {
    void manager.close(String(session.id))
  })

  ctx.systemPrompt.section({
    name: 'tool:browser',
    order: 107,
    text: 'Use browser for quick UI verification (smoke-level: load, screenshot, click, fill, read text) on a per-session headless page. For deep interaction or assertions, prefer a dedicated test harness.',
  })

  ctx.tools.register(defineTool({
    name: 'browser',
    description: 'Drive one headless Chromium page per session for smoke-level UI checks: goto a URL, screenshot the page, click an element, fill an input, read visible text, or close the page. The page and its browser are closed when the session ends. Requires an agent session.',
    parameters: {
      action: {
        type: 'string' as const,
        required: true,
        enum: ['goto', 'screenshot', 'click', 'fill', 'read_text', 'close', 'list'] as const,
        description: 'What to do with the session page.',
      },
      url: { type: 'string' as const, description: 'Target URL for goto (http or https only).' },
      selector: { type: 'string' as const, description: 'CSS selector for click/fill/read_text.' },
      value: { type: 'string' as const, description: 'Text to fill (fill only).' },
      screenshot_name: { type: 'string' as const, description: 'Optional file name for the screenshot; defaults to a timestamp.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string' },
          url: { type: 'string' },
          title: { type: 'string' },
          text: { type: 'string' },
          screenshot_path: { type: 'string' },
          pages: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' } } } },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderBrowserResult(args.action, value) }],
    },
    effects: 'side-effectful',
    async execute(args: BrowserToolArgs, exec): Promise<BrowserResultValue> {
      if (exec.agent === undefined) {
        throw new Error('browser: the tool requires an agent session to own the page lifecycle')
      }
      const sessionId = String(exec.agent.session.id)
      switch (args.action) {
        case 'goto': {
          if (args.url === undefined) throw new Error('browser: goto requires url')
          const target = validateBrowserUrl(args.url)
          const page = await manager.pageFor(sessionId)
          await page.goto(target.toString(), { waitUntil: 'load', timeout: gotoTimeoutMs })
          const [title, url] = await Promise.all([page.title(), page.url()])
          return { ok: true, title, url }
        }
        case 'screenshot': {
          const page = await manager.pageFor(sessionId)
          const name = sanitizeScreenshotName(args.screenshot_name ?? `page-${Date.now()}.png`)
          const path = join(screenshotDir, name)
          mkdirSync(screenshotDir, { recursive: true, mode: 0o700 })
          const buffer = await page.screenshot({ fullPage: false })
          writeFileSync(path, buffer, { mode: 0o600 })
          return { ok: true, screenshot_path: path, message: `screenshot saved to ${path}` }
        }
        case 'click': {
          if (args.selector === undefined) throw new Error('browser: click requires selector')
          const page = await manager.pageFor(sessionId)
          await page.click(args.selector, { timeout: actionTimeoutMs })
          return { ok: true, message: `clicked ${args.selector}` }
        }
        case 'fill': {
          if (args.selector === undefined || args.value === undefined) throw new Error('browser: fill requires selector and value')
          const page = await manager.pageFor(sessionId)
          await page.fill(args.selector, args.value)
          return { ok: true, message: `filled ${args.selector}` }
        }
        case 'read_text': {
          const page = await manager.pageFor(sessionId)
          const text = args.selector === undefined
            ? await page.locator('body').innerText()
            : await page.locator(args.selector).innerText()
          return { ok: true, text }
        }
        case 'close': {
          await manager.close(sessionId)
          return { ok: true, message: 'page closed' }
        }
        case 'list': {
          return manager.has(sessionId)
            ? { ok: true, pages: [{ url: await manager.pageFor(sessionId).then(p => p.url()) }] }
            : { ok: true }
        }
        default: {
          return assertNever(args.action, 'BrowserAction')
        }
      }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `browser ${args.action}`, kind: 'execute', rawInput: JSON.stringify(args), content: [] }
    },
    presentResult(args, result: { content: Array<{ type: string; text?: string }> }): GenericCallView {
      const text = result.content.find(block => block.type === 'text')?.text ?? ''
      return { card: 'generic', title: `browser ${args.action}`, kind: 'execute', rawInput: JSON.stringify(args), content: [{ type: 'text', text }] }
    },
  }))
}

/** Canonical result value declared by the tool output schema. */
interface BrowserResultValue {
  ok: boolean
  message?: string
  url?: string
  title?: string
  text?: string
  screenshot_path?: string
  pages?: Array<{ url: string }>
}

/** Validated tool arguments. */
export interface BrowserToolArgs {
  action: BrowserAction
  url?: string
  selector?: string
  value?: string
  screenshot_name?: string
}

/** One page row in a `list` result. */
interface PageRow { url?: string }

/**
 * Validate a `goto` target: only http(s), no embedded credentials. Rejects
 * `file:`/`data:`/`about:` so the model cannot turn the browser into a
 * local-file reader or a data-URL injection vector. Loopback and private
 * targets remain reachable (a personal-UI-verification tool must be able to
 * load a local dev server); the fetch provider still applies SSRF rules.
 */
function validateBrowserUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`browser: invalid URL "${input}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`browser: unsupported URL scheme "${url.protocol}" (only http and https are allowed)`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('browser: credentials in URLs are not allowed')
  }
  return url
}

/**
 * Force a model-supplied screenshot name to a single file name so it cannot
 * escape `screenshotDir` via path separators, `:`, or parent traversal.
 */
function sanitizeScreenshotName(name: string): string {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes(':')) {
    throw new Error('browser: screenshot_name must be a single file name (no path separators, ":", or "..")')
  }
  return name
}

/** Render the canonical result into the model-facing text. */
function renderBrowserResult(
  action: BrowserAction,
  value: { ok: boolean; message?: string; url?: string; title?: string; text?: string; screenshot_path?: string; pages?: PageRow[] },
): string {
  if (action === 'goto') return `loaded ${value.title ?? ''} at ${value.url ?? ''}`
  if (action === 'read_text') return value.text ?? ''
  if (action === 'list') return (value.pages ?? []).map(p => p.url).join('\n') || 'no live page'
  return value.message ?? 'ok'
}
