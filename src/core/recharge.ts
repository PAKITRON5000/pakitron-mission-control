// Smart recharge (EV96; the user, 13-11: «cuando te regalan cupones de esos de recarga… que lo autoaplique de la manera más
// inteligente… y así si el usuario no está y sigue trabajando»; Decidir #130 «B»: it applies them by itself when that is
// safe, never buying anything, and the app finds them, not the user).
//
// What the «coupon» is (read in Claude Code 2.1.32x itself, 13-11): `/limit-reset`, a hidden command that, once a week and
// only at the 5-hour wall, refills the 5 hours («still counts toward your weekly limit»); newer builds offer kinds
// (5-hour, weekly, full, fable) with «{left} left · use by {date}». Claude Code claims it with its own login, so the app
// never touches a credential: it reads the account's window at the limit, and at the right moment types the command
// there and confirms only a dialog that talks about a reset (never one about credits, billing or buying).
//
// Here: reading what the window shows, and the decision. No node imports (main/recharge.ts does the rest).

export interface ResetOffer {
  available: boolean
  /** The kinds it names (5-hour, weekly, full, fable); none: the older single 5-hour reset. */
  kinds?: string[]
  left?: number
  /** «use by …» as Claude Code wrote it. */
  useBy?: string
}

/** What the account's window says about a reset, if anything. */
export function readResetOffer(screen: string): ResetOffer | undefined {
  const s = screen.replace(/\s+/g, ' ')
  if (/limit reset isn't available|This reset isn't available any more|No [\w -]+ reset to use|Reset used · 0 left/i.test(s)) return { available: false }
  const one = s.match(/\/limit-reset to use your ([\w -]+?) · (\d+) left · use by ([^·]+?)(?: ·|$)/i)
  if (one) return { available: true, kinds: [kindOf(one[1])], left: Number(one[2]), useBy: one[3].trim() }
  const many = s.match(/\/limit-reset · ([^·]+?) · first expires ([^·]+?)(?: ·|$)/i)
  if (many) return { available: true, kinds: ['5-hour', 'weekly', 'full', 'fable'].filter((k) => many[1].toLowerCase().includes(k.replace('-hour', ''))), useBy: many[2].trim() }
  // The chooser lists each one: «Use a full reset (1 left, until Nov 20)».
  const listed = [...s.matchAll(/Use an? ([\w -]+?) reset \((\d+) left, until ([^)]+)\)/gi)]
  if (listed.length) return { available: true, kinds: [...new Set(listed.map((m) => kindOf(m[1])))], left: listed.reduce((n, m) => n + Number(m[2]), 0), useBy: listed[0][3].trim() }
  const kept = s.match(/(\w[\w -]*?) reset kept · run \/limit-reset (?:at a limit|whenever you want) to use it · use by ([^·]+?)(?: ·|$)/i)
  if (kept) return { available: true, kinds: [kindOf(kept[1])], useBy: kept[2].trim() }
  // The wording of Claude Code 2.1.323 itself (read from claude.exe on 13-11, since no account had a reset to show):
  // «Resets kept · run /limit-reset when you want one · first expires {deadline}», «You have a reset saved for when you
  // reach a usage limit», «A different reset is on offer now · nothing was used».
  const keptMany = s.match(/Resets? kept · run \/limit-reset when you want one · first expires ([^·]+?)(?: ·|$)/i)
  if (keptMany) return { available: true, useBy: keptMany[1].trim() }
  if (/You have a reset saved for when you reach a usage limit|A different reset is on offer now/i.test(s)) return { available: true }
  if (/Use an available limit reset|Reset your 5-hour limit now|run \/limit-reset/i.test(s)) return { available: true }
  return undefined
}

const kindOf = (t: string) => {
  const x = t.toLowerCase()
  return x.includes('week') ? 'weekly' : x.includes('full') ? 'full' : x.includes('fable') ? 'fable' : '5-hour'
}

export type ResetStep = 'confirmar' | 'elegir' | 'hecho' | 'sin-recarga' | 'peligro' | 'nada'

/**
 * What the window shows after typing `/limit-reset`. «peligro»: anything about credits, billing or paying; the app never
 * presses there (Claude Code's «claiming turns on extra usage billing» lives next door).
 */
export function resetStep(screen: string): ResetStep {
  const s = screen.replace(/\s+/g, ' ')
  const danger = /usage credits|extra usage|billing|purchase|buy |\$\s?\d|\d\s?€|upgrade/i.test(s)
  // The question still on screen comes first: its text says «your weekly reset day stays», like the success line.
  if (/Yes, use my|No, keep it/i.test(s)) return danger ? 'peligro' : 'confirmar'
  if (/Which reset do you want to use/i.test(s)) return danger ? 'peligro' : 'elegir'
  if (/Reset used ·|your weekly reset day stays|already being reset|reset went through|send a message to continue|Usage limit reset/i.test(s)) return 'hecho'
  if (danger) return 'peligro'
  if (/limit reset isn't available|isn't available any more|No [\w -]+ to use/i.test(s)) return 'sin-recarga'
  return 'nada'
}

export type RechargeMode = 'sola' | 'avisar' | 'no'

export interface RechargeInput {
  now: number
  mode: RechargeMode
  /** The limit it is stopped at. */
  limit?: { kind: '5 horas' | 'semanal' | 'limite'; resetsAt: number }
  weekUsed?: number
  weekResetsAt?: number
  offer?: ResetOffer & { usedAt?: number; tries?: number; lastTryAt?: number }
  /** There is work for it: its wheel's agenda is open, or autonomous mode is on. */
  workLeft: boolean
  /** Accounts of its wheel that can take the turn now. */
  othersReady: string[]
  /** «use by» as a time, when it could be read. */
  useByAt?: number
  /** The model it works with (a Fable reset only frees what Fable used). */
  model?: string
  /** EV67's forecast: hours of work the other accounts of its wheel have left this week (undefined: no forecast). */
  othersHours?: number
  /** Hours the wheel's agenda still asks for, at the pace of the last tasks. */
  agendaHours?: number
}

export interface RechargeDecision { action: 'usar' | 'avisar' | 'esperar' | 'nada'; why: string; kind?: string }

/** Below this many minutes to its own return, waiting costs less than a coupon. */
export const WORTH_MINUTES = 45
/** A 5-hour refill still counts toward the week: with less than this share of the week left it buys almost nothing. */
export const WEEK_FLOOR = 10
/** A week that comes back within this long does not deserve a weekly, full or Fable reset. */
export const WEEK_SOON_MS = 24 * 3600_000

const who = (id: string) => `Claude ${id.replace(/\D/g, '')}`

/**
 * Whether to use the reset now. The idea is to spend it where it buys the most work: when the account is stopped with
 * work waiting and nobody else can go on, long before its usage would come back by itself; kept otherwise, unless it
 * would be lost (use by the next day).
 */
export function rechargeDecision(i: RechargeInput): RechargeDecision {
  if (i.mode === 'no') return { action: 'nada', why: 'las recargas no se tocan (Ajustes)' }
  if (!i.offer?.available) return { action: 'nada', why: 'no tiene recarga a mano' }
  if (!i.limit || i.limit.resetsAt <= i.now) return { action: 'nada', why: 'no está parada por su límite' }
  if (i.offer.lastTryAt && i.now - i.offer.lastTryAt < 30 * 60_000) return { action: 'esperar', why: 'se intentó hace menos de media hora' }
  const weekly = i.limit.kind === 'semanal'
  const kinds = i.offer.kinds
  const weekLeft = i.weekResetsAt && i.weekResetsAt > i.now && i.weekUsed != null ? 100 - i.weekUsed : undefined
  // Each kind where it buys the most (the user, 13-11: claude1 has a full reset, claude3 a Fable one): a weekly limit takes
  // a weekly or full reset, or a Fable one when it works with Fable («frees up only what Fable used this week»); the
  // 5-hour wall takes a 5-hour one, and a full one only when the week is low too (else its weekly half is wasted).
  const fable = /fable/i.test(i.model ?? '')
  const kind = !kinds?.length ? (weekly ? undefined : '5-hour')
    : weekly ? (kinds.find((k) => k === 'weekly') ?? kinds.find((k) => k === 'full') ?? (fable ? kinds.find((k) => k === 'fable') : undefined))
    : (kinds.find((k) => k === '5-hour') ?? (weekLeft != null && weekLeft < 30 ? kinds.find((k) => k === 'full') : undefined))
  if (!kind) return { action: 'nada', why: weekly ? 'su recarga no sirve para el límite semanal' : 'su recarga es mejor guardarla para cuando se le acabe la semana' }
  const minutes = Math.round((i.limit.resetsAt - i.now) / 60_000)
  if (minutes < WORTH_MINUTES) return { action: 'esperar', why: `vuelve sola en ${minutes} min` }
  // The user, 13-11: «se gasta si con el cálculo sabes que gastaremos los créditos semanales antes de la recarga y merecerá
  // la pena; si no, no… calcúlalo tú». With the forecast (EV67): if the other accounts of the wheel have work hours enough
  // to reach this account's own return, or the agenda fits in what they have, the reset is kept; only when the wheel would
  // stand still with work waiting is it worth spending.
  const expiresFirst = i.useByAt != null && i.useByAt < i.limit.resetsAt
  const gapH = (i.limit.resetsAt - i.now) / 3600_000
  if (i.othersHours != null && !expiresFirst) {
    const oh = Math.round(i.othersHours * 10) / 10
    if (i.othersHours >= gapH) return { action: 'esperar', why: `las demás tienen unas ${oh} h de trabajo, hasta que vuelva sola: la recarga se guarda` }
    if (i.agendaHours != null && i.agendaHours <= i.othersHours) return { action: 'esperar', why: `lo que queda de la agenda (unas ${i.agendaHours} h) cabe en lo que tienen las demás: la recarga se guarda` }
  } else if (i.othersHours == null && kind !== '5-hour') {
    // Without a forecast: a weekly, full or Fable reset is not spent on a week that comes back within a day anyway.
    const weekBack = weekly ? i.limit.resetsAt : i.weekResetsAt
    if (weekBack && weekBack - i.now < WEEK_SOON_MS && !(i.useByAt != null && i.useByAt < weekBack)) return { action: 'esperar', why: `su semana se renueva en ${Math.max(1, Math.round((weekBack - i.now) / 3600_000))} h: la recarga se guarda` }
  }
  if (!weekly && weekLeft != null && weekLeft < WEEK_FLOOR && kind !== 'full') return { action: 'nada', why: `le queda el ${Math.round(weekLeft)} % de la semana: recargar las 5 horas no daría para nada` }
  if (!i.workLeft) return { action: 'esperar', why: 'no hay trabajo esperando' }
  const expiring = i.useByAt != null && i.useByAt - i.now < 26 * 3600_000
  if (i.othersReady.length && !expiring) return { action: 'esperar', why: `${i.othersReady.map(who).join(' y ')} puede seguir: la recarga se guarda` }
  const why = expiring && i.othersReady.length ? 'caduca pronto y se perdería' : `nadie más puede seguir y volvería en ${minutes >= 120 ? Math.round(minutes / 60) + ' h' : minutes + ' min'}`
  return { action: i.mode === 'avisar' ? 'avisar' : 'usar', why, kind }
}

/** «use by Nov 18» / «use by 18 nov» → a time (end of that day), when it can be read. */
export function useByTime(text: string | undefined, now: number): number | undefined {
  if (!text) return undefined
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const es = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const t = text.toLowerCase()
  const m = t.match(/([a-z]{3})[a-z]*\.? (\d{1,2})/) ?? t.match(/(\d{1,2}) (?:de )?([a-z]{3})/)
  if (!m) return undefined
  const [mon, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]]
  let idx = months.indexOf(mon)
  if (idx < 0) idx = es.indexOf(mon)
  if (idx < 0) return undefined
  const d = new Date(now)
  const at = new Date(d.getFullYear(), idx, Number(day), 23, 59).getTime()
  return at < now - 60 * 86400_000 ? new Date(d.getFullYear() + 1, idx, Number(day), 23, 59).getTime() : at
}
