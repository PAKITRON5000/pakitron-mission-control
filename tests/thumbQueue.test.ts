import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ThumbQueue } from '../src/core/thumbQueue'

describe('ThumbQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function make(canStart: () => boolean = () => true) {
    const ends: (() => void)[] = []
    const started: number[] = []
    const q = new ThumbQueue<number>({
      key: (n) => n,
      run: (n) => new Promise<void>((res) => { started.push(n); ends.push(res) }),
      canStart,
      restMs: 1000,
      waitMs: 3000
    })
    return { q, ends, started }
  }

  it('runs one job at a time and rests between them', async () => {
    const { q, ends, started } = make()
    q.add(1); q.add(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toEqual([1])
    ends[0]()
    await vi.advanceTimersByTimeAsync(900)
    expect(started).toEqual([1])
    await vi.advanceTimersByTimeAsync(200)
    expect(started).toEqual([1, 2])
  })

  it('never takes the same job twice, so a failure does not come back', async () => {
    const { q, ends, started } = make()
    expect(q.add(1)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    ends[0]()
    await vi.advanceTimersByTimeAsync(2000)
    expect(q.add(1)).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toEqual([1])
  })

  it('waits while it may not start, and goes on by itself afterwards', async () => {
    let allowed = false
    const { q, started } = make(() => allowed)
    q.add(1)
    await vi.advanceTimersByTimeAsync(20000)
    expect(started).toEqual([])
    allowed = true
    await vi.advanceTimersByTimeAsync(3000)
    expect(started).toEqual([1])
  })

  it('keeps going after a job fails', async () => {
    const started: number[] = []
    const q = new ThumbQueue<number>({ key: (n) => n, run: async (n) => { started.push(n); throw new Error('no') }, canStart: () => true, restMs: 10, waitMs: 10 })
    q.add(1); q.add(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(started).toEqual([1, 2])
  })

  it('starts nothing after stop', async () => {
    const { q, ends, started } = make()
    q.add(1); q.add(2)
    await vi.advanceTimersByTimeAsync(0)
    q.stop()
    ends[0]()
    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toEqual([1])
    expect(q.add(3)).toBe(false)
  })
})
