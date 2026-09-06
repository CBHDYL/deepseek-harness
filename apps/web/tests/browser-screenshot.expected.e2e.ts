// @vitest-environment jsdom
// Assembled browser-screenshot snapshot: boots the real built workspace client
// bundles through AppWebEntry's ModuleLoader path against the keyless fixture
// Connection RPC, opens the fixture session, and pins the thumbnail the
// `browser` tool row (fixture turn 74) renders from the result's persisted
// `screenshotAttachment` meta — the ui-attachment gallery reusing the same
// session-authorized image URL path as message images — plus the click-through
// to the original-image lightbox. Keyless and deterministic: the fixture
// serves the bytes for `fixture:image`, so no model or network is involved.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('renders the browser tool screenshot thumbnail and opens the original lightbox', async () => {
  mountAssembledApp()

  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
  const row = await waitFor(() => {
    const found = document.querySelector('[data-tool="browser"]')
    expect(found).not.toBeNull()
    return found!
  }, { timeout: 10_000 })
  // The gallery lives under the row's call cell; the message-image turns use
  // the same fixture attachment, so scope the lookup to this call. The host
  // meta carries no display name, so the localized fallback labels it.
  const callCell = row.closest('[data-chat-call-id]')
  const thumb = await waitFor(() => {
    const found = callCell?.querySelector('[data-align="start"] img')
    expect(found).not.toBeNull()
    return found!
  }, { timeout: 10_000 })
  expect(thumb.getAttribute('alt')).toBe('Image')
  // The durable reference resolves through the session-authorized URL path
  // (the same object URL the message galleries consume), never a raw URL.
  await waitFor(() => {
    expect(thumb.getAttribute('src')?.split(':')[0]).toBe('blob')
  }, { timeout: 10_000 })

  const frame = thumb.closest('button')
  if (frame === null) throw new Error('thumbnail frame button missing')
  fireEvent.click(frame)
  const dialog = await screen.findByRole('dialog')
  const preview = dialog.querySelector('img')
  expect(preview?.getAttribute('src')).toBe(thumb.getAttribute('src'))
  expect(preview?.getAttribute('alt')).toBe('Image')
})
