/**
 * Manager lifecycle tests over stubbed launcher/resolver seams: lazy launch,
 * per-session pages, idempotent close, and disposal closure. No real browser
 * is needed.
 */

import { describe, expect, it, vi } from 'vitest'
import { BrowserManager, launchHeadlessChromium } from '../src/manager.ts'

vi.mock('playwright-core', () => ({
  chromium: { launch: vi.fn() },
}))

import { chromium } from 'playwright-core'

// oxlint-disable-next-line typescript/unbound-method -- the mocked factory fn is standalone; binding is irrelevant.
const launchMock = vi.mocked(chromium.launch)

function pageStub(behavior: { close?: () => Promise<void> } = {}): never {
  const page = {
    close: behavior.close ?? (async () => {}),
  }
  return page as never
}

function browserStub(options: {
  connected?: boolean
  newPage?: () => Promise<unknown>
  close?: () => Promise<void>
} = {}): never {
  let connected = options.connected ?? true
  const browser = {
    isConnected: () => connected,
    newPage: options.newPage ?? (async () => pageStub()),
    close: async () => {
      connected = false
      if (options.close !== undefined) await options.close()
    },
  }
  return browser as never
}

describe('launchHeadlessChromium', () => {
  it('launches headless Chromium on the resolved executable', async () => {
    launchMock.mockResolvedValueOnce(browserStub())
    const browser = await launchHeadlessChromium('/fake/chrome')
    expect(browser).toBeDefined()
    expect(launchMock).toHaveBeenCalledWith({ headless: true, executablePath: '/fake/chrome' })
  })
})

describe('BrowserManager', () => {
  it('launches lazily on first use and reuses the session page', async () => {
    const page = pageStub()
    let launches = 0
    const manager = new BrowserManager(
      async () => {
        launches++
        return browserStub({ newPage: async () => page })
      },
      () => '/fake/chrome',
    )
    expect(manager.has('s1')).toBe(false)
    const first = await manager.pageFor('s1')
    expect(first).toBe(page)
    expect(manager.has('s1')).toBe(true)
    expect(await manager.pageFor('s1')).toBe(page)
    expect(launches).toBe(1)
  })

  it('relaunches after the browser disconnects', async () => {
    const state = { connected: false }
    let launches = 0
    const manager = new BrowserManager(
      async () => {
        launches++
        return {
          isConnected: () => state.connected,
          newPage: async () => pageStub(),
          close: async () => { state.connected = false },
        } as never
      },
      () => '/fake/chrome',
    )
    await manager.pageFor('s1')
    state.connected = true
    await manager.pageFor('s2')
    expect(launches).toBe(1)
    state.connected = false
    await manager.pageFor('s3')
    expect(launches).toBe(2)
  })

  it('throws when no executable resolves', async () => {
    const manager = new BrowserManager(async () => browserStub(), () => undefined)
    await expect(manager.pageFor('s1')).rejects.toThrow('no Chromium executable')
  })

  it('propagates a launch failure', async () => {
    const manager = new BrowserManager(
      async () => { throw new Error('launch exploded') },
      () => '/fake/chrome',
    )
    await expect(manager.pageFor('s1')).rejects.toThrow('launch exploded')
  })

  it('propagates a page-creation failure', async () => {
    const manager = new BrowserManager(
      async () => browserStub({ newPage: async () => { throw new Error('newPage exploded') } }),
      () => '/fake/chrome',
    )
    await expect(manager.pageFor('s1')).rejects.toThrow('newPage exploded')
  })

  it('closes one session page and forgets the session', async () => {
    const close = vi.fn(async () => {})
    const page = pageStub({ close })
    const manager = new BrowserManager(
      async () => browserStub({ newPage: async () => page }),
      () => '/fake/chrome',
    )
    await manager.pageFor('s1')
    await manager.close('s1')
    expect(close).toHaveBeenCalledTimes(1)
    expect(manager.has('s1')).toBe(false)
  })

  it('tolerates a failing page close', async () => {
    const page = pageStub({ close: async () => { throw new Error('close exploded') } })
    const manager = new BrowserManager(
      async () => browserStub({ newPage: async () => page }),
      () => '/fake/chrome',
    )
    await manager.pageFor('s1')
    await expect(manager.close('s1')).resolves.toBeUndefined()
    expect(manager.has('s1')).toBe(false)
  })

  it('closing an unknown session is a no-op', async () => {
    const manager = new BrowserManager(async () => browserStub(), () => '/fake/chrome')
    await expect(manager.close('missing')).resolves.toBeUndefined()
  })

  it('closeAll closes every page and the browser', async () => {
    const closePages = vi.fn(async () => {})
    const closeBrowser = vi.fn(async () => {})
    const manager = new BrowserManager(
      async () => browserStub({ newPage: async () => pageStub({ close: closePages }), close: closeBrowser }),
      () => '/fake/chrome',
    )
    await manager.pageFor('s1')
    await manager.pageFor('s2')
    await manager.closeAll()
    expect(closePages).toHaveBeenCalledTimes(2)
    expect(closeBrowser).toHaveBeenCalledTimes(1)
    expect(manager.has('s1')).toBe(false)
    expect(manager.has('s2')).toBe(false)
  })

  it('tolerates a failing browser close and forgets the browser', async () => {
    const manager = new BrowserManager(
      async () => browserStub({ close: async () => { throw new Error('browser close exploded') } }),
      () => '/fake/chrome',
    )
    await manager.pageFor('s1')
    await expect(manager.closeAll()).resolves.toBeUndefined()
    await expect(manager.closeAll()).resolves.toBeUndefined()
  })
})
