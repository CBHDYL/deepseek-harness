/**
 * Per-session browser manager for the `browser` tool: one headless Chromium
 * page per owning session, launched lazily on first use, closed when the
 * session disposes or the plugin unloads. The executable resolves from
 * `DSH_BROWSER_EXECUTABLE`, the playwright browser cache, or system Chrome.
 * @module @deepseek-ai/dsh-tool-browser/manager
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One owned browser session: the page plus its current URL. */
export interface BrowserSession {
  sessionId: string
  page: Page
  url: string | undefined
}

/** Resolve a usable Chromium executable, or undefined when none is found. */
export function resolveBrowserExecutable(): string | undefined {
  const fromEnv = process.env.DSH_BROWSER_EXECUTABLE
  if (fromEnv !== undefined && existsSync(fromEnv)) return fromEnv
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (existsSync(cache)) {
    for (const name of readdirSync(cache)) {
      if (!name.startsWith('chromium-')) continue
      const arm64 = join(cache, name, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
      if (existsSync(arm64)) return arm64
      const intel = join(cache, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      if (existsSync(intel)) return intel
    }
  }
  const system = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return existsSync(system) ? system : undefined
}

/**
 * The browser manager: lazily launch per session, run page actions, and
 * guarantee closure on session/plugin disposal.
 */
export class BrowserManager {
  private sessions = new Map<string, BrowserSession>()
  private browser: Browser | undefined

  /** Whether any session has a live page. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** The session's page, launching the browser on first use. */
  async pageFor(sessionId: string): Promise<Page> {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return existing.page
    if (this.browser === undefined || !this.browser.isConnected()) {
      const executablePath = resolveBrowserExecutable()
      if (executablePath === undefined) {
        throw new Error('browser: no Chromium executable found; set DSH_BROWSER_EXECUTABLE')
      }
      this.browser = await chromium.launch({ headless: true, executablePath })
    }
    const page = await this.browser.newPage()
    this.sessions.set(sessionId, { sessionId, page, url: undefined })
    return page
  }

  /** Close one session's page. */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    await session.page.close().catch(() => {})
    this.sessions.delete(sessionId)
  }

  /** Close every session page and the browser. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)))
    if (this.browser !== undefined) {
      await this.browser.close().catch(() => {})
      this.browser = undefined
    }
  }
}
