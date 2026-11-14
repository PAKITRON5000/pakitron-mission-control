import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AttentionBell, WaitCounter } from '../src/core/attentionBell'

describe('AttentionBell', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function make() {
    const ring = vi.fn()
    return { ring, bell: new AttentionBell({ gatherMs: 5000, quietMs: 60000, ring }) }
  }

  it('does not ring for what was already waiting when the app opened', () => {
    const { ring, bell } = make()
    bell.update(4)
    vi.advanceTimersByTime(100000)
    expect(ring).not.toHaveBeenCalled()
  })

  it('rings once for a burst of deliveries', () => {
    const { ring, bell } = make()
    bell.update(0)
    bell.update(1); bell.update(2); bell.update(3)
    vi.advanceTimersByTime(4900)
    expect(ring).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(ring).toHaveBeenCalledTimes(1)
  })

  it('does not ring when things are answered', () => {
    const { ring, bell } = make()
    bell.update(3)
    bell.update(2); bell.update(0)
    vi.advanceTimersByTime(100000)
    expect(ring).not.toHaveBeenCalled()
  })

  it('leaves a quiet time between calls, and still calls afterwards', () => {
    const { ring, bell } = make()
    bell.update(0); bell.update(1)
    vi.advanceTimersByTime(5000)
    expect(ring).toHaveBeenCalledTimes(1)
    bell.update(2)
    vi.advanceTimersByTime(50000)
    expect(ring).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10000)
    expect(ring).toHaveBeenCalledTimes(2)
  })

  it('stays silent after stop', () => {
    const { ring, bell } = make()
    bell.update(0); bell.update(1)
    bell.stop()
    vi.advanceTimersByTime(100000)
    expect(ring).not.toHaveBeenCalled()
  })
})

describe('Cuántas veces un Claude se ha puesto a esperar', () => {
  it('cuenta cada vez que uno empieza a esperar, no mientras sigue esperando', () => {
    const w = new WaitCounter()
    expect(w.update(['a'])).toBe(1)
    expect(w.update(['a'])).toBe(1)
  })
  it('si uno deja de esperar justo cuando otro empieza, también cuenta', () => {
    const w = new WaitCounter()
    w.update(['a'])
    expect(w.update(['b'])).toBe(2)
  })
  it('una segunda pregunta del mismo Claude vuelve a contar', () => {
    const w = new WaitCounter()
    w.update(['a'])
    w.update([])
    expect(w.update(['a'])).toBe(2)
  })
})
