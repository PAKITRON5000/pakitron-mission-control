// Calls a Claude back to work once the user has answered something and then left it a moment.
//
// It used to call only when nothing at all was left to answer (Decidir, Para revisar and notes all at zero). Something
// nearly always waits in «Para revisar», so it never called, and the user had to go and tell a Claude himself (MC2,
// the user: «respondí y tuve que avisarte yo»). Now any answer counts: the count going down. Answers come in bursts,
// so it waits until the user has been quiet for a while, and calls once for the whole burst. Whoever is called is
// still decided by the caller: nobody if a Claude is working on the project already (it reads the answers at its next
// step anyway).
export interface AnswerWatchOptions {
  /** How long after the last answer, with no other, before calling. */
  quietMs: number
  tell: () => void
}

export class AnswerWatch {
  private last: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly o: AnswerWatchOptions) {}

  /** The number of things waiting for the user's answer. What was waiting when the app opened is the starting point. */
  update(waiting: number): void {
    const answered = this.last !== undefined && waiting < this.last
    this.last = waiting
    if (!answered) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.o.tell()
    }, this.o.quietMs)
  }

  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

/**
 * EV207: where an answer in Decidir goes: the windows of the Claude that asked, in that project (never another account's).
 * `busy`: one of them is mid-turn, and the hook of its next step brings the answer; otherwise `window` is the one to type into.
 */
export function askerWindow<S extends { pid?: number; kind?: string; projectId?: string }>(sessions: S[], projectId: string, moving: (s: S) => boolean, mtime: (s: S) => number): { window?: S; busy: boolean } {
  const wins = sessions.filter((s) => s.pid && s.kind !== 'background' && s.projectId === projectId)
  if (wins.some(moving)) return { busy: true }
  return { window: [...wins].sort((a, b) => mtime(b) - mtime(a))[0], busy: false }
}
