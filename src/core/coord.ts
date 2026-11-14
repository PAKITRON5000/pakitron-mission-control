import { t } from './i18n'
// Coordination between the four accounts: task reservations with expiry (so two Claudes never do the same task by not
// knowing), hand-offs when an account runs out, and the instructions waiting for an account when it starts a session.
// Everything is in the shared SQLite database; the CLI (`pmc claim`, hooks) and the app use the same functions.
import { listMemories, memoryText, recentDecisions } from './memory'
import { isSessionWorking } from './working'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AccountId, AgentCard, ProjectConfig } from './types'
import { isInside, nativePath, pathKey, paths } from './paths'
import { nodeRunner, shimReady } from './shim'
import { addEvent, type DB } from './db'
import { KIND_LABEL, setCommentStatus } from './review'
import { openChangesFor, REVIEW_PREFIX, takeChange } from './changes'
import { confirmTyped } from './notes'

export const LEASE_MS = 2 * 3600_000

export interface Claim {
  projectId: string
  taskKey: string
  account: AccountId
  sessionId?: string
  claimedAt: number
  heartbeatAt: number
  expiresAt: number
  note?: string
  /** The lease ran out without being released: the task was left half-done. */
  abandoned: boolean
}

function row(r: any, now: number): Claim {
  return {
    projectId: r.project_id, taskKey: r.task_key, account: r.account, sessionId: r.session_id ?? undefined, claimedAt: r.claimed_at,
    heartbeatAt: r.heartbeat_at, expiresAt: r.expires_at, note: r.note ?? undefined, abandoned: r.expires_at <= now
  }
}

/** Resolves "BZ56" (an id as written in TASKS.md) to the task key used in the database. */
export function taskKeyFor(db: DB, projectId: string, idOrKey: string): { key: string; title?: string } {
  const r = db.prepare('SELECT key, title FROM tasks WHERE project_id = ? AND (ext_id = ? OR key = ?) AND gone = 0 ORDER BY id LIMIT 1').get(projectId, idOrKey, idOrKey) as { key: string; title: string } | undefined
  return r ? { key: r.key, title: r.title } : { key: idOrKey }
}

export type ClaimResult = { ok: true; claim: Claim; renewed: boolean } | { ok: false; holder: Claim }

/** Reserves a task for an account. Fails if another account holds a live reservation; an expired one is taken over. */
export function claimTask(db: DB, projectId: string, taskKey: string, account: AccountId, opts: { sessionId?: string; note?: string; now?: number; leaseMs?: number } = {}): ClaimResult {
  const now = opts.now ?? Date.now()
  const lease = opts.leaseMs ?? LEASE_MS
  db.exec('BEGIN IMMEDIATE')
  try {
    const cur = db.prepare('SELECT * FROM claims WHERE project_id = ? AND task_key = ?').get(projectId, taskKey) as any
    if (cur && cur.account !== account && cur.expires_at > now) {
      db.exec('ROLLBACK')
      return { ok: false, holder: row(cur, now) }
    }
    const renewed = Boolean(cur && cur.account === account && cur.expires_at > now)
    db.prepare(
      `INSERT INTO claims(project_id, task_key, account, session_id, claimed_at, heartbeat_at, expires_at, note) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(project_id, task_key) DO UPDATE SET account = excluded.account, session_id = excluded.session_id,
         claimed_at = CASE WHEN claims.account = excluded.account AND claims.expires_at > ? THEN claims.claimed_at ELSE excluded.claimed_at END,
         heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at, note = COALESCE(excluded.note, claims.note)`
    ).run(projectId, taskKey, account, opts.sessionId ?? null, now, now, now + lease, opts.note ?? null, now)
    const action = renewed ? 'renovada' : cur && cur.account !== account ? `recogida (era de ${cur.account}, caducada)` : 'reservada'
    db.prepare('INSERT INTO claim_history(project_id, task_key, account, action, at, note) VALUES(?,?,?,?,?,?)').run(projectId, taskKey, account, action, now, opts.note ?? null)
    db.exec('COMMIT')
    if (!renewed) {
      const t = taskKeyFor(db, projectId, taskKey)
      addEvent(db, { projectId, at: now, account, kind: 'reserva', title: `Claude ${account.slice(6)} se encarga de ${taskKey.startsWith('h:') ? '' : taskKey + ' · '}${t.title ?? ''}`.trim(), detail: action, source: 'pmc claim', ref: taskKey })
    }
    return { ok: true, claim: row(db.prepare('SELECT * FROM claims WHERE project_id = ? AND task_key = ?').get(projectId, taskKey), now), renewed }
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* already */ }
    throw e
  }
}

export function releaseTask(db: DB, projectId: string, taskKey: string, account: AccountId, note?: string, now = Date.now()): boolean {
  const r = db.prepare('DELETE FROM claims WHERE project_id = ? AND task_key = ? AND account = ?').run(projectId, taskKey, account)
  if (Number(r.changes) > 0) {
    db.prepare('INSERT INTO claim_history(project_id, task_key, account, action, at, note) VALUES(?,?,?,?,?,?)').run(projectId, taskKey, account, 'liberada', now, note ?? null)
    return true
  }
  return false
}

/** Heartbeat: an account that is still working keeps its reservations alive. */
export function renewClaims(db: DB, account: AccountId, now = Date.now()): number {
  return Number(db.prepare('UPDATE claims SET heartbeat_at = ?, expires_at = ? WHERE account = ? AND expires_at > ?').run(now, now + LEASE_MS, account, now).changes)
}

export function listClaims(db: DB, projectId: string, now = Date.now()): Claim[] {
  return (db.prepare('SELECT * FROM claims WHERE project_id = ? ORDER BY claimed_at DESC').all(projectId) as any[]).map((r) => row(r, now))
}

export function claimHistory(db: DB, projectId: string, taskKey: string): { account?: string; action: string; at: number; note?: string }[] {
  return (db.prepare('SELECT account, action, at, note FROM claim_history WHERE project_id = ? AND task_key = ? ORDER BY at DESC LIMIT 50').all(projectId, taskKey) as any[])
    .map((r) => ({ account: r.account ?? undefined, action: r.action, at: r.at, note: r.note ?? undefined }))
}

// ---- hand-off ---------------------------------------------------------------------------------------------------------

export interface HandoffInput {
  project: ProjectConfig
  from: AccountId
  to: AccountId
  tasks: { key: string; extId?: string; title: string; status: string }[]
  heartbeat?: { at: number; text: string }
  copies: { label: string; branch?: string; dirty: number; path: string }[]
  reason: string
}

/** The text the receiving Claude gets: what was being done, where, what is left, and how to start without repeating work. */
export function handoffText(h: HandoffInput): string {
  const lines: string[] = []
  lines.push(`Relevo en ${h.project.name}: sigues el trabajo de ${h.from}, que ${h.reason}.`)
  if (h.heartbeat) lines.push(`Su último relevo (${new Date(h.heartbeat.at).toLocaleString('es-ES')}): ${h.heartbeat.text.slice(0, 900)}`)
  if (h.tasks.length) {
    lines.push('Tareas suyas que quedan (según TASKS.md):')
    for (const t of h.tasks.slice(0, 25)) lines.push(`- ${t.extId ?? t.key} · ${t.title}${t.status === 'en-desarrollo' ? ' (a medias)' : ''}`)
  }
  const dirty = h.copies.filter((c) => c.dirty > 0)
  if (dirty.length) lines.push(`Cambios sin guardar: ${dirty.map((c) => `${c.label} (${c.branch ?? '—'}, ${c.dirty} archivos, ${c.path})`).join('; ')}. No los borres: revísalos con git status y git diff antes de seguir.`)
  lines.push('Antes de empezar: lee docs/RELEVO.md (la línea En curso y el último latido), mira git status de la copia y no repitas lo que ya está hecho. Reserva cada tarea con `pmc claim <ID>` antes de tocarla.')
  return lines.join('\n')
}

/** Moves the reservations of the given tasks to the receiving account and records the hand-off. */
export function transferClaims(db: DB, projectId: string, keys: string[], from: AccountId, to: AccountId, now = Date.now()): number {
  let n = 0
  for (const k of keys) {
    db.prepare('DELETE FROM claims WHERE project_id = ? AND task_key = ? AND account = ?').run(projectId, k, from)
    const r = claimTask(db, projectId, k, to, { note: `relevo de ${from}`, now })
    if (r.ok) {
      db.prepare('INSERT INTO claim_history(project_id, task_key, account, action, at, note) VALUES(?,?,?,?,?,?)').run(projectId, k, to, 'relevo', now, `de ${from}`)
      n++
    }
  }
  return n
}

// ---- what the user assigned in «Próximo» -------------------------------------------------------------------------------
// «Que Claude 1 haga antes las de Claude 2» stays written until those tasks are done: it is shown, and every session of
// that account hears it first. A reservation would not do: it expires in two hours, and the account may not start for days.

/** Only a session with work under way would be paying twice for the same queue. */
export function isWorkingOn(a: Pick<AgentCard, 'sessions'>, projectId: string): boolean {
  return a.sessions.some((s) => s.projectId === projectId && isSessionWorking(s))
}

/** Why launching an account now would only waste credits; undefined when it can go. `anyway`: the user has been warned and wants another window. */
export function launchRefusal(a: Pick<AgentCard, 'id' | 'state' | 'sessions'>, projectId: string, anyway = false): string | undefined {
  const name = `Claude ${a.id.slice(6)}`
  if (a.state === 'sin-uso') return t('{name} no tiene uso ahora: programa su arranque para cuando vuelva', { name: name })
  if (!anyway && isWorkingOn(a, projectId)) return t('{name} ya está trabajando en este proyecto: otra sesión gastaría el doble en lo mismo', { name: name })
  return undefined
}

export type ScheduleOutcome = 'nada' | 'caducado' | 'repetido' | 'otro'

/**
 * What to do with an account's scheduled start when it is launched by hand. A start holds no list of tasks: it runs «sigue»
 * in its project, and that always means the account's queue there (what the user assigned it, then its own). So in the same
 * project it would repeat this very work and must go; in another project it is other work and stays. One that already
 * fired only needs clearing.
 */
export function scheduleAfterLaunch(sched: { at: number; projectId: string } | undefined, projectId: string, now = Date.now()): ScheduleOutcome {
  if (!sched) return 'nada'
  if (sched.at <= now) return 'caducado'
  return sched.projectId === projectId ? 'repetido' : 'otro'
}

export interface Assignment {
  id: number
  projectId: string
  to: AccountId
  from: AccountId
  position: number
  /** The order the user chose, as task keys; empty: the Claude decides. */
  order: string[]
  createdAt: number
}

export interface AssignedTask { key: string; extId?: string; title: string; status: string; priority: number }

function assignmentRow(r: any): Assignment {
  let order: string[] = []
  try { order = JSON.parse(r.task_order) } catch { /* none */ }
  return { id: r.id, projectId: r.project_id, to: r.to_account, from: r.from_account, position: r.position, order, createdAt: r.created_at }
}

export function listAssignments(db: DB, projectId: string): Assignment[] {
  return (db.prepare('SELECT * FROM assignments WHERE project_id = ? ORDER BY to_account, position, id').all(projectId) as any[]).map(assignmentRow)
}

/** The tasks of an assignment still open: the ones the user put first, then half-done, then as they are in the file. */
export function assignedTasks(db: DB, projectId: string, a: Pick<Assignment, 'from' | 'order'>): AssignedTask[] {
  const rows = (db
    .prepare(`SELECT key, ext_id, title, priority, COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND owner = ? AND gone = 0
      AND COALESCE(override, status) NOT IN ('terminada', 'idea') ORDER BY priority, st != 'en-desarrollo', source_line IS NULL, source_line`)
    .all(projectId, a.from) as any[]).map((r) => ({ key: r.key, extId: r.ext_id ?? undefined, title: r.title, status: r.st, priority: r.priority }))
  if (!a.order.length) return rows
  const rank = new Map(a.order.map((k, i) => [k, i]))
  return rows.map((r, i) => ({ r, i })).sort((x, y) => (rank.get(x.r.key) ?? 1e6 + x.i) - (rank.get(y.r.key) ?? 1e6 + y.i)).map((x) => x.r)
}

/** Assigns from's tasks to `to`. Pressing twice changes nothing; the opposite assignment, if there was one, is replaced. */
export function addAssignment(db: DB, projectId: string, from: AccountId, to: AccountId, now = Date.now()): { assignment: Assignment; created: boolean } {
  if (from === to) throw new Error(t('Una cuenta no puede encargarse a sí misma'))
  const cur = db.prepare('SELECT * FROM assignments WHERE project_id = ? AND to_account = ? AND from_account = ?').get(projectId, to, from) as any
  if (cur) return { assignment: assignmentRow(cur), created: false }
  db.prepare('DELETE FROM assignments WHERE project_id = ? AND to_account = ? AND from_account = ?').run(projectId, from, to)
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM assignments WHERE project_id = ? AND to_account = ?').get(projectId, to) as { p: number }).p
  const r = db.prepare('INSERT INTO assignments(project_id, to_account, from_account, position, created_at) VALUES(?,?,?,?,?)').run(projectId, to, from, pos, now)
  return { assignment: assignmentRow(db.prepare('SELECT * FROM assignments WHERE id = ?').get(Number(r.lastInsertRowid))), created: true }
}

export function removeAssignment(db: DB, id: number): void {
  db.prepare('DELETE FROM assignments WHERE id = ?').run(id)
}

export function setAssignmentOrder(db: DB, id: number, order: string[]): void {
  db.prepare('UPDATE assignments SET task_order = ? WHERE id = ?').run(JSON.stringify(order), id)
}

/** Which account goes first when one has several assigned. */
export function moveAssignment(db: DB, projectId: string, id: number, dir: number): void {
  const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as any
  if (!a) return
  const list = listAssignments(db, projectId).filter((x) => x.to === a.to_account)
  const i = list.findIndex((x) => x.id === id)
  const j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  const set = db.prepare('UPDATE assignments SET position = ? WHERE id = ?')
  list.forEach((x, n) => set.run(n, x.id))
}

/** An assignment with nothing left is over. */
export function pruneAssignments(db: DB, projectId: string, now = Date.now()): number {
  let n = 0
  for (const a of listAssignments(db, projectId)) {
    if (assignedTasks(db, projectId, a).length) continue
    removeAssignment(db, a.id)
    addEvent(db, { projectId, at: now, account: a.to, kind: 'relevo-app', title: t('Claude {v0} ha acabado lo que le encargaste de Claude {v1}', { v0: a.to.slice(6), v1: a.from.slice(6) }), source: 'Mission Control' })
    n++
  }
  return n
}

/** Hand-offs made before assignments existed were only reservations, which expired: they become what the user meant. */
export function seedAssignments(db: DB, now = Date.now()): number {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'assignmentsSeeded'").get()) return 0
  let n = 0
  for (const c of db.prepare("SELECT project_id, task_key, account, note, expires_at FROM claims WHERE note LIKE 'relevo de claude%'").all() as any[]) {
    const from = String(c.note).slice('relevo de '.length).trim() as AccountId
    if (!/^claude\d{1,2}$/.test(from) || from === c.account) continue
    if (addAssignment(db, c.project_id, from, c.account, now).created) n++
    if (c.expires_at <= now) db.prepare('DELETE FROM claims WHERE project_id = ? AND task_key = ?').run(c.project_id, c.task_key)
  }
  db.prepare("INSERT INTO meta(key, value) VALUES('assignmentsSeeded', '1') ON CONFLICT(key) DO NOTHING").run()
  return n
}

const shortTask = (t: AssignedTask) => `${t.extId ?? t.key} · ${t.title.replace(/\*+/g, '').slice(0, 60)}${t.status === 'en-desarrollo' ? ' (a medias)' : ''}`

/** What a session of this account is told first: what the user wants it to do before its own work, and what is not its own any more. */
export function assignmentsText(db: DB, projectId: string, account: AccountId): string[] {
  const all = listAssignments(db, projectId)
  const out: string[] = []
  const mine = all.filter((a) => a.to === account)
  const items = mine.map((a) => ({ a, tasks: assignedTasks(db, projectId, a) })).filter((x) => x.tasks.length)
  if (items.length) {
    const who = items.map((x) => x.a.from).join(', luego las de ')
    out.push(`ENCARGO DEL USUARIO (Mission Control › Próximo): antes que tus propias tareas, haz las de ${who}. Si en este mensaje te pide otra cosa, haz lo que te pida; si te dice solo «sigue», empieza por esto:`)
    for (const x of items) out.push(`- De ${x.a.from}: ${x.tasks.slice(0, 25).map(shortTask).join('; ')}.${x.a.order.length ? ' El usuario ha fijado este orden: respétalo.' : ''}`)
    if (items.every((x) => !x.a.order.length)) out.push('El orden dentro de cada lista lo eliges tú: primero lo que esté a medias y lo que desbloquee otras tareas.')
    out.push('Reserva cada una con pmc claim antes de tocarla. Cuando acabes todas, sigue con las tuyas.')
  }
  const given = all.filter((a) => a.from === account)
  if (given.length) out.push(`El usuario ha encargado tus tareas a ${given.map((a) => a.to).join(' y ')}: no las empieces; cuando te quedes sin nada, pmc next te da la siguiente libre.`)
  const others = all.filter((a) => a.to !== account && a.from !== account)
  if (others.length) out.push(`Encargos que no son para ti (no cojas esas tareas): ${others.map((a) => `${a.to} hace las de ${a.from}`).join('; ')}.`)
  return out
}

// ---- notices: what an account must know before it touches anything again ------------------------------------------
// A plain JSON file per account, so the PreToolUse/PostToolUse hooks can read it in a millisecond without the database.

export interface Notice { id: number; at: number; text: string; roots: string[]; seen: boolean }

export function noticesFile(account: AccountId): string {
  return join(paths.root(), 'notices', `${account}.json`)
}

function readNotices(account: AccountId): Notice[] {
  try { return JSON.parse(readFileSync(noticesFile(account), 'utf8')) } catch { return [] }
}

export function addNotice(account: AccountId, text: string, roots: string[], now = Date.now()): void {
  mkdirSync(join(paths.root(), 'notices'), { recursive: true })
  const list = readNotices(account).filter((n) => now - n.at < 7 * 86400_000)
  list.push({ id: now, at: now, text, roots: roots.map((r) => r.toLowerCase()), seen: false })
  writeFileSync(noticesFile(account), JSON.stringify(list))
}

/** The first unseen notice for a session working under one of the notice's folders; it is marked as seen. */
export function takeNotice(account: AccountId, cwd: string): string | undefined {
  const list = readNotices(account)
  const n = list.find((x) => !x.seen && x.roots.some((r) => isInside(cwd, r)))
  if (!n) return undefined
  n.seen = true
  try { writeFileSync(noticesFile(account), JSON.stringify(list)) } catch { /* shown again next time */ }
  return n.text
}

// ---- taking over from an account that cannot go on -------------------------------------------------------------------

export interface TakeoverInput {
  project: ProjectConfig
  from: AccountId
  to: AccountId
  enCurso: string[]
  heartbeat?: { at: number; text: string }
  copies: { label: string; branch?: string; dirty: number; path: string }[]
  fromState?: string
  backAt?: number
}

/** `pmc relevo <account>`: the caller takes over the other account's reservations and gets everything needed to continue. */
export function takeOver(db: DB, t: TakeoverInput, now = Date.now()): string {
  const theirs = listClaims(db, t.project.id, now).filter((c) => c.account === t.from)
  const tasks = db.prepare("SELECT key, ext_id, title, status FROM tasks WHERE project_id = ? AND owner = ? AND gone = 0 AND status != 'terminada' ORDER BY source_line").all(t.project.id, t.from) as any[]
  const keys = theirs.map((c) => c.taskKey)
  transferClaims(db, t.project.id, keys, t.from, t.to, now)
  // EV147: the user's answers to its questions here that never reached it go with its work (13-11: #145's answer waited
  // four hours for claude1 while claude6, carrying on EV134, asked the user the same thing again).
  const answers = db.prepare(`SELECT i.id, i.body FROM instructions i JOIN decisions d ON d.instruction_id = i.id WHERE i.project_id = ? AND i.target = ?
    AND i.status IN ('guardada', 'pendiente-entrega', 'entregada') ORDER BY i.created_at`).all(t.project.id, t.from) as { id: number; body: string }[]
  const moveAnswer = db.prepare("UPDATE instructions SET target = ?, status = 'recibida', channel = 'pmc relevo', delivered_at = ?, updated_at = ? WHERE id = ?")
  for (const a of answers) {
    moveAnswer.run(t.to, now, now, a.id)
    addEvent(db, { projectId: t.project.id, at: now, account: t.to, kind: 'recibida', title: `Claude ${t.to.slice(6)} ha recibido, al recoger el trabajo de ${t.from}: «${a.body.slice(0, 100)}»`, source: 'pmc relevo', ref: `ins:${a.id}` })
  }
  const names = keys.map((k) => { const x = taskKeyFor(db, t.project.id, k); return `${k}${x.title ? ' · ' + x.title : ''}` })
  const hhmm = new Date(now).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  addNotice(t.from, [
    `Mission Control: mientras no podías trabajar, ${t.to} ha seguido tu trabajo en ${t.project.name} desde las ${hhmm}${names.length ? `: ${names.join('; ')}` : ''}.`,
    'Antes de tocar nada: lee docs/RELEVO.md (Último latido y En curso) y mira git log y git status de tu copia. No rehagas lo que ya hizo y no toques lo que tenga reservado (pmc claims).',
    `Después sigue con tu siguiente tarea pendiente; si no te queda ninguna, reserva una tarea libre de docs/TASKS.md o una parada de otra cuenta con pmc claim.`
  ].join(' '), [t.project.root, ...t.project.copies.map((c) => c.path)], now)
  addEvent(db, { projectId: t.project.id, at: now, account: t.to, kind: 'relevo-app', title: `${t.to} sigue el trabajo de ${t.from}${names.length ? ': ' + names.join('; ') : ''}`, source: 'pmc relevo' })
  const out: string[] = [`Relevo: ahora llevas el trabajo de ${t.from} en ${t.project.name}${t.fromState ? ` (${t.fromState}${t.backAt ? `, vuelve el ${when(t.backAt)}` : ''})` : ''}.`]
  if (names.length) out.push(`Reservas que pasan a ti: ${names.join('; ')}.`)
  for (const a of answers) out.push(`Respuesta del usuario que esperaba a ${t.from} (ahora es tuya): ${a.body.replace(/ Apúntalo en docs\/TASKS\.md.*$/, '')} Apúntala en docs/TASKS.md y síguela; no se la vuelvas a preguntar.`)
  for (const e of t.enCurso) out.push(`Lo que tenía en curso (RELEVO.md): ${e}`)
  if (t.heartbeat) out.push(`Su último latido (${new Date(t.heartbeat.at).toLocaleString('es-ES')}): ${t.heartbeat.text.slice(0, 700)}`)
  const dirty = t.copies.filter((c) => c.dirty > 0)
  if (dirty.length) out.push(`Cambios sin guardar: ${dirty.map((c) => `${c.label} (${c.branch ?? '—'}): ${c.dirty} archivos`).join('; ')}. Son suyos y están a medias: revísalos con git status y git diff y sigue a partir de ellos; no los borres.`)
  // 14-11: a blocked one (EV25, waiting for the user's second PC) was listed as work to carry on.
  const open = tasks.filter((x) => !keys.includes(x.key) && x.status !== 'bloqueada').slice(0, 12)
  const blocked = tasks.filter((x) => !keys.includes(x.key) && x.status === 'bloqueada').slice(0, 6)
  if (open.length) out.push(`Otras tareas suyas sin terminar: ${open.map((x) => `${x.ext_id ?? x.key} · ${x.title}`).join('; ')}.`)
  if (blocked.length) out.push(`Bloqueadas, esperan al usuario o un hecho real (no son para ahora): ${blocked.map((x) => x.ext_id ?? x.key).join(', ')}.`)
  out.push(`Ahora: pon en RELEVO.md la línea En curso (${t.to}, desde las ${hhmm}: sigue lo de ${t.from}) y continúa. ${t.from} recibirá un aviso al volver para que no repita tu trabajo.`)
  return out.join('\n')
}

/** What every session is told about «sigue», so the user only has to open a Claude and say that word. */
export function protocolText(pmc: string): string {
  // EV36 (12-11) halved it; EV75 (13-11) again, to keep the whole startup package under 4.000 characters: the same orders
  // in fewer words. It goes into every session and after every compaction.
  return [
    `Cómo se trabaja aquí: sitúate con ${pmc} parte; una tarea, ${pmc} tarea <ID> (RELEVO, TASKS y STATE son archivo: busca en ellos, no los leas enteros; si faltan TASKS y RELEVO, créalos).`,
    `Si el usuario dice solo «sigue»: su encargo; si no, lo que dejó a medias una cuenta sin uso (${pmc} relevo <cuenta>); si no, tus reservas; si no, ${pmc} claim <ID> de la siguiente libre (o ${pmc} next), y ${pmc} release <ID> al acabar.`,
    `Al empezar o cambiar de faena: ${pmc} ahora "frase corta". Al cerrar cada bloque: ${pmc} guarda "qué has hecho y qué queda" --probado "qué y cómo" --siguiente "el paso concreto" --no-rehacer "lo que ya está", y sigue: con uso y trabajo no termines el turno ni resumas para el usuario (lo ve en Mission Control); que el límite te corte a mitad es lo que quiere.`,
    `Para que el usuario decida, no te pares: ${pmc} decide "título" --pregunta "…" --opcion "A: …" --opcion "B: …" --foto "ruta::qué se ve" --defecto "A" [--espera 12] [--tarea ID] y sigue con otra cosa (la respuesta llega sola, o con ${pmc} respuestas).`,
    `Tareas nuevas: «(tras: ID)» si esperan a otras y el modelo que basta: [sonnet], [opus] o [fable].`,
    `Antes de dar algo por hecho: ${pmc} verifica <ID> (si falla, arréglalo; lo que no tenga prueba, dilo). Lo que se ve o se oye: ${pmc} entrega <ID> --que "…" --mirar "…" --foto "ruta::qué se ve".`,
    `Antes de algo pesado (Unity, Blender, la gráfica): ${pmc} recursos y ${pmc} recurso <unity|gpu|build> "para qué" (--soltar al acabar); si el usuario juega o edita vídeo, no lo lances. Más de 5 min: ${pmc} trabajo "título" --log … --salida …`,
    // EV32 (13-11): 0 calls in 7 days in two projects after asking for them; Claude Code itself tells each session to
    // launch subagents only when the user asks (they start cold and cost more). Asking here was only noise.
    `No sobrescribas una imagen con nota del usuario: guarda la nueva con otro nombre.`
  ].join(' ')
}

// ---- instructions waiting for an account (delivered by the SessionStart hook) ------------------------------------------

export function pendingInstructions(db: DB, projectId: string, account: AccountId): { id: number; kind: string; body: string; target?: string; commentId?: number }[] {
  return (db
    .prepare(
      `SELECT id, kind, body, target, comment_id FROM instructions WHERE project_id = ? AND kind != 'nota' AND kind != 'idea'
       AND status IN ('guardada', 'pendiente-entrega', 'entregada') AND NOT (status = 'entregada' AND COALESCE(channel, '') LIKE 'ventana %')
       AND (target = ? OR target IS NULL) ORDER BY created_at LIMIT 20`
    )
    .all(projectId, account) as any[]).map((r) => ({ id: r.id, kind: r.kind, body: r.body, target: r.target ?? undefined, commentId: r.comment_id ?? undefined }))
}

/**
 * A note the user left on an image reached a Claude (12-11: 29 of them stayed «pendiente» for days after being
 * delivered, and nobody could say they were done): the comment says so, and the Claude is told how to send it back.
 */
export function commentsReached(db: DB, ins: { commentId?: number }[], pmc: string): string {
  const ids = ins.map((i) => i.commentId).filter((x): x is number => typeof x === 'number')
  for (const id of ids) {
    const c = db.prepare('SELECT status FROM comments WHERE id = ?').get(id) as { status: string } | undefined
    if (c?.status === 'pendiente') setCommentStatus(db, id, 'recibido', 'Le ha llegado a un Claude')
  }
  return ids.length ? t('Notas sobre imágenes (n.º {v0}): cuando arregles cada una, {pmc} corregido <n.º> "qué has cambiado" (con --foto "ruta::qué se ve" si se ve), y vuelve al usuario a Revisar para que la apruebe.', { v0: ids.join(', '), pmc: pmc }) : ''
}

const DAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const when = (ms: number) => {
  const d = new Date(ms)
  return t('{v0} {v1} a las {v2}:{v3}', { v0: DAY[d.getDay()], v1: d.getDate(), v2: String(d.getHours()).padStart(2, '0'), v3: String(d.getMinutes()).padStart(2, '0') })
}

/** How the other accounts are, from the summary the app keeps (team.json, written every refresh). Old summaries are ignored. */
export function teamContext(account: AccountId, now = Date.now(), file = join(paths.root(), 'team.json'), projectId?: string): string {
  let data: { at: number; team: any[] }
  try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { return '' }
  if (!data?.team || now - data.at > 30 * 60_000) return ''
  const me = data.team.find((t) => t.id === account)
  // 14-11: in Mission Control's package «claude6 … con tareas suyas paradas: F10, F10b, MP9…» were the game project tasks.
  // With `stuckIn` (by project) only this project's are named; the others are counted.
  const stuckHere = (t: any): string[] => (projectId && t.stuckIn ? t.stuckIn[projectId] ?? [] : t.stuck ?? [])
  const stuckElsewhere = (t: any): number => (projectId && t.stuckIn ? Object.entries(t.stuckIn as Record<string, string[]>).filter(([p]) => p !== projectId).reduce((n, [, v]) => n + v.length, 0) : 0)
  const stuckText = (t: any): string => {
    const here = stuckHere(t)
    const away = stuckElsewhere(t)
    const named = here.length ? `, con tareas suyas paradas${projectId && t.stuckIn ? ' aquí' : ''}: ${here.map((x: string) => x.split(/[\s·(]/)[0]).filter(Boolean).slice(0, 6).join(', ')}${here.length > 6 ? ` y ${here.length - 6} más` : ''}` : ''
    return named + (away ? `${named ? ' (y' : ', con'} ${away} parada${away > 1 ? 's' : ''} en otros proyectos${named ? ')' : ''}` : '')
  }
  const others = data.team.filter((t) => t.id !== account).map((t) => {
    if (t.status === 'baja') return `${t.id} de baja (no cuentes con ella)`
    // Set aside but working on its own (the backup account in its project, 13-11: «claude5 apartada… no se usa» while it
    // worked on the video project all day): it is said, so nobody thinks it is free or idle.
    if (t.status === 'pausada' && t.state === 'trabajando') return `${t.id} trabajando aparte${t.projectId ? ` en ${t.projectId}` : ''} (cuenta apartada de lo demás: no le dejes trabajo ni cuentes con ella aquí)`
    if (t.status === 'pausada') return `${t.id} apartada por el usuario (no se usa ni se le deja trabajo)`
    // A limit that already ended is not "sin uso" (12-11 11:30: «claude5 sin uso hasta las 07:30», four hours later).
    if (t.state === 'sin-uso' && typeof t.backAt === 'number' && t.backAt <= now) return `${t.id} libre (su límite acabó el ${when(t.backAt)})`
    if (t.state === 'sin-uso') return `${t.id} sin uso${t.backAt ? ` hasta el ${when(t.backAt)}` : ''}${t.gaveTo ? `, con sus tareas encargadas a ${t.gaveTo}` : stuckText(t)}`
    if (t.state === 'trabajando') return `${t.id} trabajando${t.doing ? ` (${String(t.doing).slice(0, 60)})` : ''}`
    return `${t.id} ${t.state === 'esperando' ? 'esperando al usuario' : 'libre'}${t.weekFree != null ? `, semana ${t.weekFree} % libre` : ''}`
  })
  const lines = [`Las otras cuentas ahora: ${others.join('; ')}.`]
  // «Próximo» (the user, 4-11): the order he wants the accounts to start in.
  // Only when the accounts take turns («Se relevan entre ellos») does the order hold anyone back. With «Cada uno sigue con lo
  // suyo» or «Solo cuando yo lo diga» every open account works (12-11 11:30: claude3 was told to stop because claude5, a
  // video account with nothing to do in that project, "had not started"). Accounts that cannot start (out of usage, set
  // aside, already working or waiting for the user) never hold anyone back.
  // The order of the session's own project (EV38); the one on screen in the app only when that is unknown.
  const own = projectId ? (data as any).orders?.[projectId] : undefined
  const order: string[] = Array.isArray(own) ? own : Array.isArray((data as any).order) ? (data as any).order : []
  const place = order.indexOf(account)
  // In a relay wheel the wheel's own line says who goes after whom (EV75: the same thing twice, in a package that must stay short).
  let inWheel = false
  try { inWheel = (JSON.parse(readFileSync(join(dirname(file), 'turns.json'), 'utf8')).projects as { members: string[] }[]).some((p) => p.members.includes(account)) } catch { /* no wheels */ }
  if (place > 0 && (data as any).mode === 'relevos' && !inWheel) {
    const ahead = order.slice(0, place).filter((id) => {
      const t = data.team.find((x) => x.id === id)
      return t && !t.status && t.state === 'disponible' && t.weekFree !== 0 && t.fiveFree !== 0
    })
    lines.push(`Turno que ha elegido el usuario: ${order.join(' → ')}.${ahead.length ? ` Van antes que tú y están libres: ${ahead.join(', ')}. Si este trabajo es de relevo (seguir lo de una cuenta agotada), déjaselo a ella; lo tuyo propio, síguelo.` : ''}`)
  }
  if (me?.weekFree != null) {
    // The figure is from this account's last reply. If it is old and says there is nothing left, the user may have topped
    // it up since (12-11: claude3 was told "0 %" with a full week): say how old it is instead of telling it to stop.
    const age = typeof me.usageAt === 'number' ? now - me.usageAt : 0
    const old = age > 30 * 60_000 ? ` (dato de hace ${age >= 2 * 3600_000 ? `${Math.round(age / 3600_000)} h` : `${Math.round(age / 60_000)} min`})` : ''
    if (old && (me.weekFree === 0 || me.fiveFree === 0)) lines.push(`Según tu última lectura${old}, no te quedaba uso. Si estás leyendo esto es que vuelves a tenerlo (reinicio o recarga del usuario): la cifra real llega con tu primera respuesta; trabaja con normalidad y deja puntos de control en el relevo.`)
    else lines.push(`A ti te queda el ${me.weekFree} % de la semana${me.fiveFree != null ? ` y el ${me.fiveFree} % de las 5 horas` : ''}${old}: cuando se vaya acabando, guarda (commit) y deja el relevo al día, y sigue trabajando hasta que el límite te corte: no te pares ni te despidas tú antes, aunque estés al 99 %.`)
  }
  if (data.team.some((t) => t.id !== account && t.state === 'sin-uso' && !t.gaveTo && stuckHere(t).length))
    lines.push('Si acabas lo tuyo, puedes seguir una tarea parada de una cuenta sin uso: resérvala antes con pmc claim para que nadie la repita.')
  return lines.join('\n')
}

// ---- grouping notes that describe the same problem ------------------------------------------------------------------

function words(s: string): Set<string> {
  const stop = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'en', 'y', 'que', 'un', 'una', 'se', 'esta', 'está', 'muy', 'mal', 'a', 'al', 'con', 'por', 'lo', 'es'])
  return new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)))
}

function similar(a: string, b: string): boolean {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase()
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size) >= 0.5
}

/**
 * Notes left on several files that say the same thing ("el agarre está mal" on four captures) become one order with
 * the list of files, and the agent is asked to check every similar case, not only the marked ones.
 */
export function groupedLines(ins: { kind: string; body: string; id?: number }[]): string[] {
  const groups: { kind: string; items: { text: string; where?: string }[] }[] = []
  for (const i of ins) {
    const [body, where] = i.body.split(' — sobre ')
    // EV154: a note the user wrote carries its mark, for the line it gets in TASKS.md (the app shows it as filed).
    const text = i.id != null && (i.kind === 'general' || i.kind === 'tarea') ? `${body} (MC-${i.id})` : body
    const g = i.kind === 'correccion' ? groups.find((x) => x.kind === 'correccion' && x.items.some((it) => similar(it.text, text))) : undefined
    if (g) g.items.push({ text, where })
    else groups.push({ kind: i.kind, items: [{ text, where }] })
  }
  return groups.map((g) => {
    const label = KIND_LABEL[g.kind as keyof typeof KIND_LABEL] ?? g.kind
    const first = g.items[0]
    if (g.items.length > 1) {
      const where = g.items.map((it) => `${it.where ?? '(sin archivo)'}${it.text.trim().toLowerCase() !== first.text.trim().toLowerCase() ? ` («${it.text.trim()}»)` : ''}`).join('; ')
      return t('- [{label}, el mismo problema en {length} archivos] {v0}. Marcado en: {where}. Trátalo como una sola orden: corrige la causa y revisa también los demás casos parecidos (por ejemplo, el resto de armas u oficios), no solo los marcados.', { label: label, length: g.items.length, v0: first.text.trim(), where: where })
    }
    return `- [${label}] ${first.text}${first.where ? ` — sobre ${first.where}` : ''}`
  })
}

/** New notes for an account that is already working: delivered after one of its edits (PostToolUse), short. */
/**
 * How the user's notes reach a Claude (3-11): what he marked as a priority (or a hand-off) goes before the rest; every
 * other note is something to file where it belongs (TASKS.md, its section, priority and account), not a new main task.
 */
export function notesText(projectName: string, ins: { kind: string; body: string; id?: number }[], during: boolean): string[] {
  const first = ins.filter((i) => i.kind === 'prioridad' || i.body.startsWith('Relevo en '))
  const reviews = ins.filter((i) => !first.includes(i) && i.body.startsWith(REVIEW_PREFIX))
  const rest = ins.filter((i) => !first.includes(i) && !reviews.includes(i))
  const out: string[] = []
  if (first.length) {
    out.push(`Mission Control: el usuario ha marcado ${first.length === 1 ? 'esto' : 'estas cosas'} en ${projectName} para hacer antes que lo demás${during ? ' (cierra antes el paso en el que estás, sin dejar nada roto)' : ''}:`)
    out.push(...groupedLines(first))
  }
  if (reviews.length) {
    out.push(`Mission Control: el usuario ha revisado trabajo hecho en ${projectName} y pide cambios. No cortes lo que estás haciendo, pero hazlos antes de empezar nada nuevo${during ? ', en cuanto cierres lo que tienes entre manos' : ''}:`)
    out.push(...groupedLines(reviews))
  }
  if (rest.length) {
    out.push(`Mission Control: el usuario ha dejado ${rest.length === 1 ? 'una nota' : `${rest.length} notas`} en ${projectName}. No son tu tarea principal ni te hacen parar: ${during ? 'cuando cierres el paso en el que estás, ' : ''}apunta cada una en docs/TASKS.md donde le toque (su sección, su prioridad y la cuenta que mejor encaje, que puede ser otra)${rest.some((i) => i.id != null && (i.kind === 'general' || i.kind === 'tarea')) ? ', con su marca (MC-…) en la línea para que el usuario vea en la app que está apuntada,' : ''} y sigue con lo tuyo por orden de prioridad. Hazla tú enseguida solo si corrige justo lo que estás haciendo.`)
    out.push(...groupedLines(rest))
  }
  return out
}

/** Tasks the user raised (urgente, alta) that are still open, highest first; for every Claude to organise around. */
export function priorityTasks(db: DB, projectId: string, limit = 8): { key: string; extId?: string; title: string; priority: number }[] {
  return (db
    .prepare(`SELECT key, ext_id, title, priority FROM tasks WHERE project_id = ? AND gone = 0 AND priority <= 1
      AND COALESCE(override, status) NOT IN ('terminada', 'idea') ORDER BY priority, source_line IS NULL, source_line LIMIT ?`)
    .all(projectId, limit) as any[]).map((r) => ({ key: r.key, extId: r.ext_id ?? undefined, title: r.title, priority: r.priority }))
}

export function prioritiesText(db: DB, projectId: string, account: AccountId, now = Date.now()): string {
  const list = priorityTasks(db, projectId)
  if (!list.length) return ''
  const holders = new Map(listClaims(db, projectId, now).filter((c) => !c.abandoned).map((c) => [c.taskKey, c.account]))
  const items = list.map((t) => {
    const h = holders.get(t.key)
    return `${t.extId ?? t.key} · ${t.title.slice(0, 70)} [${t.priority === 0 ? 'urgente' : 'alta'}${h ? (h === account ? ', la tienes tú' : `, la tiene ${h}`) : ''}]`
  })
  return t('Prioridades del usuario, antes que el resto y la más alta primero (si está libre, resérvala con pmc claim; si la tiene otra cuenta, sigue con la siguiente): {v0}.', { v0: items.join('; ') })
}

const TASK_ID = /^[A-Z][A-Za-z]{0,3}[0-9]+[a-z]?[0-9]*[a-z]?$/

/**
 * What a task says about itself in TASKS.md: «(tras: BZ6, G4a)» = not before those are done; «[sonnet]», «[fable u opus]» =
 * the model that is enough for it. Read from the text each time: nothing to keep in step.
 */
export function taskTags(text: string): { after: string[]; model?: string; needs: string[] } {
  const after = [...text.matchAll(/[(](?:tras|after):[ ]*([^)]+)[)]/gi)].flatMap((m) => m[1].split(/[ ,;]+/).map((x) => x.trim()).filter((x) => TASK_ID.test(x)))
  // «{unity}», «{gpu}»: a resource only one job can use at a time; two tasks that need the same one cannot run side by side.
  // The model and the resources are the tags at the end of the line, where they are written (all 63 in the game project): a
  // task that talks about them took the first one it named (13-11: EV20 «needed» Unity and the graphics card because its
  // text explains «{unity}», and EV101 and EV118 had the model of a mention instead of their own). Only when the end has
  // none (a note written after the tags), the last ones not quoted.
  let tags = tailTags(text).filter((t) => MODEL_TAG.test(t) || NEED_TAG.test(t))
  if (!tags.length) {
    const bare = text.replace(/«[^»]*»/g, ' ').replace(/`[^`]*`/g, ' ')
    const models = [...bare.matchAll(/\[(?:haiku|sonnet|opus|fable)(?: +(?:u|o) +(?:haiku|sonnet|opus|fable))*\]/gi)].map((m) => m[0])
    tags = [...models.slice(-1), ...[...bare.matchAll(/[{][a-zñ][a-zñ0-9_-]{1,20}[}]/gi)].map((m) => m[0])]
  }
  const model = tags.map((t) => MODEL_TAG.exec(t)?.[1]).find(Boolean)?.toLowerCase()
  const needs = [...new Set(tags.map((t) => NEED_TAG.exec(t)?.[1]?.toLowerCase()).filter((x): x is string => Boolean(x)))]
  return { after: [...new Set(after)], model, needs }
}

const MODEL_TAG = /^\[((?:haiku|sonnet|opus|fable)(?: +(?:u|o) +(?:haiku|sonnet|opus|fable))*)\]$/i
const NEED_TAG = /^[{]([a-zñ][a-zñ0-9_-]{1,20})[}]$/i

/** The «[…]» and «{…}» groups the text ends with, skipping «(…)» groups and closing punctuation after them (a full stop between them ends the tail: it ends a sentence). */
function tailTags(text: string): string[] {
  const out: string[] = []
  let s = text.trimEnd()
  for (let guard = 0; guard < 20 && s; guard++) {
    const last = s[s.length - 1]
    if (!out.length && (last === '.' || last === ',' || last === ';' || last === '*')) { s = s.slice(0, -1).trimEnd(); continue }
    const open = last === ']' ? '[' : last === '}' ? '{' : last === ')' ? '(' : ''
    if (!open) break
    const i = s.lastIndexOf(open)
    if (i < 0) break
    if (open !== '(') out.unshift(s.slice(i))
    s = s.slice(0, i).trimEnd()
  }
  return out
}

/**
 * `pmc next`: urgent first; then what the user assigned to this account; then his other priorities, this account's own
 * tasks, what was left half-done and the rest in file order. Tasks assigned to another account are not offered.
 */
export function nextTasks(db: DB, projectId: string, account: AccountId, limit = 6, now = Date.now()): { key: string; extId?: string; title: string; priority: number; status: string; mine: boolean; assignedFrom?: AccountId; change?: string; model?: string }[] {
  const holders = new Map(listClaims(db, projectId, now).filter((c) => !c.abandoned).map((c) => [c.taskKey, c.account]))
  const assignments = listAssignments(db, projectId)
  const givenAway = new Set(assignments.filter((a) => a.to !== account).map((a) => a.from as string))
  const assigned = new Map<string, { rank: number; from: AccountId }>()
  for (const a of assignments.filter((x) => x.to === account)) {
    for (const t of assignedTasks(db, projectId, a)) if (!assigned.has(t.key)) assigned.set(t.key, { rank: assigned.size, from: a.from })
  }
  const rows = db
    .prepare(`SELECT key, ext_id, title, detail, priority, owner, COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND gone = 0
      AND COALESCE(override, status) IN ('pendiente', 'planificada', 'en-desarrollo') ORDER BY priority, st != 'en-desarrollo', source_line IS NULL, source_line`)
    .all(projectId) as any[]
  // A task that waits for others («tras: …») is not offered until they are done: starting it would be work to redo.
  const open = new Set((db.prepare("SELECT ext_id FROM tasks WHERE project_id = ? AND gone = 0 AND ext_id IS NOT NULL AND COALESCE(override, status) != 'terminada'").all(projectId) as { ext_id: string }[]).map((r) => r.ext_id))
  for (const r of rows) {
    const tags = taskTags(`${r.title} ${r.detail ?? ''}`)
    r.model = tags.model
    r.waits = tags.after.filter((id) => id !== r.ext_id && open.has(id))
  }
  // EV121: a task with a question waiting in Decidir (pmc decide --tarea) waits for the user: it is offered again when he
  // answers or its default comes, not before (13-11: EV141 was offered while #148 waited). Still shown to whoever holds it.
  const asking = new Set((db.prepare("SELECT task_ext_id FROM decisions WHERE project_id = ? AND status = 'pendiente' AND task_ext_id IS NOT NULL").all(projectId) as { task_ext_id: string }[]).map((r) => r.task_ext_id))
  // Tasks of an account the user set aside or stopped paying are nobody's now: they are offered like free ones.
  const out = accountsOut()
  for (const r of rows) if (r.owner && out.has(r.owner)) r.owner = null
  const score = (r: any) => (r.priority === 0 ? 0 : assigned.has(r.key) ? 1 : r.priority <= 1 ? 2 : r.owner === account ? 3 : 4)
  // What the user reviewed and sent back goes first: urgent notes before anything, the rest right after what is urgent.
  const changes = openChangesFor(db, projectId, account)
  const changed = new Set(changes.map((c) => c.taskKey))
  const asTask = (c: (typeof changes)[number]) => ({ key: c.taskKey, extId: c.extId, title: c.title, priority: c.priority, status: 'cambios', mine: holders.get(c.taskKey) === account, change: c.note, model: undefined as string | undefined })
  const queue = rows
    .filter((r) => !r.waits.length && !changed.has(r.key) && (!asking.has(r.ext_id) || holders.get(r.key) === account) && (!holders.has(r.key) || holders.get(r.key) === account) && (assigned.has(r.key) || !givenAway.has(r.owner)))
    .map((r, i) => ({ r, i }))
    .sort((x, y) => score(x.r) - score(y.r) || (assigned.get(x.r.key)?.rank ?? 0) - (assigned.get(y.r.key)?.rank ?? 0) || x.i - y.i)
    .map(({ r }) => ({ key: r.key, extId: r.ext_id ?? undefined, title: r.title, priority: r.priority, status: r.st, mine: holders.get(r.key) === account, assignedFrom: assigned.get(r.key)?.from as AccountId | undefined, change: undefined as string | undefined, model: r.model as string | undefined }))
  return [
    ...changes.filter((c) => c.urgent).map(asTask),
    ...queue.filter((t) => t.priority === 0),
    ...changes.filter((c) => !c.urgent).map(asTask),
    ...queue.filter((t) => t.priority !== 0)
  ].slice(0, limit)
}

/**
 * A hand-off message nobody read in 12 hours is out of date (the account it covered for is back, or someone else took
 * over): delivering it then would send a session after work that is no longer there. It is set aside, not deleted.
 */
export const STALE_RELAY_MS = 12 * 3600_000
export function expireStaleRelays(db: DB, now = Date.now()): number {
  return Number(db.prepare("UPDATE instructions SET status = 'anulada', updated_at = ? WHERE body LIKE 'Relevo en %' AND status IN ('guardada', 'pendiente-entrega', 'entregada') AND created_at < ?").run(now, now - STALE_RELAY_MS).changes)
}

export function deliverPending(db: DB, project: ProjectConfig, account: AccountId, now = Date.now()): string {
  expireStaleRelays(db, now)
  // EV154: what was typed into its window it already has, as the user's message: read, and not said twice.
  try { confirmTyped(db, project.id, account, now) } catch { /* never block */ }
  const ins = pendingInstructions(db, project.id, account)
  if (!ins.length) return ''
  const mark = db.prepare("UPDATE instructions SET status = 'recibida', channel = COALESCE(channel, 'durante la sesión'), delivered_at = COALESCE(delivered_at, ?), updated_at = ? WHERE id = ?")
  for (const i of ins) {
    mark.run(now, now, i.id)
    takeChange(db, i.id, account)
    addEvent(db, { projectId: project.id, at: now, account, kind: 'recibida', title: t('Claude {v0} ha recibido: «{v1}»', { v0: account.slice(6), v1: i.body.slice(0, 100) }), source: 'hook PostToolUse', ref: `ins:${i.id}` })
  }
  const back = commentsReached(db, ins, pmcCommand())
  return [...notesText(project.name, ins, true), ...(back ? [back] : [])].join('\n')
}

/** Text added to a session's context at start, and the instructions marked as received (they reached the agent). */
export function sessionContext(db: DB, project: ProjectConfig, account: AccountId, now = Date.now()): string {
  // What it read in an earlier session and has not done yet: a note is delivered once, so this keeps it from being forgotten.
  const stillOpen = openChangesFor(db, project.id, account).filter((c) => c.readAt)
  const ins = pendingInstructions(db, project.id, account)
  const mine = listClaims(db, project.id, now).filter((c) => c.account === account && !c.abandoned)
  const others = listClaims(db, project.id, now).filter((c) => c.account !== account && !c.abandoned)
  const out: string[] = []
  // EV75: what can go when the package is too long, by level (the highest goes first); the rest always stays.
  const drop = new Map<string, number>()
  const opt = (text: string, level: number) => { out.push(text); drop.set(text, level) }
  try {
    const mem = memoryText(project.name, listMemories(db, project.id), recentDecisions(db, project.id))
    if (mem) out.push(mem)
  } catch { /* an old database without the table: nothing to remember yet */ }
  // EV65: what was marked done lately with nothing to prove it: the next one checks it instead of trusting the box.
  try {
    const unchecked = db.prepare("SELECT COALESCE(ext_id, key) AS id FROM tasks t WHERE project_id = ? AND gone = 0 AND COALESCE(override, status) = 'terminada' AND updated_at > ? AND NOT EXISTS (SELECT 1 FROM verifications v WHERE v.project_id = t.project_id AND v.task_key = t.key) ORDER BY updated_at DESC LIMIT 6").all(project.id, now - 3 * 86400_000) as { id: string }[]
    if (unchecked.length) opt(`Mission Control · hechas sin comprobar en ${project.name} (estos días, sin pmc verifica ni entrega con foto): ${unchecked.map((u) => u.id).join(', ')}. Si tocan lo tuyo, compruébalas antes de construir encima.`, 4)
  } catch { /* no verifications table yet */ }
  if (ins.length) {
    out.push(...notesText(project.name, ins, false))
    const back = commentsReached(db, ins, pmcCommand())
    if (back) out.push(back)
    const mark = db.prepare("UPDATE instructions SET status = 'recibida', channel = COALESCE(channel, 'inicio de sesión'), delivered_at = COALESCE(delivered_at, ?), updated_at = ? WHERE id = ?")
    for (const i of ins) {
      mark.run(now, now, i.id)
      takeChange(db, i.id, account)
      addEvent(db, { projectId: project.id, at: now, account, kind: 'recibida', title: t('Claude {v0} ha recibido: «{v1}»', { v0: account.slice(6), v1: i.body.slice(0, 100) }), source: 'hook SessionStart', ref: `ins:${i.id}` })
    }
  }
  if (stillOpen.length) {
    out.push(`Mission Control: cambios que el usuario pidió al revisar y siguen sin hacer en ${project.name}. Van antes que las tareas nuevas; al acabar cada uno, pmc entrega <ID> --que … --mirar … --foto … para que vuelva a «Para revisar»:`)
    // EV75: the start of each note (the whole one is in pmc tarea <ID>), at most 10: they were 5.000 characters in the game project.
    const short = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 150 ? t.slice(0, 150).replace(/\s+\S*$/, '') + '… (entera: pmc tarea ' : t }
    for (const c of stillOpen.slice(0, 10)) { const s = short(c.note); out.push(`- ${c.extId ?? c.title}: ${s.endsWith('pmc tarea ') ? s + (c.extId ?? c.title.slice(0, 30)) + ')' : s}`) }
    if (stillOpen.length > 10) out.push(`- y ${stillOpen.length - 10} más: pmc parte las lista todas.`)
  }
  const notice = takeNotice(account, project.root)
  if (notice) out.push(notice)
  pruneAssignments(db, project.id, now)
  const assigned = assignmentsText(db, project.id, account)
  // EV75: a long list of passed-on tasks is cut (pmc parte has it all): 920 characters for claude1 in the game project.
  if (assigned.length) out.push(...assigned.map((s) => (s.length > 480 ? s.slice(0, 480).replace(/[;,][^;,]*$/, '') + '… (todas en pmc parte)' : s)))
  const team = teamContext(account, now, undefined, project.id)
  if (team) opt((out.length ? '' : 'Mission Control: ') + team, 2)
  if (mine.length) out.push(`Tienes reservadas: ${mine.map((c) => c.taskKey).join(', ')}.`)
  else {
    // EV37: «sigue» starts on the right task without first running pmc parte and pmc next to find it.
    const next = nextTasks(db, project.id, account, 3, now).filter((t) => !t.change)
    if (next.length) {
      const say = (t: (typeof next)[number]) => `${t.extId ?? t.key} · ${t.title.slice(0, 90)}${t.status === 'en-desarrollo' ? ' (a medias)' : ''}${t.model ? ` [${t.model}]` : ''}${t.assignedFrom ? ` (de ${t.assignedFrom})` : ''}`
      out.push(`Tu siguiente tarea libre, si no hay encargo ni relevo: ${say(next[0])}. Resérvala con pmc claim <ID> y ve a por ella; pmc tarea <ID> te da su texto entero.`)
      if (next.length > 1) opt(`Después: ${next.slice(1).map(say).join('; ')}.`, 3)
    }
  }
  const prio = prioritiesText(db, project.id, account, now)
  if (prio) opt(prio, 3)
  const out_ = teamStates(now)
  const parked = others.filter((c) => out_.get(c.account) === 'sin-uso')
  const busy = others.filter((c) => out_.get(c.account) !== 'sin-uso')
  if (busy.length) opt(`No toques (las tienen otras cuentas que pueden seguir): ${busy.map((c) => `${c.taskKey} (${c.account})`).join(', ')}.`, 5)
  if (parked.length) opt(`Reservadas por cuentas sin uso, que puedes seguir con relevo: ${parked.map((c) => `${c.taskKey} (${c.account})`).join(', ')}.`, 6)
  out.push(protocolText(pmcCommand()))
  const fit = fitPackage(out, (s) => drop.get(s) ?? 0)
  return (fit[0].startsWith('Mission Control') ? '' : 'Mission Control: ') + fit.join('\n')
}

/**
 * EV75: the startup package goes into every session and after every compaction: at most this long (the research: 4.000
 * characters; the wheel's line and the skills line are added after it, in pmc hook). Over it, the parts that can go go,
 * the least useful first; the user's messages, the changes asked, the memory, the next task and the rules always stay.
 */
export const PACKAGE_LIMIT = 3700
export function fitPackage(parts: string[], level: (s: string) => number, limit = PACKAGE_LIMIT): string[] {
  const keep = [...parts]
  while (keep.join('\n').length > limit) {
    let worst = 0
    let at = -1
    keep.forEach((p, i) => { const l = level(p); if (l > 0 && l >= worst) { worst = l; at = i } })
    if (at < 0) break
    keep.splice(at, 1)
  }
  return keep
}

/** Two accounts in the same file within this time are probably stepping on each other. */
export const SHARED_FILE_MS = 30 * 60_000

/**
 * Said to an account right after it writes a file another account wrote a moment ago (the app records every write from the
 * hooks). Once per file and session. It does not stop anyone: reservations are by task, and two tasks can meet in a file.
 */
export function sharedFileWarning(db: DB, account: AccountId, file: string, sessionId: string | undefined, projectId: string | undefined, now = Date.now()): string | undefined {
  const path = nativePath(file)
  const other = db
    .prepare("SELECT account, MAX(at) AS at FROM events WHERE kind = 'archivo' AND lower(replace(detail, char(92), '/')) = lower(?) AND account IS NOT NULL AND account != ? AND at > ? GROUP BY account ORDER BY at DESC LIMIT 1")
    .get(path.split('\\').join('/'), account, now - SHARED_FILE_MS) as { account: string; at: number } | undefined
  if (!other) return undefined
  const name = path.split(/[\\/]/).pop() ?? path
  const fresh = addEvent(db, { projectId, at: now, account, kind: 'aviso', title: t('Claude {v0} y Claude {v1} han escrito el mismo archivo: {name}', { v0: account.slice(6), v1: other.account.slice(6), name: name }), detail: path, source: 'Mission Control', dedupe: `sw:${sessionId ?? account}:${path.toLowerCase()}` })
  if (!fresh) return undefined
  const min = Math.max(1, Math.round((now - other.at) / 60_000))
  return t('Mission Control: {account} escribió este mismo archivo ({path}) hace {min} min. Vuelve a leerlo antes de tocarlo otra vez (puede haber cambiado desde que lo leíste), no deshagas sus cambios y mira con pmc claims qué tarea lleva: si las dos tocan lo mismo, deja la tuya en un punto que compile y sigue por otra parte, o apúntalo en el relevo para que no os piséis.', { account: other.account, path: path, min: min })
}

/** Accounts the user marked «No usar» or «De baja», from the summary the app keeps. */
export function accountsOut(file = join(paths.root(), 'team.json')): Set<string> {
  try { const d = JSON.parse(readFileSync(file, 'utf8')); return new Set(Array.isArray(d.out) ? d.out : []) } catch { return new Set() }
}

/** How a session is told to run pmc: the bare word once the app has left its launchers on the PATH (core/shim.ts). */
export function pmcCommand(): string {
  const mjs = join(paths.binDir(), 'pmc.mjs')
  if (shimReady(mjs)) return 'pmc'
  const runner = nodeRunner()
  return `${runner === 'node' ? 'node' : `"${runner.split('\\').join('/')}"`} "${mjs.split('\\').join('/')}"`
}

function teamStates(now: number): Map<string, string> {
  try {
    const d = JSON.parse(readFileSync(join(paths.root(), 'team.json'), 'utf8'))
    if (now - d.at > 30 * 60_000) return new Map()
    return new Map((d.team as any[]).map((t) => [t.id, t.state]))
  } catch {
    return new Map()
  }
}
