import { describe, expect, it } from 'vitest'
import { FrameQueue } from '../src/api-proxy.ts'

/** Drain a queue fully (abort after end) and collect frames in order. */
async function drain<F>(queue: FrameQueue<F>): Promise<F[]> {
  const controller = new AbortController()
  const out: F[] = []
  for await (const item of queue.iterate(controller.signal, () => {})) out.push(item)
  return out
}

describe('FrameQueue', () => {
  it('yields pushed frames in order', async () => {
    const queue = new FrameQueue<number>()
    queue.push(1)
    queue.push(2)
    const draining = drain(queue)
    queue.end()
    expect(await draining).toEqual([1, 2])
  })

  it('drops the OLDEST frames beyond maxFrames and counts them', async () => {
    const queue = new FrameQueue<number>(3)
    queue.push(1)
    queue.push(2)
    queue.push(3)
    queue.push(4) // 1 dropped
    queue.push(5) // 2 dropped
    expect(queue.dropped).toBe(2)
    const draining = drain(queue)
    queue.end()
    expect(await draining).toEqual([3, 4, 5])
  })

  it('yields the overflow marker ahead of the frames that outlived the gap', async () => {
    const queue = new FrameQueue<number | string>(3, dropped => `resync:${dropped}`)
    for (const n of [1, 2, 3, 4]) queue.push(n) // 1 dropped
    const draining = drain(queue)
    queue.end()
    expect(await draining).toEqual(['resync:1', 2, 3, 4])
  })

  it('keeps the marker out of the bound, so the drop that causes a gap cannot discard it', async () => {
    // Every push past the second drops one more; a marker holding a slot would
    // be the oldest entry and would itself be dropped before any consumer read.
    const queue = new FrameQueue<number | string>(2, dropped => `resync:${dropped}`)
    for (const n of [1, 2, 3, 4, 5]) queue.push(n) // 3 dropped
    expect(queue.dropped).toBe(3)
    const draining = drain(queue)
    queue.end()
    expect(await draining).toEqual(['resync:3', 4, 5])
  })

  it('re-arms after delivery so a later gap is reported again', async () => {
    const queue = new FrameQueue<number | string>(2, dropped => `resync:${dropped}`)
    const controller = new AbortController()
    const frames = queue.iterate(controller.signal, () => {})
    for (const n of [1, 2, 3]) queue.push(n) // 1 dropped
    expect((await frames.next()).value).toBe('resync:1')
    expect((await frames.next()).value).toBe(2)
    expect((await frames.next()).value).toBe(3)
    for (const n of [4, 5, 6]) queue.push(n) // 1 more dropped
    expect((await frames.next()).value).toBe('resync:2')
    expect((await frames.next()).value).toBe(5)
    await frames.return(undefined)
  })

  it('drops silently when the stream mints no overflow frame', async () => {
    const queue = new FrameQueue<number>(2)
    for (const n of [1, 2, 3]) queue.push(n)
    const draining = drain(queue)
    queue.end()
    expect(await draining).toEqual([2, 3])
  })

  it('ignores pushes after end', async () => {
    const queue = new FrameQueue<number>(2)
    queue.end()
    queue.push(1)
    expect(queue.dropped).toBe(0)
    const draining = drain(queue)
    expect(await draining).toEqual([])
  })
})
