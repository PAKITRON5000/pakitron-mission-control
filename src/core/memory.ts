// The project's memory (EV63, EV75; the user, 13-11: «la memoria, es más fácil gestionarla con el programa para que
// Claude no se olvide de las cosas fácilmente porque tiene dónde acudir y leer»). Claude forgets what was asked or decided
// when a conversation ends or is compacted; Mission Control keeps it, by project, and hands it over short at the start of
// every session and after every compaction (SessionStart, also with source «compact»): the rules first, then what the
// user prefers, the facts, and the last decisions he took in Decidir.
import type { DB } from './db'
import { inForce } from './contradict'

export type MemoryKind = 'regla' | 'preferencia' | 'dato'

export const MEMORY_KINDS: { id: MemoryKind; label: string; hint: string }[] = [
  { id: 'regla', label: 'Regla', hint: 'Lo que nunca o siempre se hace («no toques la aceleración del personaje», «pregunta antes de borrar»). Si nombras un archivo o una carpeta («no toques tools/unity.ps1»), los Claude no podrán cambiarlo ni borrarlo.' },
  { id: 'preferencia', label: 'Preferencia', hint: 'Cómo le gustan las cosas al usuario («textos con humor», «fotos antes de preguntar»).' },
  { id: 'dato', label: 'Dato', hint: 'Algo del proyecto que hay que saber («la copia de trabajo es rachas», «el monitor es 3440×1440»).' }
]

export interface Memory {
  id: number
  projectId: string
  kind: MemoryKind
  text: string
  /** Who wrote it: «usuario», or the account that saved it with pmc recuerda. */
  source: string
  at: number
}

const row = (r: any): Memory => ({ id: r.id, projectId: r.project_id, kind: r.kind, text: r.text, source: r.source, at: r.at })

/**
 * EV24: what holds in every project (the accounts, speaking Spanish, not bothering while the user plays…), kept once and
 * given to every session of every project; `pmc recuerda --todos` or «En todos» in Memoria.
 */
export const ALL_PROJECTS = '_todos'

export function listMemories(db: DB, projectId: string, withCommon = true): Memory[] {
  const ids = withCommon && projectId !== ALL_PROJECTS ? [projectId, ALL_PROJECTS] : [projectId]
  return (db.prepare(`SELECT * FROM memories WHERE project_id IN (${ids.map(() => '?').join(',')}) AND gone = 0 ORDER BY CASE kind WHEN 'regla' THEN 0 WHEN 'preferencia' THEN 1 ELSE 2 END, at DESC`).all(...ids) as any[]).map(row)
}

/** How long a memory can be: it goes into every session's startup package. */
export const MEMORY_MAX = 400

/**
 * One line, at most MEMORY_MAX characters, cut at a word with «…» (14-11: the user's 16:20 order was kept as
 * «…flujos, estructuras) s», cut mid-word, in every session's package).
 */
export function memoryLine(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= MEMORY_MAX) return t
  const sp = t.lastIndexOf(' ', MEMORY_MAX - 1)
  return `${t.slice(0, sp > MEMORY_MAX * 0.7 ? sp : MEMORY_MAX - 1).replace(/[\s,;:.(-]+$/, '')}…`
}

export function addMemory(db: DB, m: { projectId: string; kind: MemoryKind; text: string; source: string }, now = Date.now()): Memory {
  const text = memoryLine(m.text)
  if (!text) throw new Error('El recuerdo está vacío')
  const kind: MemoryKind = MEMORY_KINDS.some((k) => k.id === m.kind) ? m.kind : 'dato'
  // The same text twice is one memory (a Claude that saves it again after a compaction).
  const same = db.prepare('SELECT * FROM memories WHERE project_id = ? AND gone = 0 AND lower(text) = lower(?)').get(m.projectId, text)
  if (same) return row(same)
  const r = db.prepare('INSERT INTO memories(project_id, kind, text, source, at) VALUES(?,?,?,?,?)').run(m.projectId, kind, text, m.source, now)
  return row(db.prepare('SELECT * FROM memories WHERE id = ?').get(Number(r.lastInsertRowid)))
}

export function forgetMemory(db: DB, id: number): void {
  db.prepare('UPDATE memories SET gone = 1 WHERE id = ?').run(id)
}

export function editMemory(db: DB, id: number, patch: { text?: string; kind?: MemoryKind }): void {
  if (patch.text != null) db.prepare('UPDATE memories SET text = ? WHERE id = ?').run(memoryLine(patch.text), id)
  if (patch.kind) db.prepare('UPDATE memories SET kind = ? WHERE id = ?').run(patch.kind, id)
}

/** The decisions the user took lately in Decidir, as one line each: what was asked and what he chose. */
export function recentDecisions(db: DB, projectId: string, max = 5, since = Date.now() - 14 * 86400_000): string[] {
  const rows = db.prepare("SELECT title, options, choice, note FROM decisions WHERE project_id = ? AND status = 'decidida' AND decided_at > ? ORDER BY decided_at DESC LIMIT ?").all(projectId, since, max) as { title: string; options: string; choice?: string; note?: string }[]
  return rows.map((r) => {
    let label = r.choice ?? ''
    try { label = (JSON.parse(r.options) as { id: string; label: string }[]).find((o) => o.id === r.choice)?.label ?? label } catch { /* plain */ }
    // EV75: short, so the whole startup package stays under 4.000 characters; the rest is in Decidir.
    const note = r.note ? ` («${r.note.replace(/\s+/g, ' ').slice(0, 70)}${r.note.length > 70 ? '…' : ''}»)` : ''
    return `${r.title.slice(0, 70)}: ${label.slice(0, 50) || 'con nota'}${note}`
  })
}

/** What every session reads first (≤ budget characters): the project's memory, rules first, and the last decisions. */
export function memoryText(projectName: string, memories: Memory[], decisions: string[], budget = 1800): string {
  if (!memories.length && !decisions.length) return ''
  // EV92: of two that contradict each other, only the newer one goes in.
  memories = inForce(memories)
  const label: Record<MemoryKind, string> = { regla: 'Regla', preferencia: 'Le gusta', dato: 'Dato' }
  const lines = [`Mission Control · memoria de ${projectName} (lo que no debes olvidar; el usuario la ve y la edita en Memoria; añade con pmc recuerda "…" [--regla|--preferencia]):`]
  for (const m of memories) lines.push(`- ${label[m.kind]}: ${m.text}`)
  if (decisions.length) lines.push('Decisiones recientes del usuario en Decidir:', ...decisions.map((d) => `- ${d}`))
  let out = ''
  // On its own line (14-11 it came glued to the last rule: «…el 13-11.- (hay más…»).
  for (const l of lines) { if ((out + l).length + 1 > budget) { out += '\n- (hay más en Mission Control › Memoria)'; break } out += (out ? '\n' : '') + l }
  return out
}
