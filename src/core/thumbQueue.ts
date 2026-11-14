// A queue for heavy background work: one job at a time, a rest between jobs, and it waits while `canStart` says no.
export interface ThumbQueueOptions<T> {
  key: (job: T) => number
  run: (job: T) => Promise<void>
  canStart: () => boolean
  restMs: number
  waitMs: number
}

export class ThumbQueue<T> {
  private jobs: T[] = []
  private seen = new Set<number>()
  private busy = false
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly o: ThumbQueueOptions<T>) {}

  /** Each job is only ever taken once per session: what fails must not come back on its own. */
  add(job: T): boolean {
    const k = this.o.key(job)
    if (this.stopped || this.seen.has(k)) return false
    this.seen.add(k)
    this.jobs.push(job)
    this.next(0)
    return true
  }

  stop(): void {
    this.stopped = true
    this.jobs = []
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private next(delay: number): void {
    if (this.busy || this.stopped || this.timer !== undefined || !this.jobs.length) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.step()
    }, delay)
  }

  private step(): void {
    if (this.busy || this.stopped || !this.jobs.length) return
    if (!this.o.canStart()) return this.next(this.o.waitMs)
    this.busy = true
    const job = this.jobs.shift()!
    void this.o.run(job).catch(() => undefined).finally(() => {
      this.busy = false
      this.next(this.o.restMs)
    })
  }
}
