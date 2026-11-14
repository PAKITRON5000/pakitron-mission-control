// The health of a project in one line (EV47), for «Tus proyectos» in Inicio: do its checks pass, when was the last commit,
// is there work left unsaved with nobody on it, how many tasks are left and who is working there. Everything comes from
// what the app already reads (copies, verifications, tasks, sessions); nothing is run for it. No node imports.

export interface HealthInput {
  copies: { label: string; dirty: number; untracked: number; headAt?: number; error?: string }[]
  check?: { outcome: string; at: number; summary: string }
  checksDeclared: boolean
  counts: { pendiente: number; enCurso: number; revision: number; esperan: number }
  working: string[]
  now: number
  /** Images and videos the gallery knows of, in bytes (EV48). */
  mediaBytes?: number
  /** Lines of the project's CLAUDE.md (EV91): every session reads it whole when it starts. */
  claudeMdLines?: number
  /** EV91: pairs of orders in its CLAUDE.md that say always and never of the same thing (core/mdclash.ts). */
  claudeMdClashes?: [string, string][]
  /** EV94: what each account left unsaved (leftUnsaved). */
  unsaved?: LeftUnsaved[]
}

/**
 * EV91 (research, improvement 12): past this, a CLAUDE.md costs context in every session and is followed worse; the
 * specific parts belong in skills or in Memoria.
 */
export const CLAUDE_MD_MAX_LINES = 200

export const gigas = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)

export interface HealthLine { level: 'bien' | 'aviso' | 'mal'; parts: string[] }

const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  return m < 60 ? `hace ${Math.max(1, m)} min` : m < 48 * 60 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`
}

/** Unsaved changes this old, with nobody working there, are work someone may lose or redo. */
export const STALE_DIRTY_MS = 6 * 3600_000

/** EV94: an account's own unsaved files are said this soon after its last write, if nobody works there. */
export const LEFT_UNSAVED_MS = 30 * 60_000

export interface LeftUnsaved { account: string; copy: string; files: string[]; lastAt: number }

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * EV94 (research D4-D7: «que quien siga no herede un árbol a medias sin saberlo»): the files each account wrote after
 * the copy's last commit that `git status` still lists, once nobody works in the project and its last write is older
 * than LEFT_UNSAVED_MS. Only files a Claude wrote count, never what tools generate (Unity leaves plenty: 13-11), so it
 * can be said in half an hour instead of six.
 */
export function leftUnsaved(i: { copies: { label: string; path: string; headAt?: number; changed?: string[] }[]; writes: { account: string; file: string; at: number }[]; working: string[]; now: number }): LeftUnsaved[] {
  if (i.working.length) return []
  const out = new Map<string, LeftUnsaved>()
  for (const c of i.copies) {
    if (!c.changed?.length) continue
    const root = norm(c.path)
    const exact = new Set(c.changed.filter((x) => !x.endsWith('/')).map((x) => `${root}/${norm(x)}`))
    const dirs = c.changed.filter((x) => x.endsWith('/')).map((x) => `${root}/${norm(x)}/`)
    for (const w of i.writes) {
      if (c.headAt && w.at <= c.headAt) continue
      const f = norm(w.file)
      if (!f.startsWith(root + '/')) continue
      if (!exact.has(f) && !dirs.some((d) => f.startsWith(d))) continue
      const key = `${w.account}|${c.label}`
      const e = out.get(key) ?? { account: w.account, copy: c.label, files: [], lastAt: 0 }
      const rel = w.file.replace(/\\/g, '/').slice(root.length + 1)
      if (!e.files.includes(rel)) e.files.push(rel)
      e.lastAt = Math.max(e.lastAt, w.at)
      out.set(key, e)
    }
  }
  return [...out.values()].filter((e) => i.now - e.lastAt > LEFT_UNSAVED_MS)
}

export function projectHealth(i: HealthInput): HealthLine {
  const parts: string[] = []
  let level: HealthLine['level'] = 'bien'
  const worse = (l: HealthLine['level']) => { if (l === 'mal' || (l === 'aviso' && level === 'bien')) level = l }

  if (i.check && i.check.outcome !== 'bien') { worse('mal'); parts.push(`fallan las comprobaciones (${ago(i.check.at, i.now)}): ${i.check.summary.slice(0, 80)}`) }
  else if (i.check) parts.push(`comprobaciones en verde (${ago(i.check.at, i.now)})`)
  else if (i.checksDeclared) parts.push('sin comprobar todavía')
  else { worse('aviso'); parts.push('sin comprobaciones: «Prepararlo» en Ajustes › Proyecto las propone') }

  for (const c of i.copies.filter((x) => x.error)) { worse('mal'); parts.push(`no se puede leer la copia ${c.label}`) }
  const last = Math.max(0, ...i.copies.map((c) => c.headAt ?? 0))
  if (last) parts.push(`último commit ${ago(last, i.now)}`)
  for (const c of i.copies) {
    const n = c.dirty + c.untracked
    if (!n) continue
    const stale = !i.working.length && c.headAt !== undefined && i.now - c.headAt > STALE_DIRTY_MS
    if (stale) worse('aviso')
    parts.push(`${n} archivo${n === 1 ? '' : 's'} sin guardar en ${c.label}${stale ? ` y nadie trabajando (desde el commit de ${ago(c.headAt!, i.now)})` : ''}`)
  }

  for (const u of i.unsaved ?? []) {
    worse('aviso')
    const names = u.files.slice(0, 3).map((f) => f.split('/').pop()).join(', ')
    parts.unshift(`Claude ${u.account.slice(6)} dejó ${u.files.length === 1 ? '1 archivo suyo' : `${u.files.length} archivos suyos`} sin guardar en ${u.copy} (lo último ${ago(u.lastAt, i.now)}): ${names}${u.files.length > 3 ? '…' : ''}; quien siga, que lo revise y lo guarde con pmc guarda`)
  }

  const k = i.counts
  const tasks = [k.pendiente && `${k.pendiente} pendiente${k.pendiente === 1 ? '' : 's'}`, k.enCurso && `${k.enCurso} a medias`, k.revision && `${k.revision} para revisar`, k.esperan && `${k.esperan} esperan a otras`].filter(Boolean)
  parts.push(tasks.length ? tasks.join(' · ') : 'sin tareas abiertas')
  if (i.mediaBytes && i.mediaBytes >= 50e6) parts.push(`${gigas(i.mediaBytes)} en imágenes y vídeos`)
  if (i.claudeMdClashes?.length) { worse('aviso'); parts.push(`CLAUDE.md con ${i.claudeMdClashes.length === 1 ? 'dos órdenes que se contradicen' : i.claudeMdClashes.length + ' pares de órdenes que se contradicen'} («${i.claudeMdClashes[0][0].slice(0, 60)}» frente a «${i.claudeMdClashes[0][1].slice(0, 60)}»): pide a un Claude que lo aclare`) }
  if (i.claudeMdLines && i.claudeMdLines > CLAUDE_MD_MAX_LINES) { worse('aviso'); parts.push(`CLAUDE.md de ${i.claudeMdLines} líneas: cada sesión lo lee entero; conviene pasar lo específico a skills o a Memoria`) }
  parts.push(i.working.length ? `trabajando: ${i.working.map((a) => `Claude ${a.slice(6)}`).join(', ')}` : 'nadie trabajando')
  return { level, parts }
}
