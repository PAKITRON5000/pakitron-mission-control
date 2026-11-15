// What each screen says of an account's 5 hours and week, in one place (EV175, the user, 14-11: «el de la semana estaba
// más lleno en plan 70 u 80 % cuando en realidad tiene un 20 % gastado… hemos fallado muchas veces en esto»). It is said
// the way Claude Code's /usage says it: what is USED, so the app and /usage can be read side by side. Until 0.34.2 the
// rings and bars drew what was left, and a full bar was read as spent.
// No node imports: the renderer uses it.
import type { AccountUsage } from './types'

export const USAGE_SPAN = { five: 5 * 3600_000, week: 7 * 86400_000 } as const
/** A pace from less than this share of the window is noise (14-11 19:23: 2 % in the week's first 23 min said «se acaba 15:15»). */
export const PACE_FROM = 0.1

export interface UsageView {
  which: 'five' | 'week'
  /** 0..100; undefined without a current reading. */
  used?: number
  left?: number
  resetsAt?: number
  /** Share of the window's time still to go (0..1). */
  timeLeft?: number
  /** Share of the window's time gone (0..1): what is used past this mark spends faster than the clock. */
  elapsed?: number
  /** It ran into this limit and waits for the reset. */
  out: boolean
  /** At the pace since the window started it runs out before the reset, at this time. */
  emptyAt?: number
  /** EV105: the last reading's window already renewed, at this time, with no use read since: it is whole again. */
  renewedAt?: number
}

export function usageView(usage: Pick<AccountUsage, 'activeLimit' | 'snapshot'>, which: 'five' | 'week', now: number): UsageView {
  const lim = usage.activeLimit
  if (lim && ((which === 'week' && lim.kind === 'semanal') || (which === 'five' && lim.kind !== 'semanal'))) return { which, used: 100, left: 0, resetsAt: lim.resetsAt, out: true }
  const w = which === 'week' ? usage.snapshot?.sevenDay : usage.snapshot?.fiveHour
  if (!w) return { which, out: false }
  // EV105 (the user, 13-11: «los créditos restantes aunque estén en No usar»): an account that has not worked since its
  // window renewed has it whole; every session writes a new reading, so none since means none spent.
  if (w.resetsAt <= now) return { which, used: 0, left: 100, out: false, renewedAt: w.resetsAt }
  const used = Math.max(0, Math.min(100, w.usedPct))
  const span = USAGE_SPAN[which]
  const start = w.resetsAt - span
  const timeLeft = Math.max(0, Math.min(1, (w.resetsAt - now) / span))
  let emptyAt: number | undefined
  if (used >= 3 && now - start >= span * PACE_FROM) {
    const at = now + (100 - used) / (used / (now - start))
    if (at < w.resetsAt) emptyAt = at
  }
  return { which, used, left: 100 - used, resetsAt: w.resetsAt, timeLeft, elapsed: 1 - timeLeft, out: used >= 100, emptyAt }
}

/** Spending faster than the clock: what is used is well past the share of the window's time gone. */
export const fastPace = (v: UsageView): boolean =>
  v.used != null && v.elapsed != null && !v.out && v.elapsed >= PACE_FROM && v.used / 100 > v.elapsed + 0.08

/** Colour of what is used, as /usage: the account's while there is room, orange from 75 %, red from 90 %. */
export function usedColor(used: number | undefined, base: string): string {
  if (used == null) return base
  return used >= 90 ? 'var(--red)' : used >= 75 ? 'var(--orange)' : base
}
