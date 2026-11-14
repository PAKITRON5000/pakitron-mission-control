import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnswerWatch } from '../src/core/answerWatch'

describe('AnswerWatch (MC2: call a Claude once the user has answered)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('calls once a quiet minute after the last answer, even with things still waiting', () => {
    const tell = vi.fn()
    const w = new AnswerWatch({ quietMs: 60_000, tell })
    w.update(5) // what waited when the app opened
    vi.advanceTimersByTime(120_000)
    expect(tell).not.toHaveBeenCalled()
    w.update(4) // one answered
    vi.advanceTimersByTime(30_000)
    w.update(3) // and another, while still at it
    vi.advanceTimersByTime(59_000)
    expect(tell).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(tell).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300_000)
    expect(tell).toHaveBeenCalledTimes(1)
  })

  it('does not call for new questions, only for answers', () => {
    const tell = vi.fn()
    const w = new AnswerWatch({ quietMs: 60_000, tell })
    w.update(1)
    w.update(2)
    w.update(3)
    vi.advanceTimersByTime(120_000)
    expect(tell).not.toHaveBeenCalled()
    w.stop()
  })
})
