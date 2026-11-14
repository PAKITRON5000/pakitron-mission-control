// Calls the user when there is something new to look at. Deliveries come in bursts, so it waits a moment and calls once;
// and however many come, it does not call again until a while has passed.
export interface AttentionBellOptions {
  gatherMs: number
  quietMs: number
  ring: () => void
}

export class AttentionBell {
  private last: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private rangAt = -Infinity

  constructor(private readonly o: AttentionBellOptions) {}

  /** The number of things waiting for the user. What was already waiting when the app opened does not ring. */
  update(count: number): void {
    const more = this.last !== undefined && count > this.last
    this.last = count
    if (!more || this.timer !== undefined) return
    const wait = Math.max(this.o.gatherMs, this.rangAt + this.o.quietMs - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.rangAt = Date.now()
      this.o.ring()
    }, wait)
  }

  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

/**
 * How many times a session has started waiting for the user. A second question has to ring although the number
 * waiting stays the same, and one ending at the moment another starts must not cancel it out.
 */
export class WaitCounter {
  private waiting = new Set<string>()
  total = 0

  update(ids: string[]): number {
    for (const id of ids) if (!this.waiting.has(id)) this.total++
    this.waiting = new Set(ids)
    return this.total
  }
}
