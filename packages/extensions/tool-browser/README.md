# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

A model-facing `browser` tool for smoke-level UI verification: one headless Chromium page per session with goto, screenshot, click, fill, read_text, close, and list. The page and its browser are closed when the owning session disposes or the plugin unloads, so a UI-check session never leaks a browser process.

## What it does

- `goto` loads a URL and reports the page title and final URL.
- `screenshot` saves a PNG to the configured directory (default OS temp) and returns its path.
- `click` / `fill` drive a CSS selector.
- `read_text` returns visible text of the whole body or one selector.
- `close` / `list` manage the per-session page.

The browser executable resolves from `DSH_BROWSER_EXECUTABLE`, the playwright browser cache, or system Chrome. Actions require an agent session (the page-lifecycle owner); agent-less calls are denied.

## Config

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
  config:
    screenshotDir: /tmp/dsh-browser   # optional; defaults to the OS temp dir
```

## Model Experience

### Page action result

#### What the model sees

Each call returns a short confirmation: the loaded title and URL, the screenshot path, a click/fill acknowledgement, the visible text, or `no live page`. Screenshot paths are absolute and usable with the describe-image tool when they fall inside the session workspace.

##### Example results

```markdown
loaded Browser Spec at http://127.0.0.1:5173/
screenshot saved to /var/folders/.../dsh-browser/page-1712345678901.png
```

#### Token effect

Result text is visible for that call and retained in history until compaction; page content is never streamed.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Smoke-level only** — no assertions, waits, or multi-page orchestration; deep interaction belongs in a dedicated test harness.
- **One page per session** — a second `goto` navigates the same page; parallel browsing is not supported.
- **Headless Chromium required** — the tool launches its own browser and is not connected to a user's existing browser.
- **Screenshots may sit outside the workspace** — the describe-image plugin's workspace guard applies to the returned path.
