/**
 * Per-session browser manager for the `browser` tool: one headless Chromium
 * page per owning session, launched lazily on first use and closed when the
 * session disposes or the plugin unloads. The launcher and executable resolver
 * are module seams with production defaults so every failure path is testable
 * without a real browser.
 * @module @deepseek-ai/dsh-tool-browser/manager
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { resolveBrowserExecutable } from './policy.ts'

/** Launch one headless Chromium on the resolved executable. */
export async function launchHeadlessChromium(executablePath: string): Promise<Browser> {
  return chromium.launch({ headless: true, executablePath })
}

/** Browser launcher seam. */
export type BrowserLauncher = (executablePath: string) => Promise<Browser>

/** Chromium executable resolver seam. */
export type ExecutableResolver = () => string | undefined

/** One owned browser session: the page plus its owning session id. */
export interface BrowserSession {
  sessionId: string
  page: Page
}

/**
 * The browser manager: lazily launches one Chromium per plugin, opens one
 * page per session, and guarantees closure on session/plugin disposal.
 */
export class BrowserManager {
  private sessions = new Map<string, BrowserSession>()
  private browser: Browser | undefined
  private readonly launch: BrowserLauncher
  private readonly resolveExecutable: ExecutableResolver

  /**
   * @param launch - browser launcher (defaults to headless Chromium).
   * @param resolveExecutable - executable resolver (defaults to the policy resolver).
   */
  constructor(
    launch: BrowserLauncher = launchHeadlessChromium,
    resolveExecutable: ExecutableResolver = resolveBrowserExecutable,
  ) {
    this.launch = launch
    this.resolveExecutable = resolveExecutable
  }

  /** Whether the session has a live page. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * The session's page, launching the browser on first use.
   * @param sessionId - the owning session id.
   * @returns the session's live page.
   */
  async pageFor(sessionId: string): Promise<Page> {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return existing.page
    if (this.browser === undefined || !this.browser.isConnected()) {
      const executablePath = this.resolveExecutable()
      if (executablePath === undefined) {
        throw new Error('browser: no Chromium executable found; set DSH_BROWSER_EXECUTABLE')
      }
      this.browser = await this.launch(executablePath)
    }
    const page = await this.browser.newPage()
    this.sessions.set(sessionId, { sessionId, page })
    return page
  }

  /**
   * Close one session's page, tolerating page-level failures.
   * @param sessionId - the owning session id.
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    await session.page.close().catch(() => {})
    this.sessions.delete(sessionId)
  }

  /** Close every session page and the browser, tolerating failures. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)))
    if (this.browser !== undefined) {
      await this.browser.close().catch(() => {})
      this.browser = undefined
    }
  }
}
