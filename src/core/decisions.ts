import { t } from './i18n'
// Decisions: what a Claude needs the user to decide or approve, with pictures. A Claude asks with `pmc decide` and goes
// on with something else; the user answers in Mission Control with one click (and a note if he wants); the answer goes
// back to that Claude as an instruction, through the same hooks that deliver everything else. The pictures are copied
// into Mission Control's own folder when asked, so a later capture with the same name never changes what he saw.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AccountId, Decision, DecisionMedia, DecisionOption, DecisionStatus, ProjectConfig } from './types'
import { paths } from './paths'
import { addEvent, type DB } from './db'
import { addInstruction } from './review'

export const decisionsDir = () => join(paths.root(), 'decisions')

function row(r: any): Decision {
  const j = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T } catch { return d } }
  return {
    id: r.id, projectId: r.project_id, title: r.title, question: r.question, context: r.context,
    options: j<DecisionOption[]>(r.options, []), images: j<DecisionMedia[]>(r.images, []).map((m) => ({ ...m, kind: m.kind ?? mediaKind(m.path) })),
    reactions: r.reactions ? j<Record<number, 'si' | 'no'>>(r.reactions, {}) : undefined,
    askedBy: r.asked_by ?? undefined, taskExtId: r.task_ext_id ?? undefined, priority: r.priority, status: r.status,
    choice: r.choice ?? undefined, note: r.note ?? undefined, instructionId: r.instruction_id ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at, decidedAt: r.decided_at ?? undefined,
    defaultChoice: r.default_choice ?? undefined, waitUntil: r.wait_until ?? undefined
  }
}

export interface NewDecision {
  projectId: string
  title: string
  question?: string
  context?: string
  /** "Etiqueta" or "Etiqueta: detalle", or full options. */
  options?: (string | DecisionOption)[]
  /** A path, or a path with what it is and what it is for. On the CLI: "ruta::qué es::para qué momento". */
  images?: (string | { path: string; caption?: string; group?: string })[]
  askedBy?: AccountId
  taskExtId?: string
  priority?: number
  /** The same key updates the open decision instead of adding another (a Claude asking again after a new capture). */
  dedupe?: string
  /** EV79: the option (its letter, label or id) taken if nobody answers within `waitHours` (12 by default). */
  defaultChoice?: string
  waitHours?: number
}

/** The option a «por defecto» names: its id, or the option whose label is or starts with it («A» for «A: Sí, así»). */
/**
 * Words the user does not know, in a question for him (13-11: to #140, about «ganchos» in «settings.local.json», he
 * answered «no entiendo muy bien esto… es que no entiendo bien la pregunta»). `pmc decide` refuses a question with them
 * until it is written with what he will see or notice; `--clara` lets it through when the word is truly needed.
 */
const JARGON: [RegExp, string][] = [
  [/\bganchos?\b/i, 'ganchos'], [/\bhooks?\b/i, 'hooks'], [/\bsettings(\.local)?\.json\b/i, 'settings.json'], [/\.claude\.json\b/i, '.claude.json'],
  [/\bworktrees?\b/i, 'worktree'], [/\bstatus ?line\b/i, 'statusLine'], [/\bMCP\b/, 'MCP'], [/\bCLI\b/, 'CLI'], [/\bAPI\b/, 'API'], [/\bIPC\b/, 'IPC'],
  [/\bendpoints?\b/i, 'endpoint'], [/\bstd(out|err)\b/i, 'stdout'], [/\bregex\b/i, 'regex'], [/\brefactori?[zs]/i, 'refactorizar'], [/\basync\b/i, 'async'],
  [/\bCRLF\b/, 'CRLF'], [/\brebase\b/i, 'rebase'], [/\bpayload\b/i, 'payload'], [/\bspool\b/i, 'spool'], [/\bschema\b/i, 'schema'], [/\bfrontmatter\b/i, 'frontmatter'],
  [/\b(src|core|main|renderer)\/[\w./-]+/i, 'rutas de código'], [/\b[\w-]+\.(ts|tsx|mjs|cjs)\b/i, 'archivos de código'], [/`[^`]{2,}`/, 'nombres entre comillas de código']
]

/** The technical words in a question for the user (title, question, context and options together). */
export function jargonIn(...texts: (string | undefined)[]): string[] {
  const all = texts.filter(Boolean).join('\n')
  return [...new Set(JARGON.filter(([re]) => re.test(all)).map(([, w]) => w))]
}

export function resolveOption(options: DecisionOption[], said?: string): string | undefined {
  const s = said?.trim().toLowerCase()
  if (!s) return undefined
  return (options.find((o) => o.id.toLowerCase() === s) ?? options.find((o) => o.label.toLowerCase() === s) ?? options.find((o) => o.label.toLowerCase().startsWith(s)))?.id
}

export function parseOptions(list: (string | DecisionOption)[] = []): DecisionOption[] {
  return list
    .map((o, i) => {
      if (typeof o !== 'string') return o
      const m = o.match(/^\s*([^:]{1,60}):\s*(.+)$/)
      return { id: `o${i + 1}`, label: (m ? m[1] : o).trim(), detail: m ? m[2].trim() : undefined }
    })
    .filter((o) => o.label)
}

const IMAGE_LIMIT = 300 << 20

export function mediaKind(file: string): DecisionMedia['kind'] {
  const e = extname(file).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].includes(e)) return 'image'
  if (['.ogg', '.mp3', '.wav', '.flac', '.m4a', '.opus'].includes(e)) return 'audio'
  if (['.mp4', '.webm', '.mov', '.m4v', '.mkv'].includes(e)) return 'video'
  return 'other'
}

/** "ruta::qué es::para qué momento" → its parts (a Windows path never has "::"). */
export function parseMediaArg(s: string): { path: string; caption?: string; group?: string } {
  const [path, caption, group] = s.split('::').map((x) => x.trim())
  return { path, caption: caption || undefined, group: group || undefined }
}

/** Copies the pictures and sounds next to Mission Control's data; a missing file is left out. */
function keepImages(id: number, list: NewDecision['images'] = []): DecisionMedia[] {
  mkdirSync(decisionsDir(), { recursive: true })
  const out: DecisionMedia[] = []
  list.forEach((x, n) => {
    const src = typeof x === 'string' ? x : x.path
    const name = basename(src, extname(src))
    const caption = typeof x === 'string' ? name : x.caption ?? name
    const group = typeof x === 'string' ? undefined : x.group
    try {
      if (!existsSync(src) || statSync(src).size > IMAGE_LIMIT) return
      const target = join(decisionsDir(), `${id}-${n}-${Date.now().toString(36)}${extname(src).toLowerCase()}`)
      copyFileSync(src, target)
      out.push({ path: target, source: src, caption, group, kind: mediaKind(src) })
    } catch { /* unreadable: left out */ }
  })
  return out
}

export function addDecision(db: DB, d: NewDecision, now = Date.now()): Decision {
  const parsed = parseOptions(d.options)
  const options = JSON.stringify(parsed)
  const def = resolveOption(parsed, d.defaultChoice)
  const until = def ? now + Math.max(0.25, d.waitHours ?? 12) * 3600_000 : null
  const prio = Math.max(0, Math.min(3, d.priority ?? 2))
  const open = d.dedupe
    ? (db.prepare("SELECT id FROM decisions WHERE project_id = ? AND dedupe = ? AND status = 'pendiente'").get(d.projectId, d.dedupe) as { id: number } | undefined)
    : undefined
  let id: number
  if (open) {
    id = open.id
    db.prepare('UPDATE decisions SET title = ?, question = ?, context = ?, options = ?, asked_by = COALESCE(?, asked_by), task_ext_id = COALESCE(?, task_ext_id), priority = ?, updated_at = ? WHERE id = ?')
      .run(d.title, d.question ?? '', d.context ?? '', options, d.askedBy ?? null, d.taskExtId ?? null, prio, now, id)
    db.prepare('UPDATE decisions SET default_choice = ?, wait_until = ? WHERE id = ?').run(def ?? null, until, id)
  } else {
    // An answered decision with the same key is asked again as a new one: the key moves to the new row.
    if (d.dedupe) db.prepare('UPDATE decisions SET dedupe = NULL WHERE project_id = ? AND dedupe = ?').run(d.projectId, d.dedupe)
    const r = db
      .prepare('INSERT INTO decisions(project_id, title, question, context, options, asked_by, task_ext_id, priority, dedupe, created_at, updated_at, default_choice, wait_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(d.projectId, d.title, d.question ?? '', d.context ?? '', options, d.askedBy ?? null, d.taskExtId ?? null, prio, d.dedupe ?? null, now, now, def ?? null, until)
    id = Number(r.lastInsertRowid)
    addEvent(db, { projectId: d.projectId, at: now, account: d.askedBy, kind: 'decision', title: `${d.askedBy ? `Claude ${d.askedBy.slice(6)} pregunta` : 'Decisión pendiente'}: ${d.title}`, detail: d.question, source: 'Mission Control', ref: `dec:${id}` })
  }
  if (d.images?.length) db.prepare('UPDATE decisions SET images = ? WHERE id = ?').run(JSON.stringify(keepImages(id, d.images)), id)
  return getDecision(db, id)!
}

export function getDecision(db: DB, id: number): Decision | undefined {
  const r = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id)
  return r ? row(r) : undefined
}

/** The answer's way to the Claude that asked goes through an instruction, whose delivery is what can be told. */
export function listDecisions(db: DB, projectId: string, status?: DecisionStatus): Decision[] {
  const delivered = db.prepare('SELECT delivered_at AS at FROM instructions WHERE id = ?')
  return baseDecisions(db, projectId, status).map((d) => (d.instructionId ? { ...d, deliveredAt: (delivered.get(d.instructionId) as { at?: number } | undefined)?.at ?? undefined } : d))
}

function baseDecisions(db: DB, projectId: string, status?: DecisionStatus): Decision[] {
  const rows = status
    ? db.prepare('SELECT * FROM decisions WHERE project_id = ? AND status = ? ORDER BY priority, created_at').all(projectId, status)
    : db.prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY status != 'pendiente', CASE WHEN status = 'pendiente' THEN priority ELSE 0 END, COALESCE(decided_at, created_at) DESC LIMIT 300").all(projectId)
  return (rows as any[]).map(row)
}

export function pendingDecisionCount(db: DB, projectId: string): number {
  return (db.prepare("SELECT COUNT(*) n FROM decisions WHERE project_id = ? AND status = 'pendiente'").get(projectId) as { n: number }).n
}

/** "Le gustan: … No le gustan: …", from the thumbs on each picture or sound. */
export function reactionsText(d: Decision, reactions?: Record<number, 'si' | 'no'>): string {
  if (!reactions) return ''
  const name = (n: number) => {
    const m = d.images[n]
    return m ? `«${m.caption ?? basename(m.path)}»${m.group ? ` (${m.group})` : ''}` : ''
  }
  const yes = Object.entries(reactions).filter(([, v]) => v === 'si').map(([k]) => name(Number(k))).filter(Boolean)
  const no = Object.entries(reactions).filter(([, v]) => v === 'no').map(([k]) => name(Number(k))).filter(Boolean)
  return [yes.length ? ` Le gusta${yes.length > 1 ? 'n' : ''}: ${yes.join(', ')}.` : '', no.length ? ` No le gusta${no.length > 1 ? 'n' : ''}: ${no.join(', ')}.` : ''].join('')
}

/** The text the asking Claude receives. */
export function answerText(d: Decision, choice?: string, note?: string, status: DecisionStatus = 'decidida', reactions?: Record<number, 'si' | 'no'>): string {
  const opt = d.options.find((o) => o.id === choice)
  const what = status === 'descartada' ? 'la descarta (no hace falta hacerlo)'
    : opt ? `elige «${opt.label}»${opt.detail ? ` (${opt.detail})` : ''}`
    // EV147: «responde» alone read as an order to the Claude (14-11); it is the user answering with a note and no option.
    : choice === 'si' ? 'lo aprueba' : choice === 'no' ? 'no lo aprueba' : 'contesta con una nota, sin elegir opción'
  return t('Decisión del usuario sobre «{title}» (#{id}{v0}): {what}.{v1}{v2} Apúntalo en docs/TASKS.md (y en docs/DECISIONS.md si cambia algo de lo acordado) y sigue con esa tarea cuando le toque por prioridad.', { title: d.title, id: d.id, v0: d.taskExtId ? `, ${d.taskExtId}` : '', what: what, v1: reactionsText(d, reactions), v2: note?.trim() ? ` Su nota: ${note.trim()}` : '' })
}

/** EV147: why `pmc decide` did not save a question already asked on the same task, with what the user answered. */
export function alreadyAskedText(d: Decision): string {
  const hh = new Date(d.decidedAt ?? d.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const opt = d.options.find((o) => o.id === d.choice)
  const answer = d.status === 'pendiente' ? `aún sin contestar (hecha a las ${hh}): su respuesta te llegará sola`
    : `contestada a las ${hh}: ${opt ? `«${opt.label}»${opt.detail ? ` (${opt.detail})` : ''}` : 'sin elegir opción'}${d.note ? `; su nota: ${d.note}` : ''}`
  return t('No guardada: {taskExtId} ya tiene la pregunta #{id} «{title}» (de {v0}), {answer}. No le preguntes lo mismo dos veces: sigue con esa respuesta. Si la tuya es otra pregunta, repite la orden con --otra.', { taskExtId: d.taskExtId, id: d.id, title: d.title, v0: d.askedBy ?? 'otra cuenta', answer: answer })
}

/** EV147: the account holding the decision's task now, when it is not the one that asked (it took over meanwhile). */
export function taskHolder(db: DB, projectId: string, taskExtId: string | undefined, now = Date.now()): AccountId | undefined {
  if (!taskExtId) return undefined
  const r = db.prepare('SELECT c.account FROM claims c JOIN tasks t ON t.project_id = c.project_id AND t.key = c.task_key WHERE c.project_id = ? AND t.ext_id = ? AND t.gone = 0 AND c.expires_at > ? ORDER BY c.claimed_at DESC LIMIT 1').get(projectId, taskExtId, now) as { account?: string } | undefined
  return r?.account as AccountId | undefined
}

/**
 * EV147: a question on this task asked or answered in the last hours, so the same thing is not asked twice (13-11: #145
 * was answered at 20:01 while its Claude was out of usage, and the one that took over asked it again as #147 at 20:16).
 */
export function recentOnTask(db: DB, projectId: string, taskExtId: string | undefined, now = Date.now(), withinMs = 12 * 3600_000): Decision | undefined {
  if (!taskExtId) return undefined
  const r = db.prepare("SELECT id FROM decisions WHERE project_id = ? AND task_ext_id = ? AND status IN ('pendiente', 'decidida') AND COALESCE(decided_at, created_at) >= ? ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 1").get(projectId, taskExtId, now - withinMs) as { id: number } | undefined
  return r ? getDecision(db, r.id) : undefined
}

export function answerDecision(db: DB, project: ProjectConfig, id: number, a: { choice?: string; note?: string; status?: DecisionStatus; reactions?: Record<number, 'si' | 'no'> }, now = Date.now()): Decision {
  const d = getDecision(db, id)
  if (!d) throw new Error(t('La decisión no existe'))
  const status = a.status ?? 'decidida'
  const reactions = a.reactions && Object.keys(a.reactions).length ? a.reactions : undefined
  // EV147: to whoever holds the task now if another account took it over; the one that asked is named.
  const holder = taskHolder(db, project.id, d.taskExtId, now)
  const to = holder && holder !== d.askedBy ? holder : d.askedBy
  const body = answerText(d, a.choice, a.note, status, reactions) + (to !== d.askedBy && d.askedBy ? ` (La preguntó ${d.askedBy}; te llega a ti porque ahora llevas ${d.taskExtId}.)` : '')
  const ins = addInstruction(db, { projectId: project.id, kind: 'mensaje', body, target: to })
  db.prepare('UPDATE decisions SET status = ?, choice = ?, note = ?, reactions = ?, instruction_id = ?, decided_at = ?, updated_at = ? WHERE id = ?')
    .run(status, a.choice ?? null, a.note?.trim() || null, reactions ? JSON.stringify(reactions) : null, ins.id, now, now, id)
  const opt = d.options.find((o) => o.id === a.choice)
  addEvent(db, {
    projectId: project.id, at: now, account: d.askedBy, kind: 'decidida',
    title: t('Has decidido «{title}»: {v0}', { title: d.title, v0: status === 'descartada' ? 'descartada' : opt?.label ?? (a.choice === 'si' ? 'aprobado' : a.choice === 'no' ? 'no aprobado' : reactions ? 'lo que te gusta y lo que no' : 'con nota') }),
    detail: a.note, source: 'Mission Control', ref: `dec:${id}`
  })
  return getDecision(db, id)!
}

/**
 * EV79: the questions nobody answered in time take their default option, and the Claude that asked gets it as an answer
 * (research, improvement 9: a question must never leave the work waiting). The user can still change it in Decidir.
 */
export function expireDecisions(db: DB, projects: ProjectConfig[], now = Date.now()): Decision[] {
  const due = db.prepare("SELECT id, project_id FROM decisions WHERE status = 'pendiente' AND default_choice IS NOT NULL AND wait_until IS NOT NULL AND wait_until <= ?").all(now) as { id: number; project_id: string }[]
  const out: Decision[] = []
  for (const r of due) {
    const p = projects.find((x) => x.id === r.project_id)
    const d = getDecision(db, r.id)
    if (!p || !d?.defaultChoice) continue
    const hours = Math.max(1, Math.round(((d.waitUntil ?? now) - d.createdAt) / 3600_000))
    out.push(answerDecision(db, p, d.id, { choice: d.defaultChoice, note: `Sin respuesta en ${hours} h: se toma la opción por defecto. El usuario puede cambiarla en Decidir.` }, now))
  }
  return out
}

/** Back to pending (the user changed his mind): the answer already sent stays sent; a new one will follow. */
export function reopenDecision(db: DB, id: number, now = Date.now()): Decision {
  db.prepare("UPDATE decisions SET status = 'pendiente', updated_at = ? WHERE id = ?").run(now, id)
  return getDecision(db, id)!
}

export function decisionImage(db: DB, id: number, n: number): string | undefined {
  const p = getDecision(db, id)?.images[n]?.path
  return p && p.toLowerCase().startsWith(decisionsDir().toLowerCase()) && existsSync(p) ? p : undefined
}
