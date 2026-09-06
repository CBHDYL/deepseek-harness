/**
 * Pure browser-verification policy helpers: URL allowlisting, screenshot name
 * confinement, navigation-error classification, Chromium executable
 * resolution, and cooperative deadlines. Everything here is deterministic and
 * unit-testable without a browser.
 * @module @deepseek-ai/dsh-tool-browser/policy
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Maximum accepted length for a model-supplied screenshot file name. */
export const SCREENSHOT_NAME_MAX_LENGTH = 80

/** Navigation failures that are policy denials, not infrastructure failures. */
const POLICY_ERROR_MARKERS = [
  'net::ERR_UNSAFE_REDIRECT',
  'net::ERR_UNSUPPORTED_SCHEME',
  'net::ERR_DISALLOWED_URL_SCHEME',
] as const

/**
 * Validate a `goto` target: parseable URL, http(s) scheme only, no embedded
 * credentials. Rejects `file:`/`data:`/`javascript:`/custom schemes so the
 * model cannot turn the browser into a local-file reader or a script sink.
 * Loopback and private targets remain reachable (a personal-UI-verification
 * tool must be able to load a local dev server).
 * @param input - the model-supplied URL string.
 * @returns the parsed URL.
 */
export function validateBrowserUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`browser: invalid URL "${input}"`)
  }
  if (!isAllowedScheme(url.protocol)) {
    throw new Error(`browser: unsupported URL scheme "${url.protocol}" (only http and https are allowed)`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('browser: credentials in URLs are not allowed')
  }
  return url
}

/** Whether one URL protocol is permitted for browser navigation. */
export function isAllowedScheme(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

/**
 * Force a model-supplied screenshot name to a single file name so it cannot
 * escape the bounded screenshot directory via path separators, `:`, traversal,
 * or an oversized name.
 * @param name - the model-supplied file name.
 * @returns the validated name.
 */
export function sanitizeScreenshotName(name: string): string {
  if (name.length === 0 || name.length > SCREENSHOT_NAME_MAX_LENGTH
    || name === '.' || name === '..'
    || name.includes('/') || name.includes('\\') || name.includes(':')) {
    throw new Error('browser: screenshot_name must be a single file name up to 80 characters (no path separators, ":", or "..")')
  }
  return name
}

/**
 * Classify one browser operation failure. Only navigation errors that mean the
 * target itself was policy-disallowed become `POLICY_FAILURE`; everything else
 * (timeouts, connection failures, crashes) is `INFRA_FAILURE` so a browser
 * failure is never misattributed to the product under test.
 * @param error - the caught failure.
 * @returns the outcome class.
 */
export function classifyBrowserError(error: unknown): 'POLICY_FAILURE' | 'INFRA_FAILURE' {
  const message = error instanceof Error ? error.message : String(error)
  return POLICY_ERROR_MARKERS.some(marker => message.includes(marker)) ? 'POLICY_FAILURE' : 'INFRA_FAILURE'
}

/** Chromium executable candidates under one Playwright browser cache. */
const CACHE_CANDIDATES = [
  (dir: string) => join(dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  (dir: string) => join(dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  (dir: string) => join(dir, 'chrome-linux', 'chrome'),
  (dir: string) => join(dir, 'chrome-win', 'chrome.exe'),
] as const

/** System browser candidates checked after the Playwright caches. */
const SYSTEM_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
] as const

/**
 * Resolve a usable Chromium executable from an explicit env override, one or
 * more Playwright browser cache directories, or system browsers. Pure over its
 * inputs so every branch is unit-testable without a browser.
 * @param envValue - `DSH_BROWSER_EXECUTABLE` value, when set.
 * @param cacheDirs - Playwright browser cache directories, in priority order.
 * @param systemPaths - system browser executable candidates, in order.
 * @returns the first existing executable, or undefined.
 */
export function resolveExecutablePath(
  envValue: string | undefined,
  cacheDirs: readonly string[],
  systemPaths: readonly string[],
): string | undefined {
  if (envValue !== undefined && existsSync(envValue)) return envValue
  for (const cacheDir of cacheDirs) {
    let entries: string[]
    try {
      if (!existsSync(cacheDir)) continue
      entries = readdirSync(cacheDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('chromium-')) continue
      for (const candidate of CACHE_CANDIDATES) {
        const path = candidate(join(cacheDir, entry))
        if (existsSync(path)) return path
      }
    }
  }
  for (const path of systemPaths) {
    if (existsSync(path)) return path
  }
  return undefined
}

/**
 * Production executable resolution: `DSH_BROWSER_EXECUTABLE`, then the
 * platform Playwright caches, then system browsers.
 * @returns the first existing executable, or undefined when no browser exists.
 */
export function resolveBrowserExecutable(): string | undefined {
  return resolveExecutablePath(
    process.env.DSH_BROWSER_EXECUTABLE,
    [
      join(homedir(), 'Library', 'Caches', 'ms-playwright'),
      join(homedir(), '.cache', 'ms-playwright'),
    ],
    SYSTEM_CANDIDATES,
  )
}

/**
 * Settle one promise under a cooperative deadline and an optional abort
 * signal, whichever fires first. The caller keeps ownership of the underlying
 * operation; the handlers attached here observe any late settle after the
 * race resolves, so it never surfaces as an unhandled rejection.
 * @param promise - the operation.
 * @param timeoutMs - deadline in milliseconds.
 * @param signal - optional caller cancellation.
 * @returns the operation's result.
 */
export function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('browser: operation aborted'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('browser: operation aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('browser: operation timed out'))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
