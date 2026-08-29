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

  it('ignores pushes after end', async () => {
    const queue = new FrameQueue<number>(2)
    queue.end()
    queue.push(1)
    expect(queue.dropped).toBe(0)
    const draining = drain(queue)
    expect(await draining).toEqual([])
  })
})
