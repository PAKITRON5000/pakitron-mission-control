import { t } from './i18n'
// The one gate every automatic window goes through (the user, 12-11 at 06:00: «no para de abrir pestañas cada vez que
// uno termina, porque no está entendiendo cómo funciona el relevo automático ni qué claude trabaja en qué»).
//
// Until 0.13.15 seven separate automatisms could open or type into windows (hand-off, automatic distribution, start at
// reset by the Windows Task Scheduler, call back in the window, heavy-work turns, the project's own wake hook and the
// answer watcher), each with its own idea of who was working. A start scheduled at 03:34 for claude3 fired at 06:03 and
// opened a second claude3 window on the very project the first one was working on. The rules that hold here:
//   1. One window per account. An account with a window open is told in that window; it never gets a second one.
//   2. A project has at most `maxPerProject` accounts working at once (1 unless the user raised it).
//   3. An account set aside or unpaid is never opened.
//   4. The same account is not opened twice within the cooldown, whatever asked for it.
// A start scheduled hours earlier is checked again here at the moment it fires (`pmc puede-arrancar`).
import type { AccountId } from './types'

export interface AccountWindow {
  account: AccountId
  sessionId: string
  /** The process of the window: what can be typed into. Background sessions have none and are not windows. */
  pid?: number
  projectId?: string
  /** Its conversation is moving now. */
  working: boolean
}

/** `reserva`: the backup account of core/reserve.ts, the only reason that opens an account set aside («No usar»). */
export type LaunchReason = 'relevo' | 'reparto' | 'arranque' | 'vuelta' | 'reserva'

export interface LaunchAsk {
  account: AccountId
  projectId: string
  reason: LaunchReason
}

export interface LaunchWorld {
  windows: AccountWindow[]
  /** «No usar» (pausada) or «De baja» (baja), from Ajustes › Cuentas. */
  status: Record<string, string | undefined>
  /** Accounts working on each project right now (any window or session with work under way). */
  workingOn: Record<string, AccountId[]>
  maxPerProject: number
  /** When the app last opened each account by itself. */
  lastOpened: Record<string, number | undefined>
  now: number
}

export type LaunchDecision =
  | { action: 'abrir'; why: string }
  | { action: 'avisar'; pid: number; sessionId: string; why: string }
  | { action: 'nada'; why: string }

export const OPEN_COOLDOWN_MS = 10 * 60_000

const name = (id: string) => `Claude ${id.slice(6)}`

export function decideLaunch(ask: LaunchAsk, w: LaunchWorld): LaunchDecision {
  const who = name(ask.account)
  const st = w.status[ask.account]
  if (st && !(st === 'pausada' && ask.reason === 'reserva')) return { action: 'nada', why: t('{who} está {v0}', { who: who, v0: st === 'baja' ? 'de baja' : 'apartada («No usar»)' }) }
  const mine = w.windows.filter((x) => x.account === ask.account && x.pid)
  const here = mine.find((x) => x.projectId === ask.projectId)
  if (here) {
    if (here.working) return { action: 'nada', why: t('{who} ya está trabajando en su ventana de este proyecto', { who: who }) }
    return { action: 'avisar', pid: here.pid!, sessionId: here.sessionId, why: t('{who} ya tiene su ventana abierta en este proyecto: se le escribe ahí en vez de abrir otra', { who: who }) }
  }
  const elsewhere = mine.find((x) => x.working) ?? mine[0]
  if (elsewhere) return { action: 'nada', why: t('{who} ya tiene una ventana abierta{v0}: una cuenta, una ventana', { who: who, v0: elsewhere.projectId ? ` en otro proyecto (${elsewhere.projectId})` : '' }) }
  const others = (w.workingOn[ask.projectId] ?? []).filter((a) => a !== ask.account)
  if (others.length >= Math.max(1, w.maxPerProject)) return { action: 'nada', why: t('ya trabaja{v0} {v1} en este proyecto (tope: {v2} a la vez)', { v0: others.length > 1 ? 'n' : '', v1: others.map(name).join(' y '), v2: Math.max(1, w.maxPerProject) }) }
  const last = w.lastOpened[ask.account]
  if (last && w.now - last < OPEN_COOLDOWN_MS) return { action: 'nada', why: t('{who} se abrió hace {v0} min: se espera a que arranque', { who: who, v0: Math.max(1, Math.round((w.now - last) / 60_000)) }) }
  return { action: 'abrir', why: t('nadie más está en este proyecto y la cuenta no tiene ventana') }
}

/** Who is working where, from the windows and sessions the app or the CLI can see. */
export function workingMap(windows: AccountWindow[]): Record<string, AccountId[]> {
  const out: Record<string, AccountId[]> = {}
  for (const x of windows) {
    if (!x.working || !x.projectId) continue
    const list = (out[x.projectId] ??= [])
    if (!list.includes(x.account)) list.push(x.account)
  }
  return out
}
