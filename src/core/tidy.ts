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
 * The user (14-11 03:13): «si se abren ventanas de claude y luego se toman relevos o no se usan y más tarde volverán a
 * abrirse, que se vayan cerrando y abriendo según corresponda, para optimizar siempre el pc… hay muchas ventanas de
 * claude que ni se ven». Two kinds of window no rule above reaches, both out of usage for a while and idle 15 min:
 * - 'otro-proyecto': an account of a wheel that is on, with its window left in another project (14-11 17:20: Claude 3
 *   quiet in another project since 14:50 while its wheel is in Mission Control). The wheel opens a new one where its turn is
 *   (or calls it, EV153), so the old one only takes memory.
 * - 'apartada': an account the user set aside or that is gone (14-11 17:20: Claude 4, «No usar», quiet since 16:06 until
 *   its limit at 19:20). Nothing is meant to reopen it.
 * Never a holder or the one finishing an overlap of any wheel, a background session (EV141 stops those), one working,
 * one back within KEEP_IF_BACK_MS, nor a window in its own wheel's project (idleWindowsToClose has those).
 */
export function strayWindowsToClose(chains: Record<string, TidyChain | undefined>, accounts: TidyAccount[], now: number, done = new Set<number>()): { projectId?: string; account: string; pid: number; backAt: number; why: 'otro-proyecto' | 'apartada' }[] {
  const on = Object.entries(chains).filter(([, c]) => c?.on) as [string, TidyChain][]
  const out: { projectId?: string; account: string; pid: number; backAt: number; why: 'otro-proyecto' | 'apartada' }[] = []
  for (const a of accounts) {
    if (on.some(([, c]) => c.holder === a.id || c.outgoing === a.id)) continue
    if (!a.backAt || a.backAt - now < KEEP_IF_BACK_MS) continue
    const wheels = on.filter(([, c]) => c.order.includes(a.id)).map(([id]) => id)
    const why = a.state === 'apartada' || a.state === 'baja' ? 'apartada' : a.state === 'sin-uso' && wheels.length ? 'otro-proyecto' : undefined
    if (!why) continue
    for (const s of a.sessions) {
      if (!s.pid || s.kind === 'background' || done.has(s.pid) || out.some((o) => o.pid === s.pid)) continue
      if (why === 'otro-proyecto' && s.projectId && wheels.includes(s.projectId)) continue
      if (s.working || now - (s.lastActivityAt ?? 0) < IDLE_BEFORE_CLOSE_MS) continue
      out.push({ projectId: s.projectId, account: a.id, pid: s.pid, backAt: a.backAt, why })
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
