// EV111 (the user, 13-11 12:40: «en relevos que se cierren las ventanas abiertas que ya no se usen»): which windows of a
// wheel's accounts can be closed now. Pure, so it is tested; main/wheel.ts closes them (only the ones the app opened).

/** An account out of usage keeps its window if it comes back sooner than this (the wheel will type into it). */
export const KEEP_IF_BACK_MS = 45 * 60_000
/** And a window is only closed after this long without doing anything. */
export const IDLE_BEFORE_CLOSE_MS = 15 * 60_000

export interface TidyChain { on: boolean; order: string[]; holder?: string; outgoing?: string }
export interface TidySession { pid?: number; kind?: string; projectId?: string; working: boolean; lastActivityAt?: number; shortId?: string }
export interface TidyAccount { id: string; state: string; backAt?: number; sessions: TidySession[] }

export function idleWindowsToClose(chains: Record<string, TidyChain | undefined>, accounts: TidyAccount[], now: number, done = new Set<number>()): { projectId: string; account: string; pid: number; backAt: number }[] {
  const out: { projectId: string; account: string; pid: number; backAt: number }[] = []
  for (const [projectId, c] of Object.entries(chains)) {
    if (!c?.on) continue
    for (const a of accounts) {
      if (!c.order.includes(a.id) || a.id === c.holder || a.id === c.outgoing || a.state !== 'sin-uso') continue
      if (!a.backAt || a.backAt - now < KEEP_IF_BACK_MS) continue
      for (const s of a.sessions) {
        if (!s.pid || s.kind === 'background' || s.projectId !== projectId || done.has(s.pid)) continue
        if (s.working || now - (s.lastActivityAt ?? 0) < IDLE_BEFORE_CLOSE_MS) continue
        out.push({ projectId, account: a.id, pid: s.pid, backAt: a.backAt })
      }
    }
  }
  return out
}

/**
 * EV141: the same for the wheel's background sessions (no window to close: `claude stop <id>`, its conversation stays
 * saved). Same rule as a window: an account out of usage for a while, not the holder nor the one finishing in the
 * overlap, its session idle 15 min. One that comes back soon keeps it: the wheel resumes it with the next turn.
 */
export function idleBackgroundToStop(chains: Record<string, TidyChain | undefined>, accounts: TidyAccount[], now: number, done = new Set<string>()): { projectId: string; account: string; shortId: string; backAt: number }[] {
  const out: { projectId: string; account: string; shortId: string; backAt: number }[] = []
  for (const [projectId, c] of Object.entries(chains)) {
    if (!c?.on) continue
    for (const a of accounts) {
      if (!c.order.includes(a.id) || a.id === c.holder || a.id === c.outgoing || a.state !== 'sin-uso') continue
      if (!a.backAt || a.backAt - now < KEEP_IF_BACK_MS) continue
      for (const s of a.sessions) {
        if (s.kind !== 'background' || !s.shortId || s.projectId !== projectId || done.has(s.shortId)) continue
        if (s.working || now - (s.lastActivityAt ?? 0) < IDLE_BEFORE_CLOSE_MS) continue
        out.push({ projectId, account: a.id, shortId: s.shortId, backAt: a.backAt })
      }
    }
  }
  return out
}

/**
 * EV130: a second window of the same account that the app opened (13-11 16:18: the wheel opened one for Claude 6 while
 * it was working in another). When an account has two or more windows, the idle ones beyond the one most recently
 * active are closed after IDLE_BEFORE_CLOSE_MS; one working is never closed. main/wheel.ts closes only those the app
 * opened (the user's own, never).
 */
export function duplicateWindowsToClose(accounts: TidyAccount[], now: number, done = new Set<number>()): { projectId?: string; account: string; pid: number }[] {
  const out: { projectId?: string; account: string; pid: number }[] = []
  for (const a of accounts) {
    const wins = a.sessions.filter((s) => s.pid && s.kind !== 'background')
    if (wins.length < 2) continue
    const keep = [...wins].sort((x, y) => Number(y.working) - Number(x.working) || (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))[0]
    for (const s of wins) {
      if (s === keep || s.working || done.has(s.pid!) || now - (s.lastActivityAt ?? 0) < IDLE_BEFORE_CLOSE_MS) continue
      out.push({ projectId: s.projectId, account: a.id, pid: s.pid! })
    }
  }
  return out
}
