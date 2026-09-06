/**
 * Pure policy tests: URL allowlist, screenshot name confinement, navigation
 * error classification, Chromium executable resolution, and deadlines. No
 * browser is needed — every branch is deterministic.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SCREENSHOT_NAME_MAX_LENGTH,
  classifyBrowserError,
  isAllowedScheme,
  resolveBrowserExecutable,
  resolveExecutablePath,
  sanitizeScreenshotName,
  validateBrowserUrl,
  withDeadline,
} from '../src/policy.ts'

const scratchDirs: string[] = []
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratchFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-browser-policy-'))
  scratchDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, 'x')
  return path
}

describe('validateBrowserUrl', () => {
  it('allows http and https targets', () => {
    expect(validateBrowserUrl('http://127.0.0.1:8080/').protocol).toBe('http:')
    expect(validateBrowserUrl('https://example.com/a?b=1').protocol).toBe('https:')
  })

  it('normalizes an uppercase scheme', () => {
    expect(validateBrowserUrl('HTTP://example.com').protocol).toBe('http:')
  })

  it('rejects unparseable input', () => {
    expect(() => validateBrowserUrl('not a url')).toThrow('invalid URL')
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hello',
    'ftp://example.com',
    'about:blank',
    'chrome://settings',
  ])('rejects the disallowed scheme %s', (input) => {
    expect(() => validateBrowserUrl(input)).toThrow('unsupported URL scheme')
  })

  it('rejects embedded credentials', () => {
    expect(() => validateBrowserUrl('http://user:pass@127.0.0.1/')).toThrow('credentials in URLs are not allowed')
  })
})

describe('isAllowedScheme', () => {
  it('accepts exactly http and https', () => {
    expect(isAllowedScheme('http:')).toBe(true)
    expect(isAllowedScheme('https:')).toBe(true)
    expect(isAllowedScheme('file:')).toBe(false)
    expect(isAllowedScheme('data:')).toBe(false)
  })
})

describe('sanitizeScreenshotName', () => {
  it('accepts plain file names', () => {
    expect(sanitizeScreenshotName('a.png')).toBe('a.png')
    expect(sanitizeScreenshotName('page-1.png')).toBe('page-1.png')
    expect(sanitizeScreenshotName('x'.repeat(SCREENSHOT_NAME_MAX_LENGTH))).toHaveLength(SCREENSHOT_NAME_MAX_LENGTH)
  })

  it.each(['', '.', '..', '../x.png', 'a/b.png', 'a\\b.png', 'a:b.png', '/abs.png'])(
    'rejects the unsafe name %s',
    (name) => {
      expect(() => sanitizeScreenshotName(name)).toThrow('single file name')
    },
  )

  it('rejects an oversized name', () => {
    expect(() => sanitizeScreenshotName('x'.repeat(SCREENSHOT_NAME_MAX_LENGTH + 1))).toThrow('single file name')
  })
})

describe('classifyBrowserError', () => {
  it.each([
    'net::ERR_UNSAFE_REDIRECT',
    'net::ERR_UNSUPPORTED_SCHEME',
    'net::ERR_DISALLOWED_URL_SCHEME',
  ])('classifies %s as POLICY_FAILURE', (message) => {
    expect(classifyBrowserError(new Error(`page.goto: ${message}`))).toBe('POLICY_FAILURE')
  })

  it.each([
    'Timeout 30000ms exceeded',
    'net::ERR_CONNECTION_REFUSED',
    'browser: operation aborted',
    'browser: operation timed out',
    'some unexpected crash',
  ])('classifies %s as INFRA_FAILURE', (message) => {
    expect(classifyBrowserError(new Error(message))).toBe('INFRA_FAILURE')
  })

  it('classifies non-Error values as INFRA_FAILURE', () => {
    expect(classifyBrowserError(42)).toBe('INFRA_FAILURE')
  })
})

describe('resolveExecutablePath', () => {
  it('prefers an existing env override', () => {
    const env = scratchFile('chrome')
    expect(resolveExecutablePath(env, [], [])).toBe(env)
  })

  it('skips a nonexistent env override and falls through to the cache', () => {
    const cache = mkdtempSync(join(tmpdir(), 'dsh-browser-cache-'))
    scratchDirs.push(cache)
    mkdirSync(join(cache, 'chromium-1234', 'chrome-linux'), { recursive: true })
    const executable = join(cache, 'chromium-1234', 'chrome-linux', 'chrome')
    writeFileSync(executable, 'x')
    expect(resolveExecutablePath(join(cache, 'missing'), [cache], [])).toBe(executable)
  })

  it('finds the macOS arm64 candidate', () => {
    const cache = mkdtempSync(join(tmpdir(), 'dsh-browser-cache-'))
    scratchDirs.push(cache)
    const executable = join(
      cache,
      'chromium-1234',
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    )
    mkdirSync(join(executable, '..'), { recursive: true })
    writeFileSync(executable, 'x')
    expect(resolveExecutablePath(undefined, [cache], [])).toBe(executable)
  })

  it('finds the macOS intel candidate', () => {
    const cache = mkdtempSync(join(tmpdir(), 'dsh-browser-cache-'))
    scratchDirs.push(cache)
    const executable = join(cache, 'chromium-1234', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    mkdirSync(join(executable, '..'), { recursive: true })
    writeFileSync(executable, 'x')
    expect(resolveExecutablePath(undefined, [cache], [])).toBe(executable)
  })

  it('finds the Windows candidate', () => {
    const cache = mkdtempSync(join(tmpdir(), 'dsh-browser-cache-'))
    scratchDirs.push(cache)
    const executable = join(cache, 'chromium-1234', 'chrome-win', 'chrome.exe')
    mkdirSync(join(executable, '..'), { recursive: true })
    writeFileSync(executable, 'x')
    expect(resolveExecutablePath(undefined, [cache], [])).toBe(executable)
  })

  it('skips non-chromium cache entries and empty caches', () => {
    const cache = mkdtempSync(join(tmpdir(), 'dsh-browser-cache-'))
    scratchDirs.push(cache)
    mkdirSync(join(cache, 'ffmpeg-1011'))
    writeFileSync(join(cache, 'INSTALLATION_COMPLETE'), 'x')
    expect(resolveExecutablePath(undefined, [cache], [])).toBe(undefined)
  })

  it('skips a nonexistent cache directory', () => {
    expect(resolveExecutablePath(undefined, [join(tmpdir(), 'no-such-cache-dir')], [])).toBe(undefined)
  })

  it('tolerates a cache directory that is actually a file', () => {
    const bogus = scratchFile('cache-file')
    expect(resolveExecutablePath(undefined, [bogus], [])).toBe(undefined)
  })

  it('falls through to system candidates', () => {
    const system = scratchFile('system-chrome')
    expect(resolveExecutablePath(undefined, [], [system])).toBe(system)
  })

  it('falls through a nonexistent system candidate', () => {
    expect(resolveExecutablePath(undefined, [], [join(tmpdir(), 'no-such-system-chrome')])).toBe(undefined)
  })

  it('returns undefined when nothing exists', () => {
    expect(resolveExecutablePath(undefined, [], [])).toBe(undefined)
  })
})

describe('resolveBrowserExecutable', () => {
  const previous = process.env.DSH_BROWSER_EXECUTABLE
  afterEach(() => {
    if (previous === undefined) delete process.env.DSH_BROWSER_EXECUTABLE
    else process.env.DSH_BROWSER_EXECUTABLE = previous
  })

  it('returns a string or undefined with no env override', () => {
    delete process.env.DSH_BROWSER_EXECUTABLE
    const resolved = resolveBrowserExecutable()
    expect(resolved === undefined || typeof resolved === 'string').toBe(true)
  })

  it('returns an existing env override', () => {
    process.env.DSH_BROWSER_EXECUTABLE = process.execPath
    expect(resolveBrowserExecutable()).toBe(process.execPath)
  })

  it('falls through when the env override does not exist', () => {
    process.env.DSH_BROWSER_EXECUTABLE = join(tmpdir(), 'definitely-not-a-browser')
    const resolved = resolveBrowserExecutable()
    expect(resolved === undefined || typeof resolved === 'string').toBe(true)
  })
})

describe('withDeadline', () => {
  it('resolves with the operation result', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 1000, undefined)).resolves.toBe('ok')
  })

  it('rejects on deadline', async () => {
    await expect(withDeadline(new Promise(() => {}), 20, undefined)).rejects.toThrow('timed out')
  })

  it('rejects on an abort after start', async () => {
    const controller = new AbortController()
    const pending = withDeadline(new Promise(() => {}), 1000, controller.signal)
    const rejection = expect(pending).rejects.toThrow('aborted')
    controller.abort()
    await rejection
  })

  it('rejects immediately on a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(withDeadline(Promise.resolve('late'), 1000, controller.signal)).rejects.toThrow('aborted')
  })

  it('propagates the operation rejection', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 1000, undefined)).rejects.toThrow('boom')
  })
})
