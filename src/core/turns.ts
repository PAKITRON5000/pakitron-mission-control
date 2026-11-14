// How accounts working on different projects share the machine (the user, 12-11: «cada claude está trabajando en su
// proyecto individualmente… cuando tú te quedes sin créditos, el claude que ya está abierto, cuando vuelva a tener
// créditos, continúe pero con su trabajo, no con el tuyo… si os recargáis a la vez, primero uno y luego el otro para
// tareas exigentes; si uno trabaja en tareas simples, se pueden usar a la vez… que uno pare y el otro trabaje y que le
// llegue el aviso al chat abierto y siga… esto se tiene que poder decidir»). Everything here is the decision; typing in
// a window is the app's (main/index.ts).
import type { AccountId } from './types'
import { t } from './i18n'

/**
 * 'conjunto': the accounts relay each other on the same project (the hand-off opens the next one where the first was).
 * 'proyecto': each account keeps to its own project; nobody takes over another's work, and each takes its own up again,
 * in its own window, when its usage is back.
 */
export type RelayMode = 'conjunto' | 'proyecto'

export const RELAY_MODES: { id: RelayMode; label: string; sub: string }[] = [
  // EV162: getters, so they come out in the language chosen when they are read.
  { id: 'conjunto', get label() { return t('Relevos conjuntos') }, get sub() { return t('Todas en el mismo proyecto: cuando una se queda sin uso, la siguiente del turno sigue su trabajo.') } },
  { id: 'proyecto', get label() { return t('Cada una en su proyecto') }, get sub() { return t('Nadie toma el trabajo de otra: cuando una se queda sin uso, las demás siguen con lo suyo, y ella retoma lo suyo en su misma ventana al volver.') } }
]

export const relayModeOf = (s: { relayMode?: RelayMode }): RelayMode => (s.relayMode === 'proyecto' ? 'proyecto' : 'conjunto')

/** The programs that are heavy work: one at a time on the machine. */
export const HEAVY_PROGRAMS = ['unity.exe', 'blender.exe']

/**
 * The projects whose heavy work is running now: a Unity or a Blender started from inside one of its folders (the command
 * line of the program names the project, the Blender script or the copy it works on). Longest root first, so a copy
 * inside a project (a worktree) counts for that project.
 */
export function heavyProjects(commandLines: string[], projects: { id: string; roots: string[] }[]): string[] {
  const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  const roots = projects.flatMap((p) => p.roots.map((r) => ({ id: p.id, root: norm(r) }))).filter((r) => r.root.length > 3).sort((a, b) => b.root.length - a.root.length)
  const found = new Set<string>()
  for (const line of commandLines) {
    const l = norm(line)
    const hit = roots.find((r) => l.includes(r.root + '\\') || l.includes(r.root + '"') || l.endsWith(r.root))
    if (hit) found.add(hit.id)
  }
  return [...found]
}

export interface TurnAccount {
  id: AccountId
  /** The project it is working on (or was, when it stopped). */
  projectId?: string
  /** Its conversation is moving now. */
  working: boolean
  /** When it came back to work after its limit (its state went from out of usage to working); undefined otherwise. */
  resumedAt?: number
}

export interface Waiting {
  since: number
  holder: AccountId
  projectId: string
}

export interface TurnInput {
  now: number
  accounts: TurnAccount[]
  /** Projects with heavy work running (heavyProjects), and the projects whose turn an account holds (`pmc recurso`). */
  heavy: string[]
  /** Accounts already told to wait their turn. */
  waiting: Record<string, Waiting | undefined>
}

export type TurnAction =
  | { kind: 'esperar'; account: AccountId; holder: AccountId; projectId: string; holderProjectId: string }
  | { kind: 'seguir'; account: AccountId; projectId: string; holder: AccountId }

/** A comeback this recent is the moment to tell an account to wait; later it has chosen what to do already. */
export const RESUME_WINDOW_MS = 10 * 60_000

/**
 * Heavy work by turns between projects. An account that comes back while another, on another project, has heavy work
 * running is told to keep to light work or stop and wait; when nobody else holds heavy work any more (the holder ran
 * out, finished, or left it), the waiting one is told it is its turn.
 */
export function heavyTurns(i: TurnInput): TurnAction[] {
  const actions: TurnAction[] = []
  const holderOf = (except: TurnAccount) =>
    i.accounts.find((a) => a.id !== except.id && a.working && a.projectId && a.projectId !== except.projectId && i.heavy.includes(a.projectId))
  for (const a of i.accounts) {
    if (!a.projectId) continue
    const waiting = i.waiting[a.id]
    const holder = holderOf(a)
    if (waiting) {
      if (!holder) actions.push({ kind: 'seguir', account: a.id, projectId: waiting.projectId, holder: waiting.holder })
      continue
    }
    if (holder && a.working && a.resumedAt && i.now - a.resumedAt <= RESUME_WINDOW_MS)
      actions.push({ kind: 'esperar', account: a.id, holder: holder.id, projectId: a.projectId, holderProjectId: holder.projectId! })
  }
  return actions
}

const who = (id: string) => `Claude ${id.slice(6)}`

export function waitMessage(holder: AccountId, holderProject: string): string {
  return t('Mission Control (trabajo pesado por turnos): {v0} está usando Unity o Blender en {holderProject}. Si lo que te toca ahora es ligero (sin Unity, Blender, renders ni la gráfica), sigue con ello. Si necesitas lo pesado, cierra tu turno aquí sin empezarlo y espera: te escribiré en este chat cuando te toque.', { v0: who(holder), holderProject: holderProject })
}

export function goMessage(holder: AccountId, project: string): string {
  return t('Mission Control: ya te toca. {v0} ha terminado con lo pesado o se ha quedado sin uso. Sigue con tu trabajo en {project} donde lo dejaste, también lo pesado.', { v0: who(holder), project: project })
}

export function backMessage(project: string): string {
  return t('Mission Control: ya tienes uso otra vez. Sigue con tu trabajo en {project} donde lo dejaste, sin repetir lo hecho.', { project: project })
}

/**
 * When an account comes back from its limit, whether to call its open window: only if its conversation has not moved
 * since it stopped (the CLI's own auto-continue or the project's wake hook may have got it going already), and, when
 * the accounts relay each other, only if nobody else took over its project meanwhile.
 */
export function shouldCallBack(i: { stoppedAt: number; lastMovedAt?: number; mode: RelayMode; othersOnProject: number }): boolean {
  if ((i.lastMovedAt ?? 0) > i.stoppedAt + 30_000) return false
  if (i.mode === 'conjunto' && i.othersOnProject > 0) return false
  return true
}
