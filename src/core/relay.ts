import { t } from './i18n'
// Automatic hand-off: when an account stops for its usage limit in the middle of a project, the next account that can
// go on is opened there and told to take over (`pmc relevo <account>`). Asked for by the user on 12-11 («cuando te quedes
// sin créditos… que siga él solo»). Everything here is the decision; opening the window is the app's (main/index.ts).
import type { AccountId, AgentCard } from './types'
import { isWorkingOn } from './coord'

/** What the user says about an account that nothing else can tell: set aside (his brother's), or no longer paid. */
export type AccountStatus = 'pausada' | 'baja'

export const STATUS_LABEL: Record<AccountStatus, string> = { pausada: 'apartada por el usuario: no se usa', baja: 'de baja: ya no se paga' }

export interface RelayCandidate extends Pick<AgentCard, 'id' | 'state' | 'sessions'> {
  /** Free share of the week as last read; undefined when there is no reading. */
  weekFree?: number
  /** Free share of its 5 hours as last read; undefined when there is no reading or the window is over. */
  fiveFree?: number
}

export interface RelayInput {
  from: AccountId
  projectId: string
  agents: RelayCandidate[]
  /** The turn the user chose in «Próximo»; accounts not in it go after, the one with more week first. */
  order: string[]
  status: Record<string, AccountStatus | undefined>
  /** The session that stopped was on Fable: an account that still has Fable goes first. */
  wantsFable: boolean
  /** Accounts the user marked as out of Fable (Claude Code does not report the limit of each model). */
  noFable: string[]
}

export type RelayChoice = { to: AccountId; fable: boolean; why: string } | { to?: undefined; why: string }

/** Below this an account would stop again within minutes: the hand-off would cost more context than it saves. */
const MIN_WEEK_FREE = 5

export function pickSuccessor(i: RelayInput): RelayChoice {
  const busyHere = i.agents.find((a) => a.id !== i.from && isWorkingOn(a, i.projectId))
  if (busyHere) return { why: t('{id} ya está trabajando en este proyecto y seguirá la cola: abrir otra cuenta gastaría el doble', { id: busyHere.id }) }
  const out: string[] = []
  const can = i.agents.filter((a) => {
    if (a.id === i.from) return false
    const s = i.status[a.id]
    if (s) { out.push(`${a.id} ${s === 'baja' ? 'de baja' : 'apartada'}`); return false }
    if (a.state === 'sin-uso') { out.push(`${a.id} sin uso`); return false }
    if (a.state === 'desconectado') { out.push(`${a.id} sin sesión iniciada`); return false }
    if (a.weekFree != null && a.weekFree < MIN_WEEK_FREE) { out.push(`${a.id} con el ${a.weekFree} % de la semana`); return false }
    // Seen on 12-11: claude3, at 99 % of its 5 hours, was the one chosen to take over. It would have stopped at once.
    if (a.fiveFree != null && a.fiveFree < MIN_WEEK_FREE) { out.push(`${a.id} con el ${a.fiveFree} % de sus 5 horas`); return false }
    return true
  })
  if (!can.length) return { why: t('ninguna cuenta puede seguir ({v0})', { v0: out.join('; ') || 'no hay más cuentas' }) }
  const hasFable = (a: RelayCandidate) => !i.noFable.includes(a.id)
  const place = (a: RelayCandidate) => { const n = i.order.indexOf(a.id); return n < 0 ? 1e6 : n }
  const sorted = [...can].sort((a, b) =>
    (i.wantsFable ? Number(hasFable(b)) - Number(hasFable(a)) : 0) || place(a) - place(b) || (b.weekFree ?? 50) - (a.weekFree ?? 50))
  const to = sorted[0]
  const fable = i.wantsFable && hasFable(to)
  return { to: to.id, fable, why: i.wantsFable && !fable ? t('ninguna cuenta libre tiene Fable: sigue con su modelo habitual lo que esté definido') : fable ? t('tiene Fable y es la siguiente del turno') : t('es la siguiente del turno') }
}

/** One hand-off per account and project in this time: a session that hits the limit again and again must not open windows. */
export const RELAY_COOLDOWN_MS = 30 * 60_000
/** Events older than this are the spool being read after the app was closed: the moment has passed. */
export const RELAY_FRESH_MS = 3 * 60_000

/**
 * From this share of its 5 hours or its week an account that ends its turn is treated as stopped: at 95 % it is told to
 * start nothing new and write the hand-off, so it ends on its own and the limit error never comes (claude3, 12-11, at 99 %).
 */
export const RELAY_AT_PCT = 95

export function shouldRelay(e: { at: number; error?: string; event?: string; usedPct?: number }, lastRelayAt: number | undefined, now = Date.now()): boolean {
  const spent = e.event === 'Stop' && (e.usedPct ?? 0) >= RELAY_AT_PCT
  if (e.error !== 'rate_limit' && !spent) return false
  if (now - e.at > RELAY_FRESH_MS) return false
  return !lastRelayAt || now - lastRelayAt > RELAY_COOLDOWN_MS
}

/** What the new window is told. It carries no context of its own: `pmc relevo` and `pmc parte` give it, short. */
export function relayPrompt(from: AccountId, projectName: string, fable: boolean, wantsFable: boolean): string {
  return [
    `Relevo automático de Mission Control: ${from} se ha quedado sin uso trabajando en ${projectName}.`,
    `Ejecuta pmc relevo ${from} y pmc parte, y sigue su trabajo desde donde lo dejó, sin repetir lo hecho.`,
    wantsFable && !fable ? 'Su trabajo iba con Fable y tú no lo tienes: haz solo las tareas que estén definidas para tu modelo y deja el resto apuntado en el relevo.' : '',
    'Pon al día el relevo al cerrar cada bloque.'
  ].filter(Boolean).join(' ')
}
