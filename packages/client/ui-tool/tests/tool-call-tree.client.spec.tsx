// @vitest-environment jsdom
/** ToolCallTree-owned root/subcall markers and selection projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolCallOwnerProps, ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallTree } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, subCalls: [],
})

function props(
  block: ToolResultNode,
  selectedCallId?: string,
  home?: string,
  owners?: ToolCallOwnerProps[],
): ToolTreeProps {
  const snapshot = {} as SessionSnapshot
  const useSession = ((selector: (value: SessionSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((_key: string, owner: ToolCallOwnerProps, options?: { fallback?: React.ReactNode }) => {
    owners?.push(owner)
    return options?.fallback ?? null
  }) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedCallId,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostInfo: ((selector: (info: { home: string | undefined }) => unknown) => selector({ home })) as ToolTreeProps['useHostInfo'],
    t,
  } as unknown as ToolTreeProps
}

describe('ToolCallTree', () => {
  it('owns the root marker, generic fallback, and selected state for a window-truncated call', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block, 'w1')} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(row?.getAttribute('data-selected')).toBe('true')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('recursively renders a selected leaf without selecting its ancestors', () => {
    const owners: ToolCallOwnerProps[] = []
    const leaf = {
      ...root('parent:code:1:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' }),
      parentCallId: 'parent:code:1',
    }
    const child = {
      ...root('parent:code:1', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      parentCallId: 'parent',
      subCalls: [leaf],
    }
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [child],
    }
    const view = render(<ToolCallTree {...props(block, leaf.callId, undefined, owners)} />)
    const nests = view.container.querySelectorAll('[data-subcalls]')
    expect(nests[0]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent"]'))
    expect(nests[1]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent:code:1"]'))
    expect(view.container.querySelector('[data-chat-call-id="parent"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1:code:1"]')?.getAttribute('data-selected')).toBe('true')
    expect(nests).toHaveLength(2)
    expect(owners.map(owner => [owner.callId, owner.block.parentCallId ?? null])).toEqual([
      ['parent', null],
      ['parent:code:1', 'parent'],
      ['parent:code:1:code:1', 'parent:code:1'],
    ])
  })

  it('abbreviates a POSIX home path in the generic tool summary', () => {
    const block = root('w1', { name: 'read', argsRaw: '{"path":"/h/docs/a.ts"}' })
    const view = render(<ToolCallTree {...props(block, 'w1', '/h')} />)
    expect(view.getByText('~/docs/a.ts')).toBeTruthy()
  })
})

describe('ToolCallTree screenshot slot', () => {
  const screenshotMeta = {
    screenshotAttachment: {
      attachmentId: 'fixture:image',
      mediaType: 'image/png',
      width: 160,
      height: 90,
      bytes: 247,
    },
  }

  it('renders the screenshot gallery owner for a settled browser screenshot result', () => {
    const block = {
      ...root('b1', { name: 'browser', argsRaw: '{"action":"screenshot"}' }),
      meta: screenshotMeta,
    }
    const screenshotOwners: { images: unknown; align: unknown; loadImage: unknown }[] = []
    const loadImage = vi.fn(async () => 'blob:fixture')
    const base = props(block)
    const renderSlot = ((key: string, owner: unknown, options?: { fallback?: React.ReactNode }) => {
      if (key === 'tool.call.toolview') return options?.fallback ?? null
      screenshotOwners.push(owner as never)
      return <img alt="screenshot-thumb" />
    }) as unknown as ToolTreeProps['renderSlot']
    const view = render(<ToolCallTree {...base} loadImage={loadImage} renderSlot={renderSlot} />)
    expect(view.container.querySelector('[data-tool="browser"]')).not.toBeNull()
    expect(view.container.querySelector('img[alt="screenshot-thumb"]')).not.toBeNull()
    expect(screenshotOwners).toEqual([{
      images: [{
        attachment: {
          attachmentId: 'fixture:image',
          mediaType: 'image/png',
          width: 160,
          height: 90,
          bytes: 247,
        },
      }],
      align: 'start',
      loadImage,
    }])
  })

  it('renders no screenshot outlet without a persisted attachment', () => {
    const block = root('b2', { name: 'browser', argsRaw: '{"action":"goto"}' })
    const calls: string[] = []
    const base = props(block)
    const renderSlot = ((key: string) => {
      calls.push(key)
      return null
    }) as unknown as ToolTreeProps['renderSlot']
    render(<ToolCallTree {...base} renderSlot={renderSlot} />)
    expect(calls).toEqual(['tool.call.toolview'])
  })
})
