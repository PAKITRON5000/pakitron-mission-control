// The work brief (`pmc parte`) and one task's text (`pmc tarea <ID>`): what a session needs to start, in a couple of
// kilobytes. The game project's RELEVO.md is 104 KB and its TASKS.md 297 KB (12-11), nearly all of it history, and every session
// and every hand-off was told to read them. The long files stay as an archive to search; nobody has to read them whole.
import { existsSync, readFileSync } from 'node:fs'
import type { AccountId, ProjectConfig } from './types'
import type { DB } from './db'
import { newestDoc, readText } from './projects'
import { hideCodeStars, showCodeStars, stripMd } from './parse/tasks'
import { listClaims, nextTasks, taskKeyFor, teamContext } from './coord'
import { openChangesFor } from './changes'
import { lastVerification, verificationLine } from './verify'

export const BRIEF_MAX = 4500
/** EV121: what a session with nothing left in its queue does instead of stopping (as autonomous mode says at Stop). */
export const IDLE_IDEA = 'Antes de parar, piensa qué mejorar aquí (lo que falla, lo que falta, lo que el usuario pidió y no está, pruebas, rendimiento, lo que se ve), apúntalo en docs/TASKS.md como tareas con «se da por buena cuando…», reserva la primera y empiézala.'

const HEARTBEAT_MAX = 1800
const EN_CURSO_MAX = 600

const cut = (s: string, max: number, more: string) => (s.length <= max ? s : s.slice(0, s.lastIndexOf(' ', max) > max * 0.6 ? s.lastIndexOf(' ', max) : max) + '… ' + more)

/** The two live paragraphs of a RELEVO.md: «En curso» and the newest «Último latido». Everything else in it is history. */
export function liveRelevo(markdown: string): { enCurso?: string; latest?: string } {
  let enCurso: string | undefined
  let latest: string | undefined
  const lines = markdown.split(/\r?\n/)
  for (let i = 0; i < lines.length && !(enCurso && latest); i++) {
    const raw = lines[i]
    if (!enCurso) {
      const m = raw.match(/^\*\*En curso[^*]*\*\*:?\s*(.+)$/i)
      if (m) { enCurso = stripMd(m[1]); continue }
    }
    if (!latest) {
      const inline = raw.match(/^\*\*Último latido[^*]*\*\*:?\s*(.+)$/i)
      if (inline) { latest = stripMd(inline[1]); continue }
      // As a heading («## Último latido: 2026-11-01 01:29 (claude1)»): the heading and the text under it.
      const head = raw.match(/^#{1,4}\s+Último latido[^:]*:?\s*(.*)$/i)
      if (head) {
        const body: string[] = [head[1]]
        for (let j = i + 1; j < lines.length && !/^#{1,4}\s/.test(lines[j]) && body.join(' ').length < HEARTBEAT_MAX; j++) body.push(lines[j])
        latest = stripMd(body.join(' '))
      }
    }
  }
  return { enCurso, latest }
}

export interface BriefOptions { now?: number; teamFile?: string }

const HOW_MAX = 520

/**
 * EV127 (the user, 13-11: «enseñar a los claude a cómo trabajar de la manera más eficaz según vea que es cada proyecto»):
 * «Cómo trabajarlo mejor» of the project's card (docs/PROYECTO.md), the way of working of its kind plus what the Claudes
 * learnt there, in the brief every session reads first. A card still to fill says so.
 */
export function workingNotes(project: ProjectConfig): string | undefined {
  const doc = newestDoc(project, 'PROYECTO.md')
  if (!doc) return 'Este proyecto no tiene ficha (docs/PROYECTO.md): pmc preparar la crea; rellénala leyendo el proyecto (10 minutos como mucho).'
  const md = readText(doc.file)
  const m = md.match(/^##\s+Cómo trabajarlo mejor\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m)
  const toFill = /\(por completar\)/.test(md)
  if (!m) return toFill ? `La ficha del proyecto (${doc.file}) está a medio rellenar: complétala leyendo el proyecto.` : undefined
  const text = stripMd(m[1].replace(/\r?\n+/g, ' ').trim())
  return `CÓMO SE TRABAJA AQUÍ: ${cut(text, HOW_MAX, '(sigue en docs/PROYECTO.md)')}${toFill ? ' La ficha tiene partes «(por completar)»: complétalas leyendo el proyecto.' : ''}`.trim()
}

/** Everything a session needs to start working in this project, short. Reads the newest RELEVO.md of all the copies. */
export function briefText(db: DB, project: ProjectConfig, account: AccountId, opts: BriefOptions = {}): string {
  const now = opts.now ?? Date.now()
  const out: string[] = [`Parte de ${project.name} para ${account} (${new Date(now).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}).`]
  const doc = newestDoc(project, 'RELEVO.md')
  if (doc) {
    const live = liveRelevo(readText(doc.file))
    if (live.enCurso) out.push(`EN CURSO: ${cut(live.enCurso, EN_CURSO_MAX, '')}`.trim())
    if (live.latest) out.push(`ÚLTIMO LATIDO: ${cut(live.latest, HEARTBEAT_MAX, `(sigue en ${doc.file}; busca «Último latido»)`)}`)
    if (!live.enCurso && !live.latest) out.push(`RELEVO.md (${doc.file}) no tiene «En curso» ni «Último latido»: ponlos al cerrar tu primer bloque.`)
  } else out.push('Este proyecto no tiene docs/RELEVO.md: créalo al cerrar tu primer bloque (una línea «En curso» y un «Último latido» con fecha y hora).')
  const how = workingNotes(project)
  if (how) out.push(how)

  const changes = openChangesFor(db, project.id, account)
  if (changes.length) {
    out.push('CAMBIOS QUE PIDIÓ EL USUARIO AL REVISAR (van antes que lo nuevo):')
    for (const c of changes.slice(0, 5)) out.push(`- ${c.extId ?? c.title}: ${cut(c.note, 300, '')}`.trim())
  }
  // nextTasks puts the changes first and counts them in its limit: ask for room for both.
  const next = nextTasks(db, project.id, account, 6 + changes.length, now).filter((t) => !t.change).slice(0, 6)
  if (next.length) {
    const P = ['URGENTE', 'alta', '', 'baja']
    out.push('TU COLA (por orden):')
    for (const t of next) {
      const tags = [P[t.priority], t.assignedFrom ? `encargo, era de ${t.assignedFrom}` : '', t.status === 'en-desarrollo' ? 'a medias' : '', t.mine ? 'reservada por ti' : '', t.model ? `basta con ${t.model}` : ''].filter(Boolean)
      out.push(`- ${t.extId ?? t.key} · ${cut(stripMd(t.title), 110, '')}${tags.length ? ` [${tags.join(', ')}]` : ''}`)
    }
  } else out.push(`TU COLA: no queda ninguna tarea libre (las que esperan al usuario o un hecho real no cuentan). ${IDLE_IDEA}`)
  const claims = listClaims(db, project.id, now).filter((c) => !c.abandoned && c.account !== account)
  if (claims.length) out.push(`RESERVADAS POR OTRAS CUENTAS (no las toques): ${claims.slice(0, 12).map((c) => `${c.taskKey} (${c.account})`).join(', ')}.`)
  const team = teamContext(account, now, opts.teamFile, project.id)
  if (team) out.push(`EQUIPO: ${team.split('\n')[0].replace(/^Las otras cuentas ahora: /, '')}`)
  out.push('El texto completo de una tarea: pmc tarea <ID>. No leas RELEVO.md, TASKS.md ni STATE.md enteros: son archivo; busca en ellos solo lo que te falte.')
  const text = out.join('\n')
  return text.length <= BRIEF_MAX ? text : text.slice(0, BRIEF_MAX - 1) + '…'
}

const TASK_MAX = 6000

/** Notes kept in front of a task's own words by `pmc tarea` (the newest); the older ones, with --todo. */
const NOTES_SHOWN = 2

/**
 * 14-11: every account leaves its note in front of the task («*Hecha…* *Casi…* *Segundo paso…*…»), and `pmc tarea`
 * printed them all (EV141: ~4,000 characters) to whoever only needs where it stands. The newest NOTES_SHOWN and the
 * task's own words stay; the rest is counted. A «*» inside `code` is not the end of a note.
 */
export function condenseNotes(line: string, keep = NOTES_SHOWN): { text: string; hidden: number } {
  const hidden = hideCodeStars(line)
  const m = hidden.match(/^(\s*- \[[ xX~]\]\s+(?:[A-Za-z]{1,6}\d+[a-z]?\s*[·:]\s*)?)(.*)$/)
  if (!m) return { text: line, hidden: 0 }
  let rest = m[2]
  const notes: string[] = []
  for (let k = 0; k < 40; k++) {
    if (k) rest = rest.replace(/^-\s+\[[ xX~]\]\s+(?:[A-Za-z]{1,6}\d+[a-z]?\s*[·:]\s*)?(?=\*(?!\*))/, '')
    const n = rest.match(/^\*(?!\*)([^*]+)\*\s*/)
    if (!n || rest.slice(n[0].length).trim().length <= 12) break
    notes.push(n[0].trim())
    rest = rest.slice(n[0].length)
  }
  if (notes.length <= keep + 1) return { text: line, hidden: 0 }
  const gone = notes.length - keep
  const text = `${m[1]}${notes.slice(0, keep).join(' ')} *(${gone} notas anteriores: pmc tarea <ID> --todo)* ${rest}`
  return { text: showCodeStars(text), hidden: gone }
}

/** One task as it is written in TASKS.md (its line and what hangs from it), with who holds it and what the user asked. */
export function taskText(db: DB, project: ProjectConfig, idOrKey: string, now = Date.now(), opts: { all?: boolean } = {}): string | undefined {
  const r = db
    .prepare(`SELECT key, ext_id, title, detail, section, source_file, source_line, priority, owner, verified, COALESCE(override, status) AS st
      FROM tasks WHERE project_id = ? AND (ext_id = ? OR key = ?) AND gone = 0 ORDER BY id LIMIT 1`)
    .get(project.id, idOrKey, idOrKey) as any
  if (!r) return undefined
  const out: string[] = []
  let body: string | undefined
  if (r.source_file && r.source_line && existsSync(r.source_file)) {
    const lines = readFileSync(r.source_file, 'utf8').split(/\r?\n/)
    const first = lines[r.source_line - 1] ?? ''
    // The file may have moved under the index since the last sync: only trust the line if it still names the task.
    if (/^\s*- \[[ x~X]\]/.test(first) && (!r.ext_id || first.includes(r.ext_id))) {
      const depth = first.match(/^\s*/)![0].length
      const block = [first]
      for (let i = r.source_line; i < lines.length; i++) {
        const l = lines[i]
        if (/^#{1,4}\s/.test(l)) break
        if (l.trim() && l.match(/^\s*/)![0].length <= depth) break
        block.push(l)
      }
      // Its older notes counted, not printed (--todo prints them).
      if (!opts.all) block[0] = condenseNotes(block[0]).text.replace('pmc tarea <ID> --todo', `pmc tarea ${r.ext_id ?? r.key} --todo`)
      body = block.join('\n').trimEnd()
    }
  }
  const P = ['urgente', 'alta', 'normal', 'baja']
  out.push(`${r.ext_id ?? r.key} · ${r.st}${r.verified ? ' (aceptada por el usuario)' : ''} · prioridad ${P[r.priority] ?? 'normal'}${r.owner ? ` · de ${r.owner}` : ''}${r.section ? ` · sección «${stripMd(r.section).slice(0, 90)}»` : ''}`)
  const holder = listClaims(db, project.id, now).find((c) => c.taskKey === r.key && !c.abandoned)
  if (holder) out.push(`Reservada por ${holder.account}${holder.note ? ` (${holder.note})` : ''}.`)
  const change = db.prepare("SELECT note FROM task_changes WHERE project_id = ? AND task_key = ? AND status = 'pedido' ORDER BY id DESC LIMIT 1").get(project.id, r.key) as { note: string } | undefined
  if (change) out.push(`El usuario pidió al revisarla: ${change.note}`)
  const seen = lastVerification(db, project.id, r.key)
  if (seen || r.st === 'terminada') out.push(verificationLine(seen))
  out.push(body ?? `${r.title}${r.detail ? '\n' + r.detail : ''}`)
  if (r.source_file) out.push(`(${r.source_file}${r.source_line ? `, línea ${r.source_line}` : ''})`)
  const text = out.join('\n')
  return text.length <= TASK_MAX ? text : text.slice(0, TASK_MAX) + `\n… (cortado; el resto está en ${r.source_file}, línea ${r.source_line})`
}

export { taskKeyFor }
