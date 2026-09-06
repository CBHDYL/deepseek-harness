// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { toolScreenshotSource } from '../src/client/tool/models/screenshot-model.ts'

const SCREENSHOT_META = {
  screenshotAttachment: {
    attachmentId: 'fixture:image',
    mediaType: 'image/png',
    width: 160,
    height: 90,
    bytes: 247,
  },
}

const settledBrowser = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'browser', argsRaw: '{"action":"screenshot"}' },
  callTime: 1_000,
  content: [{ type: 'text', text: 'captured' }], isError: false,
  meta: SCREENSHOT_META, subCalls: [], ...over,
})

const runningBrowser = (): RunningToolCall => ({
  callId: 'c1', name: 'browser', argsRaw: '{"action":"screenshot"}',
  turn: 1, step: 1, time: 1_000, subCalls: [],
})

describe('toolScreenshotSource', () => {
  it('derives the durable image source from a browser result screenshot attachment', () => {
    expect(toolScreenshotSource(settledBrowser())).toEqual({
      attachment: {
        attachmentId: 'fixture:image',
        mediaType: 'image/png',
        width: 160,
        height: 90,
        bytes: 247,
      },
    })
  })

  it('returns null without metadata or without an attachment inside it', () => {
    expect(toolScreenshotSource(settledBrowser({ meta: undefined }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ meta: null }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ meta: [] }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ meta: {} }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ meta: { screenshotAttachment: null } }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ meta: { screenshotAttachment: [] } }))).toBeNull()
  })

  it('rejects malformed attachment fields', () => {
    for (const screenshotAttachment of [
      {},
      { attachmentId: 7, mediaType: 'image/png', width: 160, height: 90, bytes: 247 },
      { attachmentId: '', mediaType: 'image/png', width: 160, height: 90, bytes: 247 },
      { attachmentId: 'a', mediaType: 7, width: 160, height: 90, bytes: 247 },
      { attachmentId: 'a', mediaType: '', width: 160, height: 90, bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: '160', height: 90, bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: 1.5, height: 90, bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: 0, height: 90, bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: 160, height: '90', bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: 160, height: 1.5, bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: 160, height: -1, bytes: 247 },
      { attachmentId: 'a', mediaType: 'image/png', width: 160, height: 90, bytes: '247' },
      { attachmentId: 'a', mediaType: 'image/png', width: 160, height: 90, bytes: 1.5 },
      { attachmentId: 'a', mediaType: 'image/png', width: 160, height: 90, bytes: -1 },
    ]) {
      expect(toolScreenshotSource(settledBrowser({ meta: { screenshotAttachment } }))).toBeNull()
    }
  })

  it('returns null for running calls, errors, windowless results, and non-browser tools', () => {
    expect(toolScreenshotSource(runningBrowser())).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ isError: true }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({ call: null }))).toBeNull()
    expect(toolScreenshotSource(settledBrowser({
      call: { name: 'web_search', argsRaw: '{"queries":["x"]}' },
    }))).toBeNull()
  })
})
