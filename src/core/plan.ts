import { t } from './i18n'
// How many accounts are worth running at once on a project, and on what (EV20; the user, 12-11: «debe autogestionarse»).
// Only the decision, as a pure function; launching is the app's. The rule (docs/MISION.md): parallel work is limited by
// what cannot be shared, not by how many accounts are free. A front is one account in one copy of the project doing one
// task; two fronts must not need the same single-use resource (Unity, the graphics card) nor work on the same system.
import type { AccountId } from './types'
import { taskTags } from './coord'

export interface PlanTask { key: string; extId?: string; title: string; detail?: string; section: string; priority: number; status: string }
export interface PlanAccount { id: AccountId; weekFree?: number; hasFable: boolean }
export interface Front { account: AccountId; task: string; copy: string; model?: string; needs: string[] }
export interface Plan { fronts: Front[]; queue: AccountId[]; why: string }

export interface PlanInput {
  /** Free tasks, already in the order they should be done (what `pmc next` would give, for nobody in particular). */
  tasks: PlanTask[]
  /** Accounts that can work now, in the order of the user's turn. */
  accounts: PlanAccount[]
  /** Copies of the project nobody is working in. */
  freeCopies: string[]
  /** Resources taken or busy right now: a task that needs one of them waits. */
  busy: string[]
  /** The user's cap on accounts at once. */
  max: number
}

const wantsFable = (model?: string) => Boolean(model && /fable/.test(model) && !/sonnet|haiku/.test(model))

export function planFronts(i: PlanInput): Plan {
  const fronts: Front[] = []
  const usedNeeds = new Set(i.busy)
  const usedSections = new Set<string>()
  const left = [...i.accounts]
  const copies = [...i.freeCopies]
  for (const t of i.tasks) {
    if (fronts.length >= i.max || !left.length || !copies.length) break
    const tags = taskTags(`${t.title} ${t.detail ?? ''}`)
    if (tags.needs.some((n) => usedNeeds.has(n))) continue
    // Two tasks of the same section are the same system: side by side they would edit the same files.
    if (usedSections.has(t.section)) continue
    // The task that asks for Fable goes to an account that has it; the rest, to accounts without it first, to save it.
    const fable = wantsFable(tags.model)
    const pick = fable ? left.find((a) => a.hasFable) : left.find((a) => !a.hasFable) ?? left[0]
    if (!pick) continue
    left.splice(left.indexOf(pick), 1)
    fronts.push({ account: pick.id, task: t.extId ?? t.key, copy: copies.shift()!, model: tags.model, needs: tags.needs })
    tags.needs.forEach((n) => usedNeeds.add(n))
    usedSections.add(t.section)
  }
  const why = !i.tasks.length ? 'no hay tareas libres'
    : !i.accounts.length ? 'ninguna cuenta tiene uso ahora'
    : fronts.length <= 1 ? 'solo cabe un frente: las demás tareas son del mismo sistema, esperan un recurso ocupado o no hay más copias libres; las otras cuentas quedan en cola de relevo'
    : `caben ${fronts.length} frentes a la vez sin pisarse`
  return { fronts, queue: left.map((a) => a.id), why }
}

/** A project nobody touched in this time is not «being worked on»: the app starts nothing there by itself. */
export const STAFF_RECENT_MS = 24 * 3600_000
/** After a launch (or a hand-off) the new window needs time to show up as working. */
export const STAFF_COOLDOWN_MS = 15 * 60_000
/** Windows that open and then sit idle must not pile up: after this many in six hours the app waits for the user. */
export const STAFF_MAX_LAUNCHES = 4

export interface StaffInput {
  /** Accounts already working on the project. */
  working: number
  /** Tasks reserved there and not expired: someone is on them, even from a window opened in another folder. */
  claims: number
  /** The last time an account wrote or opened a session in the project. */
  lastActivityAt?: number
  /** The last time the app opened an account there (launch, hand-off or scheduled start). */
  lastLaunchAt?: number
  /** Accounts the app opened there by itself in the last six hours. */
  launches?: number
  /** A start already scheduled for this project: that account is coming. */
  scheduledSoon: boolean
  /** The user is playing: no windows now. */
  playing: boolean
  max: number
  now?: number
}

/**
 * How many more accounts the app should open now on a project it is allowed to keep going (the user, 12-11: «si quedan
 * tareas y se está trabajando en un proyecto, se debe seguir trabajando»). 0 with the reason when it should not.
 */
export function staffGap(i: StaffInput): { open: number; why: string } {
  const now = i.now ?? Date.now()
  if (i.playing) return { open: 0, why: t('el usuario está jugando: no se abren ventanas') }
  if (!i.lastActivityAt || now - i.lastActivityAt > STAFF_RECENT_MS) return { open: 0, why: t('nadie ha trabajado en este proyecto en el último día') }
  if (i.lastLaunchAt && now - i.lastLaunchAt < STAFF_COOLDOWN_MS) return { open: 0, why: t('se acaba de abrir una cuenta aquí') }
  if ((i.launches ?? 0) >= STAFF_MAX_LAUNCHES) return { open: 0, why: t('ya se han abierto {launches} cuentas aquí en seis horas y ninguna sigue trabajando: algo las para', { launches: i.launches }) }
  if (i.scheduledSoon) return { open: 0, why: t('hay un arranque programado en este proyecto') }
  const busy = Math.max(i.working, i.claims ? 1 : 0)
  if (busy >= i.max) return { open: 0, why: busy ? t('ya hay quien trabaja aquí') : t('el tope de cuentas a la vez es cero') }
  return { open: i.max - busy, why: busy ? 'cabe otro frente' : t('quedan tareas y nadie trabaja aquí') }
}
