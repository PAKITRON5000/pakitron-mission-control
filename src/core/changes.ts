import { t, t as tr } from './i18n'
// What the user asks to change after reviewing a task (the user, 5-11): the note stays attached to the task, can be edited
// or taken back, says where it is on its way to the Claude, and moves the task out of «Para revisar» until it is done.
import type { DB } from './db'
import type { AccountId, TaskChange } from './types'
import { addEvent } from './db'
import { addInstruction } from './review'

/** How the Claude's notes recognise a review: unlike any other note, it goes before new work. */
export const REVIEW_PREFIX = 'Revisión del usuario'

const SELECT = 'SELECT c.*, i.delivered_at FROM task_changes c LEFT JOIN instructions i ON i.id = c.instruction_id'

function rowToChange(r: any): TaskChange {
  return {
    id: r.id, projectId: r.project_id, taskKey: r.task_key, extId: r.ext_id ?? undefined, note: r.note, status: r.status, target: r.target ?? undefined,
    urgent: Boolean(r.urgent), instructionId: r.instruction_id ?? undefined, readAt: r.delivered_at ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at ?? undefined
  }
}

/** The change each task has now: still open, or done and waiting for the user to look again. */
export function taskChanges(db: DB, projectId: string): Map<string, TaskChange> {
  const rows = db.prepare(`${SELECT} WHERE c.project_id = ? AND c.status IN ('pedido', 'hecho') ORDER BY c.created_at, c.id`).all(projectId) as any[]
  return new Map(rows.map((r) => [r.task_key, rowToChange(r)]))
}

/** What this account has to change, whether the note has reached it yet or not; a note for nobody in particular counts for all. */
export function openChangesFor(db: DB, projectId: string, account: AccountId): (TaskChange & { title: string; priority: number })[] {
  const rows = db.prepare(`SELECT c.*, i.delivered_at, t.title AS task_title, t.priority AS task_priority FROM task_changes c
    LEFT JOIN instructions i ON i.id = c.instruction_id JOIN tasks t ON t.project_id = c.project_id AND t.key = c.task_key AND t.gone = 0
    WHERE c.project_id = ? AND c.status = 'pedido' AND (c.target = ? OR c.target IS NULL) ORDER BY c.urgent DESC, c.created_at`).all(projectId, account) as any[]
  return rows.map((r) => ({ ...rowToChange(r), title: r.task_title, priority: r.task_priority }))
}

/** Who answers for a task now: the account it was assigned to by the user, or its owner. */
export function responsibleFor(db: DB, projectId: string, owner?: string): AccountId | undefined {
  if (!owner) return undefined
  const r = db.prepare('SELECT to_account FROM assignments WHERE project_id = ? AND from_account = ? ORDER BY position, id LIMIT 1').get(projectId, owner) as { to_account: AccountId } | undefined
  return r?.to_account ?? (owner as AccountId)
}

function bodyFor(extId: string | undefined, title: string, note: string): string {
  const after = extId ? tr('Cuando esté, enséñaselo con pmc entrega {extId} --que … --mirar … --foto …: así vuelve a «Para revisar».', { extId }) : tr('Cuando esté, díselo para que lo vuelva a mirar.')
  return tr('{REVIEW_PREFIX} de {v0} («{title}»): {note} {after}', { REVIEW_PREFIX: REVIEW_PREFIX, v0: extId ?? tr('una tarea'), title: title, note: note, after: after })
}

const send = (db: DB, c: { projectId: string; target?: AccountId; urgent: boolean; body: string }) =>
  addInstruction(db, { projectId: c.projectId, kind: c.urgent ? 'prioridad' : 'correccion', target: c.target, body: c.body })

function getRow(db: DB, id: number): any {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id)
  if (!r) throw new Error(t('Esa nota ya no existe'))
  return r
}

function taskOf(db: DB, projectId: string, key: string): { ext_id?: string; title: string } {
  return (db.prepare('SELECT ext_id, title FROM tasks WHERE project_id = ? AND key = ?').get(projectId, key) as { ext_id?: string; title: string } | undefined) ?? { title: key }
}

export function askChange(db: DB, a: { projectId: string; taskKey: string; note: string; target?: AccountId; urgent?: boolean }, now = Date.now()): TaskChange {
  const note = a.note.trim()
  if (!note) throw new Error(tr('Escribe qué hay que cambiar'))
  // A task has one open note: writing again on it is editing it.
  const open = db.prepare("SELECT id FROM task_changes WHERE project_id = ? AND task_key = ? AND status = 'pedido' ORDER BY id DESC LIMIT 1").get(a.projectId, a.taskKey) as { id: number } | undefined
  if (open) return updateChange(db, open.id, { note, target: a.target ?? null, urgent: a.urgent }, now)
  const t = taskOf(db, a.projectId, a.taskKey)
  const urgent = Boolean(a.urgent)
  const ins = send(db, { projectId: a.projectId, target: a.target, urgent, body: bodyFor(t.ext_id, t.title, note) })
  const r = db.prepare('INSERT INTO task_changes(project_id, task_key, ext_id, note, status, instruction_id, target, urgent, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(a.projectId, a.taskKey, t.ext_id ?? null, note, 'pedido', ins.id, a.target ?? null, urgent ? 1 : 0, now, now)
  return rowToChange(getRow(db, Number(r.lastInsertRowid)))
}

/**
 * Changes the note, who it is for, or whether it is for right now. While nobody has read it, the message itself is rewritten;
 * once read it cannot be unread, so the Claude gets a new one that says what changed.
 */
export function updateChange(db: DB, id: number, p: { note?: string; target?: AccountId | null; urgent?: boolean }, now = Date.now()): TaskChange {
  const c = getRow(db, id)
  const note = p.note?.trim() || c.note
  const target: AccountId | null = p.target === undefined ? c.target : p.target
  const urgent = p.urgent ?? Boolean(c.urgent)
  if (note === c.note && target === c.target && urgent === Boolean(c.urgent)) return rowToChange(c)
  const t = taskOf(db, c.project_id, c.task_key)
  const body = bodyFor(t.ext_id, t.title, note)
  let instruction = c.instruction_id
  if (c.delivered_at == null && c.instruction_id) {
    db.prepare('UPDATE instructions SET body = ?, target = ?, kind = ?, updated_at = ? WHERE id = ?').run(body, target, urgent ? 'prioridad' : 'correccion', now, c.instruction_id)
  } else {
    if (c.target && target !== c.target) send(db, { projectId: c.project_id, target: c.target, urgent: false, body: tr('Ya no hace falta el cambio que te pidió el usuario en {task} («{note}»): lo hará {who}.', { task: t.ext_id ?? t.title, note: c.note, who: target ?? tr('otra cuenta') }) })
    const again = note === c.note ? tr('Lo pide ahora, antes que lo demás. ') : tr('Cambia lo que pidió antes («{note}»). ', { note: c.note })
    instruction = send(db, { projectId: c.project_id, target: target ?? undefined, urgent, body: `${again}${body}` }).id
  }
  db.prepare('UPDATE task_changes SET note = ?, target = ?, urgent = ?, instruction_id = ?, updated_at = ? WHERE id = ?').run(note, target, urgent ? 1 : 0, instruction, now, id)
  return rowToChange(getRow(db, id))
}

/** A note for «the first that works» belongs from now on to the one it reached, so the others stop being told about it. */
export function takeChange(db: DB, instructionId: number, account: AccountId): void {
  db.prepare('UPDATE task_changes SET target = ? WHERE instruction_id = ? AND target IS NULL').run(account, instructionId)
}

/** Takes the note back. If it was already read, the Claude has to be told to forget it. */
export function removeChange(db: DB, id: number, now = Date.now()): void {
  const c = getRow(db, id)
  const t = taskOf(db, c.project_id, c.task_key)
  if (c.delivered_at == null && c.instruction_id) db.prepare("UPDATE instructions SET status = 'anulada', updated_at = ? WHERE id = ?").run(now, c.instruction_id)
  else send(db, { projectId: c.project_id, target: c.target ?? undefined, urgent: false, body: tr('Olvida el cambio que te pidió el usuario en {task} («{note}»): ya no hace falta. Si lo habías empezado, déjalo como estaba.', { task: t.ext_id ?? t.title, note: c.note }) })
  db.prepare("UPDATE task_changes SET status = 'quitado', updated_at = ? WHERE id = ?").run(now, id)
  addEvent(db, { projectId: c.project_id, at: now, kind: 'instruccion', title: tr('Has quitado tu nota sobre {task}: «{note}»', { task: t.ext_id ?? t.title, note: c.note.slice(0, 100) }), source: 'Mission Control' })
}

/**
 * A Claude delivers the task again: what was asked is done and it goes back to the user. Only a note that reached it counts:
 * delivering the task for any other reason must not close something it has not even read.
 */
export function finishChange(db: DB, projectId: string, extId: string, now = Date.now()): number {
  const rows = db.prepare(`${SELECT} WHERE c.project_id = ? AND c.ext_id = ? AND c.status = 'pedido' AND i.delivered_at IS NOT NULL`).all(projectId, extId) as any[]
  for (const r of rows) {
    db.prepare("UPDATE task_changes SET status = 'hecho', done_at = ?, updated_at = ? WHERE id = ?").run(now, now, r.id)
    if (r.instruction_id) db.prepare("UPDATE instructions SET status = 'ejecutada', updated_at = ? WHERE id = ?").run(now, r.instruction_id)
    addEvent(db, { projectId, at: now, account: r.target ?? undefined, kind: 'tarea', title: t('{extId}: cambios hechos, vuelve a «Para revisar»', { extId: extId }), source: 'pmc entrega' })
  }
  return rows.length
}

/** Once: the notes sent in the last day, before they stayed attached to their task, find it. */
export function linkRecentCorrections(db: DB, projectId: string, now = Date.now()): number {
  const flag = `changesLinked:${projectId}`
  if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(flag)) return 0
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?)').run(flag, '1')
  const rows = db.prepare("SELECT id, body, target, delivered_at, created_at FROM instructions WHERE project_id = ? AND kind = 'correccion' AND comment_id IS NULL AND status != 'ejecutada' AND created_at > ?").all(projectId, now - 86400_000) as any[]
  let n = 0
  for (const r of rows) {
    const m = String(r.body).match(/^Sobre (\S+) \(«.*?»\): ([\s\S]+)$/)
    if (!m) continue
    const task = db.prepare('SELECT key, ext_id, title, owner FROM tasks WHERE project_id = ? AND ext_id = ? AND gone = 0').get(projectId, m[1]) as any
    if (!task) continue
    const note = m[2].trim()
    // Still unread, it can go to whoever has the task now and say what a review says.
    const target = r.delivered_at == null ? responsibleFor(db, projectId, task.owner) ?? r.target : r.target
    if (r.delivered_at == null) db.prepare('UPDATE instructions SET body = ?, target = ?, updated_at = ? WHERE id = ?').run(bodyFor(task.ext_id, task.title, note), target ?? null, now, r.id)
    db.prepare('INSERT INTO task_changes(project_id, task_key, ext_id, note, status, instruction_id, target, urgent, created_at, updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)')
      .run(projectId, task.key, task.ext_id, note, 'pedido', r.id, target ?? null, r.created_at, now)
    n++
  }
  return n
}
