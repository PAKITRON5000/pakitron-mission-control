// Backup account (IV1, the user on 13-11: «cuando estemos completamente parados esperando el de las 15:00, la app lance
// ese claude de [otra cuenta]… aunque la app marque no usar, esto lo estoy pidiendo concretamente así que deberá ignorarlo»).
// A rule names an account and a project: when every other account in use is out of usage, the app opens that account
// on that project, even if it is set aside («No usar»); never if it is unpaid («De baja») or out of usage itself.
import type { AccountId } from './types'

export interface ReserveRule {
  account: AccountId
  projectId: string
  on: boolean
}

export interface ReserveAgent {
  id: AccountId
  state: string
  usage: { activeLimit?: { resetsAt: number } }
}

export type ReserveVerdict = { open: true; why: string } | { open: false; why: string }

const name = (id: string) => `Claude ${id.slice(6)}`
const hour = (t: number) => new Date(t).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * `work`: what is left for it in its project. With no open task and nothing from the user to read it is not opened
 * (13-11: Claude 5 finished the video project and asked in Decidir «Mission Control me sigue abriendo sin tareas»).
 */
export function reserveDue(rule: ReserveRule, agents: ReserveAgent[], status: Record<string, string | undefined>, now: number, work?: { openTasks: number; toRead: number }): ReserveVerdict {
  if (!rule.on) return { open: false, why: 'la regla está apagada' }
  if (work && !work.openTasks && !work.toRead) return { open: false, why: 'no le queda trabajo en su proyecto (ni tareas abiertas ni respuestas tuyas por leer)' }
  if (status[rule.account] === 'baja') return { open: false, why: `${name(rule.account)} está de baja` }
  const me = agents.find((a) => a.id === rule.account)
  if (!me) return { open: false, why: `${name(rule.account)} no está entre las cuentas` }
  const mine = me.usage.activeLimit
  if (mine && mine.resetsAt > now) return { open: false, why: `${name(rule.account)} también está sin uso, hasta el ${hour(mine.resetsAt)}` }
  const others = agents.filter((a) => a.id !== rule.account && !status[a.id] && a.state !== 'baja' && a.state !== 'apartada')
  if (!others.length) return { open: false, why: 'no hay otras cuentas en uso con las que comparar' }
  const busy = others.filter((a) => a.state !== 'sin-uso')
  if (busy.length) return { open: false, why: `aún pueden trabajar ${busy.map((a) => name(a.id)).join(', ')}` }
  const back = Math.min(...others.map((a) => a.usage.activeLimit?.resetsAt ?? Infinity))
  // EV150 (the user, 14-11: «solo en momentos muertos que haya bastante margen de trabajo»).
  if (Number.isFinite(back) && back - now < RESERVE_MIN_MARGIN_MS) return { open: false, why: `la primera vuelve pronto (${hour(back)}): no hay margen para trabajar` }
  return { open: true, why: `todas las demás cuentas están sin uso${Number.isFinite(back) ? ` (la primera vuelve el ${hour(back)})` : ''}` }
}

/** EV150: the backup only opens with at least this long before the first other account is back. */
export const RESERVE_MIN_MARGIN_MS = 60 * 60_000
/** And it is told to leave everything safe and close this long before that account is back (or as soon as one is). */
export const RESERVE_WRAP_UP_MS = 25 * 60_000

/**
 * EV150 (the user, 14-11: «cuando otro retome el the game project a su hora… que claude5 lo deje en un punto seguro antes de
 * que vuelva alguien y cerrar todo»): the moment to tell the backup at work to wrap up: another account can work again,
 * or the first one comes back within RESERVE_WRAP_UP_MS. Undefined while it can go on. `key` says it once per return.
 */
export function reserveWrapUp(rule: ReserveRule, agents: ReserveAgent[], status: Record<string, string | undefined>, now: number): { key: string; why: string } | undefined {
  if (!rule.on) return undefined
  const others = agents.filter((a) => a.id !== rule.account && !status[a.id] && a.state !== 'baja' && a.state !== 'apartada')
  const back = others.filter((a) => a.state !== 'sin-uso')
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0])
  if (back.length) return { key: `ya:${back.map((a) => a.id).sort().join(',')}`, why: `${list(back.map((a) => name(a.id)))} ya puede${back.length > 1 ? 'n' : ''} trabajar` }
  const first = Math.min(...others.map((a) => a.usage.activeLimit?.resetsAt ?? Infinity))
  if (Number.isFinite(first) && first - now <= RESERVE_WRAP_UP_MS) return { key: `pronto:${first}`, why: `la primera vuelve a las ${new Date(first).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` }
  return undefined
}

/** What the backup is told then (a notice it reads at its next step). */
export function wrapUpText(projectName: string, why: string): string {
  return `Mission Control (cuenta de reserva): ${why}, y el PC vuelve a ser para ellas. Deja ${projectName} en un punto seguro ya: termina o pausa sin romper lo que tengas en marcha (no cortes un render a medias: si le queda poco, déjalo acabar), guarda (pmc guarda), suelta tus reservas, cierra los programas que hayas abierto (editores de vídeo, exportadores…), y cierra esta sesión. No empieces nada nuevo.`
}

/**
 * The account a project is kept for, when a backup rule is on for it: that project is that account's alone, so the
 * automatic distribution and the relays never send another account there (13-11: The video project is the video account's,
 * and the others go on with Mission Control).
 */
export function reservedFor(rules: ReserveRule[] | undefined, projectId: string): AccountId | undefined {
  return (rules ?? []).find((r) => r.on && r.projectId === projectId)?.account
}

/** What the account is told when it is opened as the backup. One line: it is typed into a window too. */
export function reservePrompt(projectName: string): string {
  return `Mission Control (cuenta de reserva): todas las demás cuentas se han quedado sin uso y te toca trabajar en ${projectName} hasta que vuelva una (te avisará la app: entonces lo dejas todo a salvo, cierras Premiere y lo que abras, y cierras la sesión). Lee su CLAUDE.md, ejecuta pmc parte y sigue docs/TASKS.md por orden, sin parar hasta que la app te avise o te quedes sin uso; deja el relevo al día con pmc guarda al cerrar cada bloque.`
}
