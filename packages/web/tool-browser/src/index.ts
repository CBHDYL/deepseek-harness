/**
 * Model-facing `browser` tool: smoke-level page automation and verification
 * over one headless Chromium page per session — goto, read_text, click, fill,
 * screenshot, close, list. Every result carries one of four outcome classes
 * (PASS / PRODUCT_FAILURE / INFRA_FAILURE / POLICY_FAILURE) so consumers can
 * tell the product failing from the browser failing from a policy denial.
 * Screenshots land in the bounded screenshot directory AND, when the
 * attachment service is mounted, as durable session-authorized attachment
 * references. The page (and its browser) closes when the owning session
 * disposes or the plugin unloads. The capability only produces verification
 * evidence: it never approves, promotes, or repairs anything.
 * @module @deepseek-ai/dsh-tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Page } from 'playwright-core'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager } from './manager.ts'
import {
  classifyBrowserError,
  isAllowedScheme,
  sanitizeScreenshotName,
  validateBrowserUrl,
  withDeadline,
} from './policy.ts'
import type { BrowserScreenshotAttachment, BrowserVerificationEvidence } from './types.ts'
// Type-only: keeps the merged SessionEventMap/SessionProjectionMap faces on the
// emitted declarations so aggregate programs see the `browser/verify` event and
// the `browserVerify` projection key.
export type * from './types.ts'

export const name = 'tool-browser'
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

/** Model-facing browser tool configuration. */
export interface Config {
  /** Directory for screenshots (default: the OS temp dir under `dsh-browser`). */
  screenshotDir?: string
  /** `goto` navigation timeout in ms (default 30000). */
  gotoTimeoutMs?: number
  /** Screenshot/read timeout in ms (default 10000). */
  actionTimeoutMs?: number
  /** Cap on visible text returned by one call (default 8000). */
  maxTextChars?: number
}

/** Schemastery configuration for the browser tool consumer. */
export const Config: z<Config> = z.object({
  screenshotDir: z.string().default(''),
  gotoTimeoutMs: z.number().min(1).default(30000),
  actionTimeoutMs: z.number().min(1).default(10000),
  maxTextChars: z.number().min(1).default(8000),
})

/** Complete config after defaults are resolved. */
export interface ResolvedConfig {
  screenshotDir: string
  gotoTimeoutMs: number
  actionTimeoutMs: number
  maxTextChars: number
}

/** The closed action vocabulary. */
export type BrowserAction = 'goto' | 'read_text' | 'click' | 'fill' | 'screenshot' | 'close' | 'list'

/** The four-class verification outcome taxonomy. */
export type BrowserOutcome = 'PASS' | 'PRODUCT_FAILURE' | 'INFRA_FAILURE' | 'POLICY_FAILURE'

const ACTIONS = ['goto', 'read_text', 'click', 'fill', 'screenshot', 'close', 'list'] as const
const OUTCOMES = ['PASS', 'PRODUCT_FAILURE', 'INFRA_FAILURE', 'POLICY_FAILURE'] as const

/** Canonical result value declared by the tool output schema. */
export interface BrowserResultValue {
  outcome: BrowserOutcome
  reason?: string
  url?: string
  title?: string
  text?: string
  truncated?: boolean
  text_length?: number
  screenshot_path?: string
  attachment?: BrowserScreenshotAttachment
  pages?: Array<{ url: string }>
}

/** Validated tool arguments. */
export interface BrowserToolArgs {
  action: BrowserAction
  url?: string
  expect_text?: string
  selector?: string
  value?: string
  viewport?: { width: number; height: number }
  screenshot_name?: string
}

/**
 * Resolve config defaults into the complete form the tool consumes.
 * @param config - the plugin config after schemastery validation.
 * @returns the resolved configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    screenshotDir: config.screenshotDir === undefined || config.screenshotDir === ''
      ? join(tmpdir(), 'dsh-browser')
      : config.screenshotDir,
    gotoTimeoutMs: config.gotoTimeoutMs ?? 30000,
    actionTimeoutMs: config.actionTimeoutMs ?? 10000,
    maxTextChars: config.maxTextChars ?? 8000,
  }
}

/** One outcome-class result with a reason. */
function withReason(outcome: BrowserOutcome, reason: string): BrowserResultValue {
  return { outcome, reason }
}

/** One policy denial as a result. */
function policyFailure(error: unknown): BrowserResultValue {
  /* v8 ignore next -- URL/name validators throw Error instances; the String fallback guards a hypothetical non-Error throw. */
  return withReason('POLICY_FAILURE', error instanceof Error ? error.message : String(error))
}

/** Map one caught browser failure to its outcome class. */
function infraOrPolicy(error: unknown): BrowserResultValue {
  // v8 ignore next -- non-Error rejections are wrapped into Error by withDeadline before classification.
  const reason = error instanceof Error ? error.message : String(error)
  return classifyBrowserError(error) === 'POLICY_FAILURE'
    ? withReason('POLICY_FAILURE', reason)
    : withReason('INFRA_FAILURE', reason)
}

/** Bound visible text to the configured cap, reporting the full length. */
function boundText(text: string, config: ResolvedConfig): { text: string; truncated: boolean; text_length: number } {
  return text.length > config.maxTextChars
    ? { text: text.slice(0, config.maxTextChars), truncated: true, text_length: text.length }
    : { text, truncated: false, text_length: text.length }
}

/** The protocol of one absolute URL string, or the empty string when unparseable. */
function protocolOf(url: string): string {
  try {
    return new URL(url).protocol
  } catch {
    return ''
  }
}

/**
 * Compact the result into one durable evidence record. Page text stays in the
 * tool result; the evidence record keeps the attributable facts consumers
 * need, so the session log never doubles bounded text.
 * @param action - the action that produced the result.
 * @param value - the classified result.
 * @returns the evidence record.
 */
function toEvidence(action: BrowserAction, value: BrowserResultValue): BrowserVerificationEvidence {
  const evidence: BrowserVerificationEvidence = { action, outcome: value.outcome }
  if (value.reason !== undefined) evidence.reason = value.reason
  if (value.url !== undefined) evidence.url = value.url
  if (value.title !== undefined) evidence.title = value.title
  if (value.truncated !== undefined) evidence.truncated = value.truncated
  if (value.text_length !== undefined) evidence.text_length = value.text_length
  if (value.screenshot_path !== undefined) evidence.screenshot_path = value.screenshot_path
  if (value.attachment !== undefined) evidence.attachment = value.attachment
  return evidence
}

/** The `browserVerify` projection state schema: one evidence record or null. */
// zod `.optional()` types the key `string | undefined` while the domain says
// `reason?: string`; on the JSON wire the two serialize identically (absent),
// so the cast records exactly that exactOptionalPropertyTypes widening (the
// permission-presets Wire<T> precedent).
const browserVerifyStateSchema = zod.union([
  zod.object({
    action: zod.union([
      zod.literal('goto'), zod.literal('read_text'), zod.literal('click'), zod.literal('fill'),
      zod.literal('screenshot'), zod.literal('close'), zod.literal('list'),
    ]),
    outcome: zod.union([zod.literal('PASS'), zod.literal('PRODUCT_FAILURE'), zod.literal('INFRA_FAILURE'), zod.literal('POLICY_FAILURE')]),
    reason: zod.string().optional(),
    url: zod.string().optional(),
    title: zod.string().optional(),
    truncated: zod.boolean().optional(),
    text_length: zod.number().optional(),
    screenshot_path: zod.string().optional(),
    attachment: zod.object({
      attachmentId: zod.string(),
      mediaType: zod.string(),
      width: zod.number(),
      height: zod.number(),
      bytes: zod.number(),
    }).optional(),
  }),
  zod.null(),
]) as unknown as zod.ZodType<BrowserVerificationEvidence | null>

/** Navigate the session page to an allowlisted URL, optionally asserting visible text. */
async function runGoto(
  manager: BrowserManager,
  config: ResolvedConfig,
  sessionId: string,
  signal: AbortSignal,
  args: BrowserToolArgs,
): Promise<BrowserResultValue> {
  if (args.url === undefined) throw new Error('browser: goto requires url')
  let target: URL
  try {
    target = validateBrowserUrl(args.url)
  } catch (error) {
    return policyFailure(error)
  }
  let page: Page
  try {
    page = await manager.pageFor(sessionId)
  } catch (error) {
    return infraOrPolicy(error)
  }
  if (args.viewport !== undefined) {
    if (!Number.isInteger(args.viewport.width) || !Number.isInteger(args.viewport.height)
      || args.viewport.width < 1 || args.viewport.height < 1) {
      throw new Error('browser: viewport width and height must be positive integers')
    }
    try {
      await withDeadline(
        page.setViewportSize({ width: args.viewport.width, height: args.viewport.height }),
        config.actionTimeoutMs,
        signal,
      )
    } catch (error) {
      return infraOrPolicy(error)
    }
  }
  try {
    await withDeadline(
      page.goto(target.toString(), { waitUntil: 'load', timeout: config.gotoTimeoutMs }),
      config.gotoTimeoutMs + config.actionTimeoutMs,
      signal,
    )
  } catch (error) {
    return infraOrPolicy(error)
  }
  const finalUrl = page.url()
  if (!isAllowedScheme(protocolOf(finalUrl))) {
    await manager.close(sessionId)
    return withReason('POLICY_FAILURE', `browser: navigation ended at disallowed scheme "${protocolOf(finalUrl)}"`)
  }
  const value: BrowserResultValue = { outcome: 'PASS', url: finalUrl }
  try {
    value.title = await withDeadline(page.title(), config.actionTimeoutMs, signal)
  } catch (error) {
    return infraOrPolicy(error)
  }
  if (args.expect_text === undefined) return value
  const expected = args.expect_text.trim()
  if (expected.length === 0) throw new Error('browser: expect_text must be a non-empty string')
  let text: string
  try {
    text = await withDeadline(page.locator('body').innerText(), config.actionTimeoutMs, signal)
  } catch (error) {
    return infraOrPolicy(error)
  }
  if (!text.includes(expected)) {
    return {
      outcome: 'PRODUCT_FAILURE',
      reason: `expected text ${JSON.stringify(expected)} not found on the page`,
      ...boundText(text, config),
    }
  }
  return Object.assign(value, boundText(text, config))
}

/** Read bounded visible text from the session page, optionally scoped to one selector. */
async function runReadText(
  manager: BrowserManager,
  config: ResolvedConfig,
  sessionId: string,
  signal: AbortSignal,
  args: BrowserToolArgs,
): Promise<BrowserResultValue> {
  let page: Page
  try {
    page = await manager.pageFor(sessionId)
  } catch (error) {
    return infraOrPolicy(error)
  }
  try {
    const text = await withDeadline(page.locator(args.selector ?? 'body').innerText(), config.actionTimeoutMs, signal)
    const value: BrowserResultValue = { outcome: 'PASS', url: page.url(), title: await page.title() }
    return Object.assign(value, boundText(text, config))
  } catch (error) {
    return infraOrPolicy(error)
  }
}

/**
 * Click one CSS selector on the session page. A failing selector or action is
 * a browser-level operation failure (INFRA_FAILURE) — click defines no
 * product expectation, so it never reports PRODUCT_FAILURE.
 */
async function runClick(
  manager: BrowserManager,
  config: ResolvedConfig,
  sessionId: string,
  signal: AbortSignal,
  args: BrowserToolArgs,
): Promise<BrowserResultValue> {
  if (args.selector === undefined || args.selector.trim().length === 0) {
    throw new Error('browser: click requires a non-empty selector')
  }
  let page: Page
  try {
    page = await manager.pageFor(sessionId)
  } catch (error) {
    return infraOrPolicy(error)
  }
  try {
    await withDeadline(page.click(args.selector, { timeout: config.actionTimeoutMs }), config.actionTimeoutMs, signal)
  } catch (error) {
    return infraOrPolicy(error)
  }
  return { outcome: 'PASS' }
}

/**
 * Fill one CSS selector with text on the session page. Like click, a failing
 * selector or action is INFRA_FAILURE — never PRODUCT_FAILURE.
 */
async function runFill(
  manager: BrowserManager,
  config: ResolvedConfig,
  sessionId: string,
  signal: AbortSignal,
  args: BrowserToolArgs,
): Promise<BrowserResultValue> {
  if (args.selector === undefined || args.selector.trim().length === 0) {
    throw new Error('browser: fill requires a non-empty selector')
  }
  if (args.value === undefined) throw new Error('browser: fill requires value')
  let page: Page
  try {
    page = await manager.pageFor(sessionId)
  } catch (error) {
    return infraOrPolicy(error)
  }
  try {
    await withDeadline(page.fill(args.selector, args.value, { timeout: config.actionTimeoutMs }), config.actionTimeoutMs, signal)
  } catch (error) {
    return infraOrPolicy(error)
  }
  return { outcome: 'PASS' }
}

/** Capture the session page into one safely named file under the bounded screenshot directory. */
async function runScreenshot(
  manager: BrowserManager,
  config: ResolvedConfig,
  getAttachments: () => AttachmentStore | undefined,
  sessionId: string,
  signal: AbortSignal,
  args: BrowserToolArgs,
): Promise<BrowserResultValue> {
  let fileName: string
  try {
    fileName = args.screenshot_name === undefined
      ? `page-${Date.now()}.png`
      : sanitizeScreenshotName(args.screenshot_name)
  } catch (error) {
    return policyFailure(error)
  }
  let page: Page
  try {
    page = await manager.pageFor(sessionId)
  } catch (error) {
    return infraOrPolicy(error)
  }
  let buffer: Buffer
  try {
    buffer = await withDeadline(page.screenshot({ fullPage: false }), config.actionTimeoutMs, signal)
  } catch (error) {
    return infraOrPolicy(error)
  }
  const path = join(config.screenshotDir, fileName)
  try {
    mkdirSync(config.screenshotDir, { recursive: true, mode: 0o700 })
    writeFileSync(path, buffer, { mode: 0o600 })
  } catch (error) {
    return infraOrPolicy(error)
  }
  const value: BrowserResultValue = { outcome: 'PASS', screenshot_path: path }
  // The attachment service is optional and may mount after this plugin applies;
  // resolve it per execution so registration never depends on activation order.
  const attachments = getAttachments()
  if (attachments !== undefined) {
    try {
      const ref = await attachments.saveImage({ data: new Uint8Array(buffer), mediaType: 'image/png', name: fileName })
      value.attachment = {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        width: ref.width,
        height: ref.height,
        bytes: ref.bytes,
      }
    } catch (error) {
      // The bounded file is already durable; attachment registration is best-effort evidence.
      return infraOrPolicy(error)
    }
  }
  return value
}

/** Close the session page; idempotent. */
async function runClose(manager: BrowserManager, sessionId: string): Promise<BrowserResultValue> {
  await manager.close(sessionId)
  return { outcome: 'PASS' }
}

/** List the session page, or nothing when no page is live. */
async function runList(manager: BrowserManager, sessionId: string): Promise<BrowserResultValue> {
  if (!manager.has(sessionId)) return { outcome: 'PASS', pages: [] }
  let page: Page
  try {
    page = await manager.pageFor(sessionId)
  } catch (error) {
    /* v8 ignore next -- reachable only when a concurrent close races this lookup, which pageFor then re-launches. */
    return infraOrPolicy(error)
  }
  return { outcome: 'PASS', pages: [{ url: page.url() }] }
}

/**
 * Render the canonical result into the model-facing text. Exported for direct
 * unit coverage of failure renderings that execution cannot reach
 * deterministically.
 * @param args - the validated arguments.
 * @param value - the canonical result value.
 * @returns the model-facing content.
 */
export function renderBrowserResult(args: BrowserToolArgs, value: BrowserResultValue): ContentBlock[] {
  const head = value.reason === undefined ? value.outcome : `${value.outcome}: ${value.reason}`
  if (args.action === 'goto') {
    const loaded = `loaded "${value.title ?? ''}" at ${value.url ?? ''}`
    return [{ type: 'text', text: `${head} — ${loaded}${value.text === undefined ? '' : `\n${value.text}`}` }]
  }
  if (args.action === 'read_text') {
    return [{ type: 'text', text: `${head}\n${value.text ?? ''}` }]
  }
  if (args.action === 'screenshot') {
    const detail = value.screenshot_path === undefined ? head : `${head} — ${value.screenshot_path}`
    return [{ type: 'text', text: value.attachment === undefined ? detail : `${detail} (attachment ${value.attachment.attachmentId})` }]
  }
  if (args.action === 'click' || args.action === 'fill') {
    return [{ type: 'text', text: head }]
  }
  if (args.action === 'close') {
    /* v8 ignore next -- manager.close is total by design, so close never renders a failure outcome. */
    return [{ type: 'text', text: value.outcome === 'PASS' ? 'PASS — page closed' : head }]
  }
  const pages = (value.pages ?? []).map(pageRow => pageRow.url).join(', ')
  return [{ type: 'text', text: `${head} — ${pages.length === 0 ? 'no live page' : pages}` }]
}

/**
 * Build the `browser` tool definition over one manager instance. Exported as a
 * factory so tests can drive every outcome class with a stubbed manager and
 * without a real browser.
 * @param manager - the per-session browser manager.
 * @param config - the resolved configuration.
 * @param getAttachments - resolves the optional attachment service at execution
 *   time; screenshots register as durable refs only when it is then available.
 * @returns the registry-ready tool definition.
 */
export function createBrowserTool(
  manager: BrowserManager,
  config: ResolvedConfig,
  getAttachments: () => AttachmentStore | undefined,
): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'browser',
    description:
      'Drive one headless Chromium page per session for smoke-level UI verification and interaction: '
      + 'goto a URL (optionally with a viewport size and asserting visible text with expect_text), '
      + 'read bounded visible text, click an element, fill an input, capture a screenshot into the '
      + 'bounded screenshot directory (also registered as a durable attachment when the attachment '
      + 'service is mounted), close the page, or list the session page. '
      + 'Every result carries an outcome class: PASS (the action and verification succeeded), '
      + 'PRODUCT_FAILURE (the page loaded but the expected content is missing), INFRA_FAILURE '
      + '(browser/network/tooling failure, including a missing click/fill selector), POLICY_FAILURE '
      + '(the request was rejected by the browser security policy — never a product failure). '
      + 'Only http and https URLs are allowed, including the final navigation target. The page and '
      + 'its browser are closed when the session ends. Requires an agent session.',
    parameters: {
      action: {
        type: 'string' as const,
        required: true,
        enum: [...ACTIONS],
        description: 'What to do with the session page.',
      },
      url: { type: 'string' as const, description: 'Target URL for goto (http or https only).' },
      expect_text: {
        type: 'string' as const,
        description: 'Text that must appear in the visible page text after goto; its absence is PRODUCT_FAILURE.',
      },
      selector: { type: 'string' as const, description: 'CSS selector for click/fill, or scoping read_text to one element.' },
      value: { type: 'string' as const, description: 'Text to fill into the selected input (fill only).' },
      viewport: {
        type: 'object',
        additionalProperties: false,
        description: 'Optional browser viewport size for goto (responsive checks).',
        properties: {
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
        },
      },
      screenshot_name: { type: 'string' as const, description: 'Optional single file name for the screenshot; defaults to a timestamp.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', required: true, enum: [...OUTCOMES] },
          reason: { type: 'string' },
          url: { type: 'string' },
          title: { type: 'string' },
          text: { type: 'string' },
          truncated: { type: 'boolean' },
          text_length: { type: 'integer' },
          screenshot_path: { type: 'string' },
          attachment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              bytes: { type: 'integer', required: true },
            },
          },
          pages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { url: { type: 'string', required: true } },
            },
          },
        },
      },
      render: renderBrowserResult,
      /* The persisted presentation payload carries the durable screenshot
       * reference for Host presenters and Client renderers to show the image
       * without parsing model-facing text. */
      presentationMeta: (_args, value) =>
        value.attachment === undefined ? null : { screenshotAttachment: value.attachment },
    },
    effects: 'side-effectful',
    timeoutMs: config.gotoTimeoutMs + config.actionTimeoutMs,
    async execute(args: BrowserToolArgs, exec): Promise<BrowserResultValue> {
      if (exec.agent === undefined) {
        throw new Error('browser: the tool requires an agent session to own the page lifecycle')
      }
      const session = exec.agent.session
      const sessionId = String(session.id)
      let value: BrowserResultValue
      switch (args.action) {
        case 'goto': value = await runGoto(manager, config, sessionId, exec.signal, args); break
        case 'read_text': value = await runReadText(manager, config, sessionId, exec.signal, args); break
        case 'click': value = await runClick(manager, config, sessionId, exec.signal, args); break
        case 'fill': value = await runFill(manager, config, sessionId, exec.signal, args); break
        case 'screenshot': value = await runScreenshot(manager, config, getAttachments, sessionId, exec.signal, args); break
        case 'close': value = await runClose(manager, sessionId); break
        case 'list': value = await runList(manager, sessionId); break
        /* v8 ignore next -- the enum-closed action switch has no other runtime case. */
        default: return assertNever(args.action, 'BrowserAction')
      }
      session.append('browser/verify', toEvidence(args.action, value))
      return value
    },
  })
}

/**
 * Install the `browser` tool and its guidance. The tool is opt-in: no shipped
 * preset enables it, so sessions that do not compose the plugin see zero
 * change.
 * @param ctx - plugin context; registrations are effects scoped to it, and the browser closes on disposal.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const manager = new BrowserManager()

  ctx.effect(() => () => { void manager.closeAll() }, 'tool-browser teardown')
  ctx.on('session/disposed', (session) => {
    void manager.close(String(session.id))
  })

  ctx.systemPrompt.section({
    name: 'tool:browser',
    order: 107,
    text: 'Use browser for quick smoke-level UI verification and interaction (load a page, read visible text, click, fill, screenshot) on one per-session headless page. For deep interaction or assertions, prefer a dedicated test harness.',
  })

  ctx.tools.register(createBrowserTool(manager, resolved, () => ctx.get('attachments')))

  // Standing evidence fold: the latest browser/verify record of the current
  // turn, cleared by the next turn/start; null before the first attempt.
  ctx.sessionProjections.register<'browserVerify', BrowserVerificationEvidence | null>({
    key: 'browserVerify',
    stateSchema: browserVerifyStateSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'browser/verify') return event.data
      if (event.type === 'turn/start') return null
      return state
    },
    wire: { viewSchema: browserVerifyStateSchema, view: state => state },
    stateVersion: 1,
  })
}
