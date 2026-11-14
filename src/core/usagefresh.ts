// Which reading of an account's usage is the true one (the user, 14-11: «sigue indicando mal los porcentajes que le
// quedan a cada claude… hemos intentado arreglar esto varias veces, tanto en mac como en windows»).
//
// Each Claude Code session knows the account's usage from its own last request, and gives it to the status line every
// time it redraws, also hours later, sitting idle. The status line used to save whatever came last: with two sessions
// of one account open (14-11 16:14: Claude 5 working in Mission Control at 100 % of its 5 hours, and idle since the
// morning in another project), the idle one redrew and wrote its old 86 %; on 13-11 and 14-11 Claude 5's readings went back
// 785 times within the same week. Now a reading only replaces the saved one when it comes from the same session, or
// from one that has asked Anthropic something at least as recently, or when it already knows a newer window.

export interface WindowReading { usedPct: number; resetsAt: number }

export interface SavedReading {
  sessionId?: string
  /** When the session that gave it last talked to Anthropic (its numbers are from then). Missing in older files. */
  freshAt?: number
  fiveHour?: WindowReading
  sevenDay?: WindowReading
}

/** What the status line keeps of each session between two redraws. */
export interface SessionMark { apiMs?: number; freshAt?: number }

/**
 * When this session last talked to Anthropic. Its API time, once known, says it: changed since the last redraw (grown, or
 * back to zero in a session taken up again in a new process), now; the same, what was known. The first time it is seen,
 * the last time its conversation was written (each request and answer is written there).
 */
export function sessionFreshAt(prev: SessionMark | undefined, apiMs: number | undefined, transcriptMtime: number | undefined, now: number): number {
  if (typeof apiMs === 'number' && typeof prev?.apiMs === 'number') return apiMs !== prev.apiMs ? now : Math.min(prev.freshAt ?? now, now)
  const known = Math.max(prev?.freshAt ?? 0, transcriptMtime ?? 0)
  // Nothing known about it at all (no mark, no conversation file): as before, it counts as new.
  return known > 0 ? Math.min(known, now) : now
}

const MINUTE = 60_000

/** Whether `next` (from a redraw just now) should replace the saved reading `prev`. */
export function acceptReading(prev: SavedReading | undefined, next: SavedReading & { freshAt: number }): boolean {
  if (!prev) return true
  if (prev.sessionId && prev.sessionId === next.sessionId) return true
  if (typeof prev.freshAt !== 'number') return true
  // It already knows a later window than the saved one: the saved one is the old news.
  if (next.fiveHour && prev.fiveHour && next.fiveHour.resetsAt > prev.fiveHour.resetsAt + MINUTE) return true
  if (next.sevenDay && prev.sevenDay && next.sevenDay.resetsAt > prev.sevenDay.resetsAt + MINUTE) return true
  return next.freshAt >= prev.freshAt - 2000
}
