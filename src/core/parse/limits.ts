// Limits the accounts ran into, as the game project's StopFailure hook (tools\wake_after_limit.ps1) wrote them down:
//   credits_<account>.txt : "2026-11-02 00:40;2026-11-02 03:40;5 horas;8a1b3f2d"   (when, resets, kind, session)
//   wake.log               : "2026-11-01 12:21:53 [73172] 80f0223a limit: '...weekly limit · resets Nov 6, 7am...' -> sleeping until 2026-11-06 07:02:00"
// Both are read only. Local times, as the script writes them. That hook only runs in the game project and names the account
// after its settings folder, so the app also reads the limit message in the conversation itself (any project).
import type { LimitHit, LimitKind } from '../types'
import { localTime } from './relevo'

const STAMP = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/

function stamp(s: string): number | undefined {
  const m = s.match(STAMP)
  return m ? localTime(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) : undefined
}

function kindOf(s: string): LimitKind {
  if (/weekly|semanal|seven_day/i.test(s)) return 'semanal'
  if (/5-hour|5 horas|five_hour/i.test(s)) return '5 horas'
  return 'limite'
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The reset in a limit message, in local time, as the next moment the clock reads it after `at`:
 * "resets 6:20pm", "resets 7am", "resets Nov 6, 7am", "resets Nov 6 at 7:30am" (same reading as wake_after_limit.ps1).
 */
export function resetFromText(text: string, at: number): number | undefined {
  const m = text.match(/resets\s+(?:([A-Z][a-z]{2})\s+(\d{1,2})(?:,\s*(\d{4}))?(?:,|\s+at)?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/)
  if (!m) return undefined
  const hour = (+m[4] % 12) + (m[6] === 'pm' ? 12 : 0)
  const minute = m[5] ? +m[5] : 0
  const base = new Date(at)
  const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  if (m[1] && month < 0) return undefined
  const when = m[1]
    ? new Date(m[3] ? +m[3] : base.getFullYear(), month, +m[2], hour, minute)
    : new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute)
  // Just passed means it has reset already; long passed means the next one.
  if (when.getTime() < at - 10 * 60_000) {
    if (m[1]) when.setFullYear(when.getFullYear() + 1)
    else when.setDate(when.getDate() + 1)
  }
  return when.getTime()
}

/**
 * A usage-limit reply as Claude Code saves it in the conversation: `quotaLimits` (or `apiErrorParams.rate_limit_info`)
 * carries the exact reset in epoch seconds and which window ran out; older entries only have the message text.
 */
export function limitFromTranscriptEntry(j: any): LimitHit | undefined {
  const at = Date.parse(j?.timestamp)
  if (!Number.isFinite(at)) return undefined
  const info = j.quotaLimits ?? j.apiErrorParams?.rate_limit_info ?? {}
  const content = j.message?.content
  const text = Array.isArray(content) ? content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join(' ') : String(content ?? '')
  const resetsAt = typeof info.resetsAt === 'number' && info.resetsAt > 0 ? info.resetsAt * 1000 : resetFromText(text, at)
  if (!resetsAt) return undefined
  const sid = String(j.sessionId ?? j.session_id ?? '')
  return { at, resetsAt, kind: kindOf(`${info.rateLimitType ?? ''} ${text}`), sessionShort: sid.slice(0, 8) || undefined, source: 'transcript' }
}

export function parseCreditsFile(text: string): LimitHit | undefined {
  const [a, b, kind, short] = text.trim().split(';')
  const at = a ? stamp(a) : undefined
  const resetsAt = b ? stamp(b) : undefined
  if (!at || !resetsAt) return undefined
  return { at, resetsAt, kind: kindOf(kind ?? ''), sessionShort: short?.trim() || undefined, source: 'credits_txt' }
}

/** The wake script sleeps until reset + 120 s; the reset itself is two minutes earlier. */
const WAKE_MARGIN_MS = 120_000

export function parseWakeLog(text: string): LimitHit[] {
  const out: LimitHit[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\S+ \S+) \[\d+\] (\S{8}) limit: '(.*)' -> sleeping until (\S+ \S+)\s*$/)
    if (!m) continue
    const at = stamp(m[1])
    const until = stamp(m[4])
    if (!at || !until) continue
    out.push({ at, resetsAt: until - WAKE_MARGIN_MS, kind: kindOf(m[3]), sessionShort: m[2], source: 'wake_log' })
  }
  return out
}
