// EV159 (the user, 14-11 12:40: «un botón para "lanzar solo esta tarea"… y que al terminar se cierre el claude, para
// que no entre en modo autónomo… aunque ponga "no usar" si se la he mandado a ese claude, que se use para esa tarea»):
// an account opened for one task only. While the mark lasts its Stop hook never tells it to go on (autonomous mode, the
// wheel's holder), and once it hands the task in (release or done) the app closes its window and drops the mark.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from './paths'
import type { AccountId } from './types'
import type { DB } from './db'
import { t } from './i18n'

export interface OnlyTask {
  projectId: string
  taskKey: string
  /** What the user knows it by (EV12, or the start of its title). */
  label: string
  at: number
  /**
   * EV160: opened again to carry out the user's answer to a question it asked (it had closed after its task): it is done
   * when it ends a turn after that, not when it releases a task.
   */
  decisionId?: number
  /** EV182: opened for a note the user wrote to it by name (MC-<id>): done, like an answer, when it ends a turn after that. */
  noteId?: number
}

/** After this long the mark goes, done or not: a forgotten one must not keep an account out of autonomous mode for days. */
export const ONLY_TASK_MS = 12 * 3600_000

const file = () => join(paths.root(), 'solo-tarea.json')

export function readOnlyTasks(now = Date.now()): Record<string, OnlyTask> {
  try {
    const all = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, OnlyTask>
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && now - v.at < ONLY_TASK_MS))
  } catch { return {} }
}

export function onlyTaskOf(account: string, now = Date.now()): OnlyTask | undefined {
  return readOnlyTasks(now)[account]
}

export function setOnlyTask(account: AccountId, v: OnlyTask | undefined): void {
  const all = readOnlyTasks()
  if (v) all[account] = v
  else delete all[account]
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(all))
}

/** The prompt it starts with: that task, nothing else, and how to finish (its Stop hook lets it stop afterwards). */
export function onlyTaskPrompt(o: { label: string; title: string; projectName: string }): string {
  const clean = (s: string) => s.replace(/["%^&|<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean(t('Mission Control: el usuario te ha abierto en {project} para UNA sola tarea: {label} ({title}). ', { project: o.projectName, label: o.label, title: o.title.slice(0, 160) }) +
    t('Resérvala con pmc claim {label}, lee su texto entero con pmc tarea {label} y lo que el usuario te haya escrito sobre ella, y hazla. ', { label: o.label }) +
    t('Te la ha pedido el usuario ahora: no esperes a tiempos muertos ni a otro turno, aunque tu cuenta esté apartada para lo demás. ') +
    t('No cojas ninguna otra tarea aunque veas más en tu cola o te lo proponga el modo autónomo, y no borres nada que no se pueda recuperar sin preguntarlo antes con pmc decide (mejor muévelo a una carpeta aparte). ') +
    t('Al terminar: pmc entrega {label} si hay algo que mirar, pmc release {label}, deja el relevo al día con pmc guarda (Mission Control cerrará esta ventana) y luego para.', { label: o.label }))
}

/**
 * Has it handed the task in since it was opened for it? Released by that account, marked done, or delivered for review.
 * Read from the database the hooks and the CLI write to.
 */
export function onlyTaskFinished(db: DB, account: AccountId, t: OnlyTask): boolean {
  const done = db.prepare("SELECT COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND key = ?").get(t.projectId, t.taskKey) as { st?: string } | undefined
  if (done?.st === 'terminada') return true
  // Any release of its own there counts: it may have filed the task in TASKS.md under a new ID and worked on that one.
  const released = db.prepare("SELECT 1 FROM claim_history WHERE project_id = ? AND account = ? AND action = 'liberada' AND at > ? LIMIT 1").get(t.projectId, account, t.at)
  return Boolean(released)
}

// ---- EV160 (the user, 14-11 13:10: «si un claude ha mandado una pregunta… si se ha cerrado y respondo esa tarea,
// debería entender que quiero realizarla ahora, volverse a abrir y terminarla, para luego volverse a cerrar») ---------

/** How long after closing, an answer to one of its questions still opens it again. */
export const REOPEN_MS = 48 * 3600_000

const closedFile = () => join(paths.root(), 'solo-tarea-cerradas.json')

/** The accounts the app closed after their one task, lately: whose questions, once answered, bring them back. */
export function readClosedOnly(now = Date.now()): Record<string, OnlyTask & { closedAt: number }> {
  try {
    const all = JSON.parse(readFileSync(closedFile(), 'utf8')) as Record<string, OnlyTask & { closedAt: number }>
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && now - v.closedAt < REOPEN_MS))
  } catch { return {} }
}

export function rememberClosed(account: AccountId, t: OnlyTask, now = Date.now()): void {
  const all = readClosedOnly(now)
  all[account] = { ...t, decisionId: undefined, closedAt: now }
  mkdirSync(dirname(closedFile()), { recursive: true })
  writeFileSync(closedFile(), JSON.stringify(all))
}

/**
 * Should answering this question open its Claude again? Only for one the app closed after its one task in that project,
 * asked while it was open for it (or after), and with no window of its own there now.
 */
export function reopenForAnswer(d: { askedBy?: string; projectId: string; createdAt: number }, closed: Record<string, OnlyTask & { closedAt: number }>, hasSessionThere: boolean): (OnlyTask & { closedAt: number }) | undefined {
  if (!d.askedBy || hasSessionThere) return undefined
  const c = closed[d.askedBy]
  if (!c || c.projectId !== d.projectId || d.createdAt < c.at) return undefined
  return c
}

/** The prompt it is opened with to carry out the answer: that and nothing else, then stop. */
export function answerPrompt(o: { projectName: string; label: string; title: string; decisionId: number }): string {
  const clean = (s: string) => s.replace(/["%^&|<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean(t('Mission Control: el usuario ha contestado tu pregunta «{title}» (#{id}) sobre {label} en {project}, y quiere que lo hagas ahora. ', { title: o.title.slice(0, 120), id: o.decisionId, label: o.label, project: o.projectName }) +
    t('Lee su respuesta con pmc respuestas y haz exactamente lo que dice, solo eso: no cojas otras tareas aunque las veas en tu cola o te lo proponga el modo autónomo. ') +
    t('Al terminar, pmc entrega {label} si hay algo que mirar, deja el relevo al día con pmc guarda (Mission Control cerrará esta ventana) y luego para.', { label: o.label }))
}

/**
 * EV182 (the user, 15-11 03:11: «si te escribo directamente sí deberías activarte aun que estés apartada/parada… pero
 * seguir estando parada cuando termines la tarea… no deberías entrar en el relevo»): the prompt of an account set aside,
 * opened for a note the user wrote to it. The note itself also comes whole at the start (SessionStart).
 */
export function notePrompt(o: { projectName: string; id: number; body: string }): string {
  const clean = (s: string) => s.replace(/["%^&|<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  const body = clean(o.body)
  return clean(t('Mission Control: el usuario te ha escrito a ti en {project} y te ha abierto solo para eso (MC-{id}): «{body}». ', { project: o.projectName, id: o.id, body: body.length > 900 ? body.slice(0, 900).replace(/\s+\S*$/, '') + t('… (entera, en lo que te llega al empezar)') : body }) +
    t('Hazlo ahora, aunque tu cuenta esté apartada para lo demás; si es una tarea, apúntala en docs/TASKS.md con la marca (MC-{id}) en su línea. ', { id: o.id }) +
    t('No cojas ninguna otra tarea aunque veas más en tu cola o te lo proponga el modo autónomo, y no borres nada que no se pueda recuperar sin preguntarlo antes con pmc decide. Lo que tenga que decidir el usuario, pregúntalo con pmc decide y no en este chat (cuando conteste, Mission Control te volverá a abrir). ') +
    t('Al terminar: pmc entrega si hay algo que mirar, deja el relevo al día con pmc guarda (Mission Control cerrará esta ventana y tu cuenta seguirá parada) y luego para.'))
}

/** For a reopening (decisionId): it ended a turn after being opened, so it has done what the answer asked. */
export function endedTurnSince(activityTail: { at: number; event?: string }[], since: number): boolean {
  return activityTail.some((a) => a.event === 'Stop' && a.at > since + 5_000)
}
