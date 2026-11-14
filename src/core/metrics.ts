// Whether Mission Control is getting better at its job, in figures (EV22; the user's mission, point 12). Everything is
// read from what is already kept (events, verifications, reservations, usage readings): the agents are not instrumented.
// Each figure says what it is; nothing is estimated here.
import type { DB } from './db'
import type { UsageReading } from './accounts'

export interface Metrics {
  /** Tasks the agents marked as done. */
  done: number
  /** Of those, the ones the user approved. */
  approved: number
  /** Notes of «hay que cambiar algo» the user left on delivered work. */
  changes: number
  /** Runs of the project's checks that passed, and that failed. */
  checksOk: number
  checksFail: number
  /** Times an account stopped for its usage limit. */
  limits: number
  /** Tasks that passed from one account to another. */
  handoffs: number
  /** Minutes from a limit until another account wrote or opened a session in the project (median); undefined: no case. */
  handoffMinutes?: number
  /** Points of the week spent by all the accounts together, in every project. */
  weekPoints: number
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined }

/**
 * Points of the week spent between two moments: in each weekly window, the highest reading minus the lowest. Not the sum
 * of every rise: an old session repainting a stale figure makes the readings go down and up again (seen 12-11: 793
 * points in a week with six accounts).
 */
export function spent(history: UsageReading[], from: number, to: number): number {
  const byWindow = new Map<number, { lo: number; hi: number }>()
  for (const h of history) {
    if (h.at < from || h.at > to || typeof h.week !== 'number' || !h.weekResets) continue
    const w = byWindow.get(h.weekResets)
    if (!w) byWindow.set(h.weekResets, { lo: h.week, hi: h.week })
    else { w.lo = Math.min(w.lo, h.week); w.hi = Math.max(w.hi, h.week) }
  }
  let total = 0
  for (const w of byWindow.values()) total += w.hi - w.lo
  return Math.round(total)
}

export function metrics(db: DB, projectId: string, from: number, to: number, usage: UsageReading[][] = []): Metrics {
  const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n
  const ev = (kind: string) => count('SELECT count(DISTINCT COALESCE(ref, title)) AS n FROM events WHERE project_id = ? AND kind = ? AND at >= ? AND at < ?', projectId, kind, from, to)
  const limits = db.prepare("SELECT at, account FROM events WHERE project_id = ? AND kind = 'limite' AND at >= ? AND at < ? ORDER BY at").all(projectId, from, to) as { at: number; account?: string }[]
  // One stop can be written many times (every retry of the session): a stop is one per account and half hour.
  const stops: { at: number; account?: string }[] = []
  for (const l of limits) if (!stops.some((s) => s.account === l.account && l.at - s.at < 30 * 60_000)) stops.push(l)
  const waits: number[] = []
  for (const s of stops) {
    const next = db.prepare("SELECT min(at) AS at FROM events WHERE project_id = ? AND kind IN ('archivo', 'sesion') AND account IS NOT NULL AND account != ? AND at > ? AND at < ?").get(projectId, s.account ?? '', s.at, s.at + 6 * 3600_000) as { at?: number | null }
    if (next?.at) waits.push(Math.round((next.at - s.at) / 60_000))
  }
  return {
    done: ev('tarea-hecha'),
    approved: ev('tarea-verificada'),
    changes: count('SELECT count(*) AS n FROM task_changes WHERE project_id = ? AND created_at >= ? AND created_at < ?', projectId, from, to),
    checksOk: count("SELECT count(*) AS n FROM verifications WHERE project_id = ? AND outcome = 'bien' AND at >= ? AND at < ?", projectId, from, to),
    checksFail: count("SELECT count(*) AS n FROM verifications WHERE project_id = ? AND outcome = 'falla' AND at >= ? AND at < ?", projectId, from, to),
    limits: stops.length,
    handoffs: count("SELECT count(*) AS n FROM claim_history WHERE project_id = ? AND action = 'relevo' AND at >= ? AND at < ?", projectId, from, to),
    handoffMinutes: median(waits),
    weekPoints: usage.reduce((n, h) => n + spent(h, from, to), 0)
  }
}
