// The wheel's forecast (EV67): at each account's own pace, how many hours of work are left in the wheel this week, when
// everything would stop, and whether that is enough for the agenda. An estimate, and always said as one. No node imports.

export interface UsagePoint { at: number; week?: number; weekResets?: number }

/** Share of its week an account spends per hour of work, from its recent readings (rises within the same week). */
export function weekRate(history: UsagePoint[], now: number, days = 3): { rate?: number; hours: number } {
  const h = history.filter((p) => p.at > now - days * 86400_000 && p.week != null).sort((a, b) => a.at - b.at)
  let inc = 0
  let ms = 0
  for (let i = 1; i < h.length; i++) {
    const a = h[i - 1]
    const b = h[i]
    const dt = b.at - a.at
    if (dt <= 0 || dt > 30 * 60_000 || a.weekResets !== b.weekResets) continue
    const d = (b.week ?? 0) - (a.week ?? 0)
    // A drop is a reset or a recharge; a big jump in seconds, a reading put right: neither is work done.
    if (d < 0 || (d > 5 && dt < 10 * 60_000)) continue
    // Readings come every few seconds while it works, most of them with no change: all that time is working time.
    inc += d
    ms += dt
  }
  const hours = ms / 3600_000
  return { rate: hours >= 0.5 ? inc / hours : undefined, hours }
}

export interface ForecastMember {
  id: string
  /** Paused, set aside, gone: not counted. */
  skipped: boolean
  weekUsed?: number
  weekResetsAt?: number
  /** Out of usage until then. */
  backAt?: number
  /** % of the week per working hour (weekRate). */
  rate?: number
}

/** When nothing is known of an account's pace: a typical one (12-13 November, the accounts here: 6 to 12 % an hour). */
export const DEFAULT_RATE = 9

export interface Forecast {
  /** Hours of work left this week, all the wheel together (one works at a time). */
  hours: number
  /** When everything would stop at this pace (one after another); undefined: not before a week comes back. */
  stopAt?: number
  /** The first week that comes back (from then on there is more). */
  renewAt?: number
  perMember: { id: string; hours: number; backAt?: number; guessed: boolean }[]
  /** Hours the agenda still needs, at the pace of the tasks done lately. */
  agendaHours?: number
  /** The week is not enough for the agenda. */
  short: boolean
}

export function wheelForecast(members: ForecastMember[], now: number, agenda?: { open: number; hoursPerTask?: number }): Forecast {
  const perMember = members.filter((m) => !m.skipped).map((m) => {
    const left = m.weekResetsAt && m.weekResetsAt > now && m.weekUsed != null ? Math.max(0, 100 - m.weekUsed) : 100
    const rate = m.rate && m.rate > 0.5 ? m.rate : DEFAULT_RATE
    return { id: m.id, hours: Math.round((left / rate) * 10) / 10, backAt: m.backAt && m.backAt > now ? m.backAt : undefined, guessed: !m.rate }
  })
  const hours = Math.round(perMember.reduce((s, m) => s + m.hours, 0) * 10) / 10
  const renewAt = members.filter((m) => !m.skipped && m.weekResetsAt && m.weekResetsAt > now).map((m) => m.weekResetsAt!).sort((a, b) => a - b)[0]
  // One at a time: the hours run one after another; waiting for a 5-hour return is not counted (an estimate).
  const end = now + hours * 3600_000
  const stopAt = renewAt && end > renewAt ? undefined : end
  const agendaHours = agenda && agenda.open > 0 ? Math.round(agenda.open * (agenda.hoursPerTask ?? 1) * 10) / 10 : undefined
  return { hours, stopAt, renewAt, perMember, agendaHours, short: agendaHours != null && agendaHours > hours && stopAt != null }
}

/** One sentence for the screens. */
export function forecastText(f: Forecast, now: number): string {
  const when = (ms: number) => {
    const d = new Date(ms)
    const same = d.toDateString() === new Date(now).toDateString()
    return `${same ? 'hoy' : 'el ' + ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()] + ' ' + d.getDate()} hacia las ${String(d.getHours()).padStart(2, '0')}:00`
  }
  const h = f.hours >= 10 ? Math.round(f.hours) : f.hours.toString().replace('.', ',')
  let t = `Quedan unas ${h} h de trabajo en la rueda esta semana`
  t += f.stopAt ? `; a este ritmo se pararía todo ${when(f.stopAt)}${f.renewAt ? ` y volvería a haber cuando se renueve una semana (${when(f.renewAt)})` : ''}` : f.renewAt ? `; no se para antes de que vuelva una semana (${when(f.renewAt)})` : ''
  if (f.agendaHours != null) t += `. La agenda pide unas ${f.agendaHours >= 10 ? Math.round(f.agendaHours) : f.agendaHours.toString().replace('.', ',')} h${f.short ? ': la semana no llega' : ''}`
  return t + ' (estimación).'
}
