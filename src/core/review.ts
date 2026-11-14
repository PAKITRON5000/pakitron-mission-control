import { t } from './i18n'
// Comments on assets and instructions to the agents, with honest delivery states:
//   guardada           only in Mission Control's database
//   entregada          written where agents look (the project's Buzón.md, with the user's permission)
//   recibida           the line is gone from the Buzón: the agents' rule is "if a note is no longer there, it was read and filed"
//   ejecutada          the user (or a check they authorised) says it is done
// Nothing is shown as delivered before it has actually been written to a channel an agent reads.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountId, Comment, CommentStatus, Instruction, InstructionKind, ProjectConfig } from './types'
import { addEvent, type DB } from './db'
import { backupFile } from './integrations'

function rowToComment(r: any): Comment {
  return {
    id: r.id, projectId: r.project_id, assetId: r.asset_id ?? undefined, x: r.x ?? undefined, y: r.y ?? undefined, timeSec: r.time_sec ?? undefined,
    shape: r.shape ?? undefined, geom: r.geom ? JSON.parse(r.geom) : undefined, framePath: r.frame_path ?? undefined, keptPath: r.kept_path ?? undefined, assetMtime: r.asset_mtime ?? undefined, body: r.body, status: r.status, target: r.target ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
    instructionId: r.instruction_id ?? undefined, history: JSON.parse(r.history || '[]')
  }
}

function rowToInstruction(r: any): Instruction {
  return {
    id: r.id, projectId: r.project_id, kind: r.kind, body: r.body, target: r.target ?? undefined, status: r.status, channel: r.channel ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at, deliveredAt: r.delivered_at ?? undefined, commentId: r.comment_id ?? undefined,
    assetId: r.asset_id ?? undefined, error: r.error ?? undefined
  }
}

export function listComments(db: DB, projectId: string, assetId?: number): Comment[] {
  const rows = assetId
    ? db.prepare('SELECT * FROM comments WHERE project_id = ? AND asset_id = ? ORDER BY created_at').all(projectId, assetId)
    : db.prepare('SELECT * FROM comments WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
  return (rows as any[]).map(rowToComment)
}

export function listInstructions(db: DB, projectId: string): Instruction[] {
  return (db.prepare('SELECT * FROM instructions WHERE project_id = ? ORDER BY created_at DESC LIMIT 500').all(projectId) as any[]).map(rowToInstruction)
}

export interface NewComment {
  projectId: string
  assetId?: number
  x?: number
  y?: number
  timeSec?: number
  shape?: 'pin' | 'circle' | 'rect' | 'arrow' | 'pen'
  geom?: { r?: number; x2?: number; y2?: number; p?: [number, number, number]; pts?: [number, number][] }
  framePath?: string
  assetMtime?: number
  body: string
  target?: AccountId
}

/** Saves a comment and the correction instruction it becomes (step 1-4 of the review flow). */
export function addComment(db: DB, c: NewComment, assetLabel: string): { comment: Comment; instruction: Instruction } {
  const now = Date.now()
  const history = JSON.stringify([{ at: now, status: 'pendiente' }])
  const r = db
    .prepare('INSERT INTO comments(project_id, asset_id, x, y, time_sec, shape, geom, frame_path, asset_mtime, body, status, target, history, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(c.projectId, c.assetId ?? null, c.x ?? null, c.y ?? null, c.timeSec ?? null, c.shape ?? 'pin', c.geom ? JSON.stringify(c.geom) : null, c.framePath ?? null, c.assetMtime ?? null, c.body, 'pendiente', c.target ?? null, history, now, now)
  const commentId = Number(r.lastInsertRowid)
  const where = c.timeSec != null ? ` en el segundo ${fmtTime(c.timeSec)}` : c.x != null ? ` (punto ${Math.round(c.x * 100)} %, ${Math.round((c.y ?? 0) * 100)} %)` : ''
  const point3d = c.geom?.p ? ` (punto del modelo ${c.geom.p.map((v) => v.toFixed(3)).join(', ')})` : ''
  const shapeWord = point3d ? point3d : c.shape === 'circle' ? ', marcado con un círculo' : c.shape === 'arrow' ? ', señalado con una flecha' : c.shape === 'pen' ? ', marcado a mano sobre la imagen' : c.shape === 'rect' ? ', dentro del recuadro marcado' : ''
  const body = `${c.body} — sobre ${assetLabel}${where}${shapeWord}${c.framePath ? `. Fotograma: ${c.framePath}` : ''}`
  const ins = addInstruction(db, { projectId: c.projectId, kind: 'correccion', body, target: c.target, commentId, assetId: c.assetId })
  db.prepare('UPDATE comments SET instruction_id = ? WHERE id = ?').run(ins.id, commentId)
  addEvent(db, { projectId: c.projectId, at: now, account: c.target, kind: 'comentario', title: t('Has comentado {assetLabel}: «{v0}»', { assetLabel: assetLabel, v0: c.body.slice(0, 120) }), source: 'Mission Control', ref: `asset:${c.assetId}` })
  return { comment: rowToComment(db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId)), instruction: ins }
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

/** Fixes the text of a note. Its correction gets the new text; if an agent had already received it, it is sent again. */
export function editComment(db: DB, id: number, body: string): Comment {
  const r = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as any
  if (!r) throw new Error(t('El comentario no existe'))
  const now = Date.now()
  db.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(body, now, id)
  if (r.instruction_id) {
    const ins = db.prepare('SELECT body, status FROM instructions WHERE id = ?').get(r.instruction_id) as any
    if (ins) {
      const newBody = String(ins.body).startsWith(r.body) ? body + String(ins.body).slice(r.body.length) : body
      const resend = ins.status === 'recibida' || ins.status === 'entregada'
      db.prepare('UPDATE instructions SET body = ?, status = ?, updated_at = ? WHERE id = ?').run(resend ? `(Corregido) ${newBody}` : newBody, resend ? 'guardada' : ins.status, now, r.instruction_id)
    }
  }
  return rowToComment(db.prepare('SELECT * FROM comments WHERE id = ?').get(id))
}

/** Removes a note and its correction (if no agent has it yet, nobody will ever see it). */
export function deleteComment(db: DB, id: number): void {
  const r = db.prepare('SELECT instruction_id FROM comments WHERE id = ?').get(id) as any
  if (r?.instruction_id) db.prepare('DELETE FROM instructions WHERE id = ?').run(r.instruction_id)
  db.prepare('DELETE FROM comments WHERE id = ?').run(id)
}

export function setCommentStatus(db: DB, id: number, status: CommentStatus, note?: string): Comment {
  const r = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as any
  if (!r) throw new Error(t('El comentario no existe'))
  const now = Date.now()
  const history = JSON.parse(r.history || '[]')
  history.push({ at: now, status, note })
  db.prepare('UPDATE comments SET status = ?, history = ?, updated_at = ? WHERE id = ?').run(status, JSON.stringify(history), now, id)
  if (status === 'aprobado' && r.instruction_id) db.prepare("UPDATE instructions SET status = 'ejecutada', updated_at = ? WHERE id = ?").run(now, r.instruction_id)
  if (status === 'reabierto' && r.instruction_id) db.prepare("UPDATE instructions SET status = 'guardada', channel = NULL, delivered_at = NULL, updated_at = ? WHERE id = ?").run(now, r.instruction_id)
  addEvent(db, { projectId: r.project_id, at: now, kind: 'comentario-estado', title: t('Comentario «{v0}»: {status}', { v0: r.body.slice(0, 80), status: status }), detail: note, source: 'Mission Control', ref: `asset:${r.asset_id}` })
  return rowToComment(db.prepare('SELECT * FROM comments WHERE id = ?').get(id))
}

export interface NewInstruction {
  projectId: string
  kind: InstructionKind
  body: string
  target?: AccountId
  commentId?: number
  assetId?: number
}

export function addInstruction(db: DB, i: NewInstruction): Instruction {
  const now = Date.now()
  const r = db
    .prepare('INSERT INTO instructions(project_id, kind, body, target, status, comment_id, asset_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(i.projectId, i.kind, i.body, i.target ?? null, 'guardada', i.commentId ?? null, i.assetId ?? null, now, now)
  const id = Number(r.lastInsertRowid)
  if (!i.commentId) {
    addEvent(db, { projectId: i.projectId, at: now, account: i.target, kind: 'instruccion', title: t('Has escrito ({v0}): «{v1}»', { v0: KIND_LABEL[i.kind].toLowerCase(), v1: i.body.slice(0, 140) }), source: 'Mission Control', ref: `ins:${id}` })
  }
  return rowToInstruction(db.prepare('SELECT * FROM instructions WHERE id = ?').get(id))
}

export const KIND_LABEL: Record<InstructionKind, string> = {
  nota: 'Nota privada', idea: 'Idea', tarea: 'Tarea nueva', correccion: 'Corrección', prioridad: 'Cambio de prioridad', mensaje: 'Mensaje a un agente', general: 'Instrucción general'
}

/** Guesses where an instruction goes from its words; the user can always change it. */
export function guessKind(text: string): { kind: InstructionKind; target?: AccountId; confident: boolean } {
  const t = text.toLowerCase()
  const acc = t.match(/claude\s?(\d{1,2})/)
  const target = acc ? (`claude${acc[1]}` as AccountId) : undefined
  if (/^(nota|apunte personal|recordatorio)\b|solo para m[ií]/.test(t)) return { kind: 'nota', target, confident: true }
  if (/gu[aá]rda(la|lo)? en ideas|nueva idea|quiero añadir|se me ocurre|ser[ií]a (genial|chulo|bueno)/.test(t)) return { kind: 'idea', target, confident: true }
  if (/prioriza|antes de seguir|lo primero|m[aá]s importante|urgente/.test(t)) return { kind: 'prioridad', target, confident: true }
  if (/corrige|arregla|est[aá]n? mal|fallo|error|no funciona|atraviesa/.test(t)) return { kind: 'correccion', target, confident: true }
  if (target && /encárgate|ocúpate|haz|revisa|mira/.test(t)) return { kind: 'mensaje', target, confident: true }
  if (/haz|añade|implementa|crea|pon/.test(t)) return { kind: 'tarea', target, confident: false }
  return { kind: 'general', target, confident: false }
}

// ---- Buzón.md -----------------------------------------------------------------------------------------------------

export function buzonFile(project: ProjectConfig): string {
  return join(project.root, 'docs', 'Buzón.md')
}

const BUZON_TAG = (id: number) => `(MC-${id})`

export function buzonLine(i: Instruction): string {
  const who = i.target ? `para ${i.target}` : 'para quien entre'
  return `- ${i.body.replace(/\s*\n\s*/g, ' ')} · ${KIND_LABEL[i.kind].toLowerCase()}, ${who}, desde Mission Control ${BUZON_TAG(i.id)}`
}

/**
 * Writes the instruction under «## Apuntes nuevos» of the Buzón, only if the user allowed it for this project.
 * A copy of the file is kept first. The line carries a tag so its removal can be told apart.
 */
export function deliverToBuzon(db: DB, project: ProjectConfig, id: number): Instruction {
  const r = db.prepare('SELECT * FROM instructions WHERE id = ? AND project_id = ?').get(id, project.id) as any
  if (!r) throw new Error(t('La instrucción no existe'))
  const ins = rowToInstruction(r)
  if (!project.allowBuzon) throw new Error(t('Este proyecto no permite escribir en el Buzón. Actívalo en Ajustes › Proyecto.'))
  const file = buzonFile(project)
  if (!existsSync(file)) throw new Error(t('No existe {file}', { file: file }))
  const now = Date.now()
  try {
    const text = readFileSync(file, 'utf8')
    if (text.includes(BUZON_TAG(id))) {
      db.prepare("UPDATE instructions SET status = 'entregada', channel = ?, updated_at = ? WHERE id = ?").run(file, now, id)
      return rowToInstruction(db.prepare('SELECT * FROM instructions WHERE id = ?').get(id))
    }
    backupFile(file, `buzon-${project.id}`)
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split(/\r?\n/)
    const h = lines.findIndex((l) => /^##\s+Apuntes nuevos/i.test(l))
    const line = buzonLine(ins)
    if (h < 0) lines.push('', '## Apuntes nuevos', '', line)
    else {
      let j = h + 1
      while (j < lines.length && !/^##\s/.test(lines[j])) j++
      // Drop a lone "-" placeholder, insert after the last real entry of the section.
      let k = j
      while (k > h + 1 && lines[k - 1].trim() === '') k--
      if (lines[k - 1]?.trim() === '-') { lines.splice(k - 1, 1); k-- }
      lines.splice(k, 0, line)
    }
    const tmp = file + '.pmc-tmp'
    writeFileSync(tmp, lines.join(eol), 'utf8')
    renameSync(tmp, file)
    db.prepare("UPDATE instructions SET status = 'entregada', channel = ?, delivered_at = ?, error = NULL, updated_at = ? WHERE id = ?").run(file, now, now, id)
    if (ins.commentId) setCommentStatus(db, ins.commentId, 'pendiente', 'Escrito en el Buzón')
    addEvent(db, { projectId: project.id, at: now, account: ins.target, kind: 'entrega', title: t('Instrucción escrita en el Buzón: «{v0}»', { v0: ins.body.slice(0, 100) }), source: 'Mission Control', ref: `ins:${id}` })
  } catch (e) {
    db.prepare("UPDATE instructions SET status = 'fallida', error = ?, updated_at = ? WHERE id = ?").run((e as Error).message, now, id)
  }
  return rowToInstruction(db.prepare('SELECT * FROM instructions WHERE id = ?').get(id))
}

/** Delivered lines that are no longer in the Buzón were read by an agent (their rule). */
export function checkBuzonReceipts(db: DB, project: ProjectConfig): number {
  const pending = db.prepare("SELECT * FROM instructions WHERE project_id = ? AND status = 'entregada' AND channel LIKE '%Buz%'").all(project.id) as any[]
  if (!pending.length) return 0
  let text: string
  try { text = readFileSync(buzonFile(project), 'utf8') } catch { return 0 }
  let n = 0
  const now = Date.now()
  for (const r of pending) {
    if (text.includes(BUZON_TAG(r.id))) continue
    db.prepare("UPDATE instructions SET status = 'recibida', updated_at = ? WHERE id = ?").run(now, r.id)
    if (r.comment_id) setCommentStatus(db, r.comment_id, 'recibido', 'Ya no está en el Buzón: un agente lo ha pasado a la lista')
    addEvent(db, { projectId: project.id, at: now, account: r.target ?? undefined, kind: 'recibida', title: t('Un agente ha recogido del Buzón: «{v0}»', { v0: String(r.body).slice(0, 100) }), source: 'Buzón.md', ref: `ins:${r.id}` })
    n++
  }
  return n
}

export function setInstructionStatus(db: DB, id: number, status: Instruction['status']): Instruction {
  db.prepare('UPDATE instructions SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
  return rowToInstruction(db.prepare('SELECT * FROM instructions WHERE id = ?').get(id))
}
