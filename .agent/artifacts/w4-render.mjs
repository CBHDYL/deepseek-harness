import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, homedir } from 'node:path'
function resolveExecutable() {
  const env = process.env.DSH_BROWSER_EXECUTABLE
  if (env !== undefined && existsSync(env)) return env
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      if (!dir.startsWith('chromium-')) continue
      const p = join(cache, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
      if (existsSync(p)) return p
    }
  }
  return undefined
}
const out = '/Users/bohongchen/Projects/deepseek-harness/.agent/artifacts/visual-evidence'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: resolveExecutable() })
const targets = [
  { name: 'clean-desktop', url: 'http://127.0.0.1:18723/clean.html', viewport: { width: 1280, height: 800 } },
  { name: 'overlap-desktop', url: 'http://127.0.0.1:18723/defect-overlap.html', viewport: { width: 1280, height: 800 } },
  { name: 'misalign-desktop', url: 'http://127.0.0.1:18723/defect-misalign.html', viewport: { width: 1280, height: 800 } },
  { name: 'misalign-mobile', url: 'http://127.0.0.1:18723/defect-misalign.html', viewport: { width: 375, height: 667 } },
  { name: 'gui-home', url: 'http://127.0.0.1:3080', viewport: { width: 1280, height: 800 } },
]
for (const t of targets) {
  const page = await browser.newPage()
  await page.setViewportSize(t.viewport)
  try {
    await page.goto(t.url, { waitUntil: 'load', timeout: 15000 })
    await page.waitForTimeout(600)
    writeFileSync(join(out, t.name + '.png'), await page.screenshot({ fullPage: false }))
    console.log('captured', t.name)
  } catch (e) {
    console.log('FAILED', t.name, String(e).slice(0, 120))
  }
  await page.close()
}
await browser.close()
