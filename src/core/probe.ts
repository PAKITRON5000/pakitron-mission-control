import { t } from './i18n'
// EV120 (the user, 13-11 14:00: «te he recargado manualmente los créditos y la app no ha leído la recarga, por lo que me
// ha tocado abrirte manualmente»). An account the app believes out of usage only showed its new usage once one of its
// sessions replied, and the app opens no session for an account it believes out: nobody noticed a recharge. Now the app
// asks Claude Code itself, with no window: `claude -p` with Haiku, no tools, a one-line system prompt, no hooks (only
// the «local» settings of an empty folder), no MCP and nothing saved. Its stream-json output carries a
// `rate_limit_event` with the real windows. Measured on 13-11: an account still out is refused before any model runs
// (0 $, 4 s, with its exact reset); one with usage costs about 0.0007 $ (5 s). So it is only asked of accounts believed
// out, every 10 minutes at most, and the first «allowed» gives the account back.
// No node imports.

export interface ProbeWindow { pct: number; resetsAt?: number; status?: string }

export interface ProbeReading {
  /** «allowed» or «allowed_warning»: it has usage; «rejected»: still out. */
  status: string
  /** The window that decided it (five_hour, seven_day…). */
  type?: string
  /** When the deciding window resets (ms). */
  resetsAt?: number
  five?: ProbeWindow
  week?: ProbeWindow
}

/** The last `rate_limit_event` of a `claude -p --output-format stream-json --verbose` run; undefined if none came. */
export function parseProbe(stdout: string): ProbeReading | undefined {
  let found: ProbeReading | undefined
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('"rate_limit_event"')) continue
    let row: any
    try { row = JSON.parse(line) } catch { continue }
    const i = row?.type === 'rate_limit_event' ? row.rate_limit_info : undefined
    if (!i || typeof i.status !== 'string') continue
    const win = (w: any): ProbeWindow | undefined => w && typeof w.utilization === 'number'
      ? { pct: Math.round(w.utilization * 100), resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : undefined, status: w.status }
      : undefined
    found = {
      status: i.status,
      type: i.rateLimitType,
      resetsAt: typeof i.resetsAt === 'number' ? i.resetsAt * 1000 : undefined,
      five: win(i.unifiedWindows?.five_hour),
      week: win(i.unifiedWindows?.seven_day)
    }
  }
  return found
}

export const hasUsage = (r: ProbeReading): boolean => r.status !== 'rejected'

/**
 * Still out, but back 15 min or more sooner than the app believes (it took a week for a 5-hour limit, or a recharge
 * moved the week): the later limits it knew no longer hold, and the return time to show is the probe's.
 */
export function backSooner(backAt: number | undefined, r: ProbeReading): boolean {
  return !hasUsage(r) && Boolean(backAt && r.resetsAt && r.resetsAt < backAt - 15 * 60_000)
}

/**
 * Still out, and back later than the app believes, or when it did not know when (14-11 16:36: Claude 3's week was used up
 * until 19:00 while the app said «vuelve 17:30», its 5 hours, and after 17:30 it would have counted it as having usage):
 * the reading is written so every screen and the wheel wait for the right time.
 */
export function backLater(backAt: number | undefined, r: ProbeReading): boolean {
  return !hasUsage(r) && Boolean(r.resetsAt) && (!backAt || r.resetsAt! > backAt + 15 * 60_000)
}

export const PROBE_EVERY_MS = 10 * 60_000
/** An account believed to have usage but nearly out at its last reading is asked when that reading is this old. */
export const NEAR_OUT_STALE_MS = 60 * 60_000
/** An account due back sooner than this is just waited for. */
export const PROBE_SKIP_IF_BACK_WITHIN_MS = 15 * 60_000

export interface ProbeCandidate {
  id: string
  /** The app believes it is out of usage. */
  out: boolean
  /** When the app expects it back, if known. */
  backAt?: number
  /** Not to be touched: «De baja», or «No usar» without a backup rule. */
  skip: boolean
  /** Signed in (claude auth status); unknown counts as yes. */
  login?: boolean
  /**
   * Believed to have usage, but its last reading had 95 % or more of a window still open spent, and is older than
   * NEAR_OUT_STALE_MS: it may have run out since, here or elsewhere, before the wheel gives it the turn.
   */
  nearOut?: boolean
}

/** The account to ask now, if any: one at a time, the one asked longest ago first. */
export function dueProbe(accounts: ProbeCandidate[], lastAsked: Record<string, number>, now: number): string | undefined {
  return accounts
    .filter((a) => (a.out || a.nearOut) && !a.skip && a.login !== false)
    .filter((a) => !a.backAt || a.backAt - now > PROBE_SKIP_IF_BACK_WITHIN_MS)
    .filter((a) => now - (lastAsked[a.id] ?? 0) >= PROBE_EVERY_MS)
    .sort((a, b) => (lastAsked[a.id] ?? 0) - (lastAsked[b.id] ?? 0))[0]?.id
}

/** In words, for the timeline: «semana 1 %, 5 horas 9 %». */
export function probeWords(r: ProbeReading): string {
  const parts: string[] = []
  if (r.week) parts.push(t('semana {v0} %', { v0: r.week.pct }))
  if (r.five) parts.push(t('5 horas {v0} %', { v0: r.five.pct }))
  return parts.join(', ')
}

/** The command line (after the executable). */
export const PROBE_ARGS = [
  '-p', 'ok', '--model', 'haiku', '--tools', '', '--system-prompt', 'Responde solo: ok', '--setting-sources', 'local',
  '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'
]
