// `pmc guarda "qué queda"` (EV41): one order to leave everything ready before the limit cuts a session. Before, the 95 %
// notice asked for three things (commit, heartbeat, reservations) and a session near its end often did one or none. This
// writes the heartbeat in docs/RELEVO.md, commits what the account wrote, and keeps its reservations alive for whoever
// takes over. Pure parts here; git and the database in cli/pmc.ts.

import { ANY_HEARTBEAT, HEARTBEAT, IN_PROGRESS, PREVIOUS_HEARTBEAT, boldStart, docWords } from './docwords'

const pad = (n: number) => String(n).padStart(2, '0')

export function heartbeatLine(at: Date, account: string, text: string, t: HandoffTemplate = {}): string {
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const flat = (s: string) => s.replace(/\s*\r?\n\s*/g, ' ').trim()
  const parts = [flat(text)]
  if (t.branch || t.commit) parts.push(`Rama ${t.branch ?? '?'}${t.commit ? `, último commit ${t.commit}` : ''}.`)
  if (t.tested) parts.push(`Probado: ${flat(t.tested)}.`)
  if (t.next) parts.push(`Siguiente: ${flat(t.next)}.`)
  if (t.dontRedo) parts.push(`No rehacer: ${flat(t.dontRedo)}.`)
  return `**${docWords().heartbeat}:** ${when} · ${account} · ${parts.join(' ').replace(/\.\./g, '.')}`
}

/**
 * The fixed parts of a handoff (EV77; research, improvement 4: the one who takes over guesses less with the same five
 * things every time): branch and last commit (filled in by `pmc guarda`), what was tested and how, the next step, and what
 * must not be done again.
 */
export interface HandoffTemplate { branch?: string; commit?: string; tested?: string; next?: string; dontRedo?: string }

/** `pmc guarda` arguments: the free text and the template's flags (`--probado`, `--siguiente`, `--no-rehacer`). */
export function parseGuarda(args: string[]): { text: string; tested?: string; next?: string; dontRedo?: string; noCommit: boolean } {
  const out: { text: string; tested?: string; next?: string; dontRedo?: string; noCommit: boolean } = { text: '', noCommit: false }
  const free: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--sin-commit') out.noCommit = true
    else if (a === '--probado' || a === '--siguiente' || a === '--no-rehacer') {
      const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : ''
      if (a === '--probado') out.tested = v
      else if (a === '--siguiente') out.next = v
      else out.dontRedo = v
    } else if (!a.startsWith('--')) free.push(a)
  }
  out.text = free.join(' ').trim()
  return out
}

/**
 * RELEVO.md with a new «Último latido». The one it replaces stays right below as «Latido anterior» (replacing an older
 * «Latido anterior» there), so the note keeps one step of history without growing. With no heartbeat yet, it goes after
 * the «En curso» paragraph, or under the title.
 */
export function withHeartbeat(markdown: string, line: string): string {
  const nl = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  const i = lines.findIndex((l) => boldStart(HEARTBEAT + ':?\\*\\*').test(l))
  if (i >= 0) {
    const previous = lines[i].replace(boldStart(HEARTBEAT + ':?\\*\\*:?'), `**${docWords().previous}:**`)
    // An older «Latido anterior» right below (maybe after one blank line) is replaced, not piled up.
    let j = i + 1
    if (lines[j] === '' && boldStart(PREVIOUS_HEARTBEAT).test(lines[j + 1] ?? '')) j++
    const drop = boldStart(PREVIOUS_HEARTBEAT).test(lines[j] ?? '') ? 1 : 0
    const gap = drop && j > i + 1 ? 1 : 0
    lines.splice(i, 1 + gap + drop, line, '', previous)
    return lines.join(nl)
  }
  const ec = lines.findIndex((l) => boldStart(IN_PROGRESS).test(l))
  let at = ec
  if (at >= 0) { while (at + 1 < lines.length && lines[at + 1].trim() !== '') at++ }
  else at = Math.max(0, lines.findIndex((l) => /^# /.test(l)))
  lines.splice(at + 1, 0, '', line)
  return lines.join(nl)
}

// ---- «En curso» that has gone stale (14-11) ------------------------------------------------------------------------
// pmc guarda writes «Último latido» by itself, but «En curso» is written by hand and is what the next account reads
// first: claude1 left it saying EV141 for an hour while closing EV141, EV146 and EV147.

export interface EnCursoMark { hash: string; since: number; saves: number }

const STALE_SAVES = 3
const STALE_MS = 90 * 60_000

/** The «En curso» line of a RELEVO.md (its first line), if any. */
export function enCursoLine(markdown: string): string | undefined {
  return markdown.split(/\r?\n/).find((l) => boldStart(IN_PROGRESS).test(l))
}

/** A reminder when «En curso» is another account's, or has not changed in STALE_SAVES saves or STALE_MS; and the new mark. */
export function staleEnCurso(line: string | undefined, account: string, prev: EnCursoMark | undefined, now: number): { reminder?: string; mark?: EnCursoMark } {
  if (!line) return {}
  let h = 0
  for (let i = 0; i < line.length; i++) h = (h * 31 + line.charCodeAt(i)) | 0
  const hash = String(h)
  const head = line.match(boldStart(IN_PROGRESS + '\\s*\\(([^)]*)\\)'))?.[1] ?? ''
  // «(claudeN, desde las…)»: whose it is goes first («siguiendo a claude1» later in it is not claude1's).
  if (/^claude\d/i.test(head.trim()) && !head.trim().toLowerCase().startsWith(account.toLowerCase())) return { reminder: `«En curso» de docs/RELEVO.md es de otra cuenta (${head.slice(0, 60)}): pon la tuya, con lo que haces y lo que queda, para quien te siga.`, mark: { hash, since: now, saves: 1 } }
  if (!prev || prev.hash !== hash) return { mark: { hash, since: now, saves: 1 } }
  const mark = { ...prev, saves: prev.saves + 1 }
  if (mark.saves >= STALE_SAVES || now - prev.since >= STALE_MS) {
    const hh = new Date(prev.since).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    return { reminder: `«En curso» de docs/RELEVO.md no ha cambiado desde las ${hh} (${mark.saves} guardados): si ya no es lo que haces, ponlo al día; es lo primero que lee quien te siga.`, mark }
  }
  return { mark }
}

// ---- a RELEVO.md that does not grow (EV40) ------------------------------------------------------------------------
// The science project's reached 67 KB (12-11): every session that read it paid ~17k tokens for history. Past a size,
// what is history moves to docs/archivo/: dated hand-off sections («## 9-11-2026, 15:27: claude4…»), «Historial…» and
// «…anteriores» sections, and heartbeat paragraphs older than two days. Everything else (what the user wants, how work
// is done here, open problems, «En curso») stays.

export const RELEVO_MAX_BYTES = 16 * 1024
const KEEP_MS = 2 * 86400_000
const HEAD_KEEP_MS = 86400_000

/** The date a heading or a heartbeat line starts with: «9-11-2026, 15:27», «2026-11-12 10:05». */
export function leadingDate(text: string): number | undefined {
  let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2}))?/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)).getTime()
  m = text.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)).getTime()
  return undefined
}

export function archiveRelevo(markdown: string, now: number, archiveName: string): { keep: string; archived: string } | undefined {
  if (Buffer.byteLength(markdown, 'utf8') <= RELEVO_MAX_BYTES) return undefined
  const nl = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  // Sections by «## » heading; the part before the first one is the head.
  const blocks: { head?: string; lines: string[] }[] = [{ lines: [] }]
  for (const l of lines) {
    if (/^## /.test(l)) blocks.push({ head: l, lines: [l] })
    else blocks[blocks.length - 1].lines.push(l)
  }
  const keep: string[] = [], out: string[] = []
  for (const b of blocks) {
    if (b.head) {
      const title = b.head.slice(3).trim()
      const d = /^\d/.test(title) ? leadingDate(title) : undefined
      const history = /historial|anteriores|antiguo/i.test(title) || (d !== undefined && now - d > KEEP_MS)
      ;(history ? out : keep).push(...b.lines)
      continue
    }
    // The head: the heartbeats of the last day and always the three newest stay; older ones go. The rest stays as it is.
    const paras: string[][] = [[]]
    for (const l of b.lines) { if (l.trim() === '') paras.push([l]); else paras[paras.length - 1].push(l) }
    const dateOf = (p: string[]) => { const first = p.find((l) => l.trim() !== '') ?? ''; return boldStart(ANY_HEARTBEAT).test(first) ? leadingDate(first) : undefined }
    const beats = paras.map((p, i) => ({ i, d: dateOf(p) })).filter((x): x is { i: number; d: number } => x.d !== undefined).sort((x, y) => y.d - x.d)
    const stay = new Set(beats.filter((x, n) => n < 3 || now - x.d <= HEAD_KEEP_MS).map((x) => x.i))
    paras.forEach((p, i) => (dateOf(p) !== undefined && !stay.has(i) ? out : keep).push(...p))
  }
  if (!out.some((l) => l.trim())) return undefined
  // Where the rest went, under «## Dónde está lo de antes» (created when missing).
  const pointer = `- \`docs/archivo/${archiveName}\`: historial de relevos y latidos de más de dos días, sacados de aquí al pasar de ${Math.round(RELEVO_MAX_BYTES / 1024)} KB.`
  const at = keep.findIndex((l) => /^## Dónde está lo de antes/i.test(l))
  if (at >= 0) { if (!keep.includes(pointer)) keep.splice(keep[at + 1]?.trim() === '' ? at + 2 : at + 1, 0, pointer) }
  else keep.push('', '## Dónde está lo de antes', '', pointer)
  const tidy = (ls: string[]) => ls.join(nl).replace(/(\r?\n){3,}/g, nl + nl).trim() + nl
  return { keep: tidy(keep), archived: tidy(out) }
}

/** `git status --porcelain=v1 -z` → the changed paths (a rename gives its new name). */
export function porcelainPaths(z: string): string[] {
  const parts = z.split('\0')
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    out.push(p.slice(3))
    if (p[0] === 'R' || p[0] === 'C') i++ // the original name follows
  }
  return out
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * Which changed files go into the account's commit. `mine` and `others` are the files each wrote through Claude (the app
 * records every write). When no other account wrote in this copy lately, everything changed is the account's (or the
 * user's): files changed by commands (a build, a script that renders) never show as writes. When another one did, only
 * what this account wrote goes in, and the rest is listed for it to look at.
 */
/**
 * Hours of today that have not come yet, in the lines a diff adds (EV113, weak point «inventa horas»: 13-11 twice, once
 * at 04:20 and again at 13:03, a Claude wrote times 10-20 minutes ahead in TASKS and ESTADO). Dates as «13-11 12:44» or
 * «(13-11, 12:44»; a little slack for the clock. Returns the pieces found, to be shown.
 */
export function futureHours(diff: string, now = Date.now()): string[] {
  const d = new Date(now)
  const today = `${d.getDate()}-${d.getMonth() + 1}`
  const nowMin = d.getHours() * 60 + d.getMinutes()
  const out: string[] = []
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const m of line.matchAll(/\b(\d{1,2})-(\d{1,2}),?\s+(?:a las\s+)?(\d{1,2}):(\d{2})\b/g)) {
      if (`${Number(m[1])}-${Number(m[2])}` !== today) continue
      // A time that is meant to come («vuelve el 14-11 a las 01:10», «hasta el…», «por defecto a las…»): not a slip (14-11).
      const before = line.slice(Math.max(0, (m.index ?? 0) - 40), m.index).toLowerCase()
      if (/(vuelve|volverá|vuelven|hasta|a partir|por defecto|se tomará|caduca|reinicio|se renueva|resets?)\s+(?:el\s+|la\s+|a las\s+)?$/.test(before)) continue
      if (Number(m[3]) * 60 + Number(m[4]) > nowMin + 2) out.push(m[0])
    }
  }
  return [...new Set(out)]
}

export function pickFiles(o: { changed: string[]; mine: string[]; others: string[]; leaving?: boolean; othersLast?: number; mtime?: (p: string) => number | undefined }): { commit: string[]; left: string[] } {
  const others = o.others.map(norm)
  const hit = (set: string[], p: string) => { const n = norm(p); return set.some((w) => w === n || w.startsWith(n + '/')) }
  if (!others.length) return { commit: [...o.changed], left: [] }
  // EV143: what this session changed through an order (a version raised by a script, pmc preparar) leaves no «archivo» event:
  // a file no other account touched and that changed after their last write is this one's too (13-11: package.json was
  // left out of every checkpoint). A file another account touched still follows the rules below.
  const late = (p: string) => { const t = o.othersLast != null ? o.mtime?.(p) : undefined; return t != null && t > o.othersLast! && !hit(others, p) }
  const mine = [...o.mine.map(norm), ...o.changed.filter(late).map(norm)]
  // A file both wrote goes in: its changes cannot be split, and leaving it out would leave this account's half behind.
  // EV42: the one leaving in a wheel's overlap leaves the shared files to the one who stays (13-11: claude6's checkpoint took
  // claude3's half-done index.ts and App.tsx); the one who stays keeps them whole, with both halves, when it saves.
  // The handover itself (RELEVO and its archive) always goes: it is what the one who stays reads next.
  const handover = (p: string) => /^docs\/(relevo\.md|archivo\/)/.test(norm(p))
  const commit = o.changed.filter((p) => hit(mine, p) && !(o.leaving && hit(others, p) && !handover(p)))
  return { commit, left: o.changed.filter((p) => !commit.includes(p)) }
}
