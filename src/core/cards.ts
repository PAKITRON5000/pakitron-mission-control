// A task explained for the user: what it is in one plain sentence, what to look at, and everything that lets him see or
// hear it. A Claude writes the card when it finishes (`pmc entrega`); for tasks without a card, the sentence and the media
// are worked out from what already exists (the task's text, the decisions about it, the files it names).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AccountId, DecisionMedia } from './types'
import { paths } from './paths'
import type { DB } from './db'
import { mediaKind } from './decisions'

export const cardsDir = () => join(paths.root(), 'entregas')

export interface TaskCard {
  projectId: string
  extId: string
  simple?: string
  ask?: string
  media: DecisionMedia[]
  account?: AccountId
  updatedAt: number
}

export function getTaskCard(db: DB, projectId: string, extId: string): TaskCard | undefined {
  const r = db.prepare('SELECT * FROM task_cards WHERE project_id = ? AND ext_id = ?').get(projectId, extId) as any
  if (!r) return undefined
  let media: DecisionMedia[] = []
  try { media = JSON.parse(r.media) } catch { /* empty */ }
  return { projectId, extId, simple: r.simple ?? undefined, ask: r.ask ?? undefined, media, account: r.account ?? undefined, updatedAt: r.updated_at }
}

const LIMIT = 300 << 20

/** Writes the card. What is not given stays as it was; the files are copied, so a later capture cannot change what he sees. */
export function setTaskCard(db: DB, c: { projectId: string; extId: string; simple?: string; ask?: string; files?: { path: string; caption?: string; group?: string }[]; account?: AccountId }, now = Date.now()): TaskCard {
  const prev = getTaskCard(db, c.projectId, c.extId)
  let media = prev?.media ?? []
  if (c.files?.length) {
    mkdirSync(cardsDir(), { recursive: true })
    media = []
    c.files.forEach((f, n) => {
      try {
        if (!existsSync(f.path) || statSync(f.path).size > LIMIT) return
        const safe = c.extId.replace(/[^\w-]/g, '_')
        const target = join(cardsDir(), `${safe}-${n}-${now.toString(36)}${extname(f.path).toLowerCase()}`)
        copyFileSync(f.path, target)
        media.push({ path: target, source: f.path, caption: f.caption ?? basename(f.path, extname(f.path)), group: f.group, kind: mediaKind(f.path) })
      } catch { /* unreadable: left out */ }
    })
  }
  db.prepare(
    `INSERT INTO task_cards(project_id, ext_id, simple, ask, media, account, updated_at) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(project_id, ext_id) DO UPDATE SET simple = excluded.simple, ask = excluded.ask, media = excluded.media, account = excluded.account, updated_at = excluded.updated_at`
  ).run(c.projectId, c.extId, c.simple ?? prev?.simple ?? null, c.ask ?? prev?.ask ?? null, JSON.stringify(media), c.account ?? prev?.account ?? null, now)
  return getTaskCard(db, c.projectId, c.extId)!
}

export function cardFile(db: DB, projectId: string, extId: string, n: number): string | undefined {
  const p = getTaskCard(db, projectId, extId)?.media[n]?.path
  return p && p.toLowerCase().startsWith(cardsDir().toLowerCase()) && existsSync(p) ? p : undefined
}

/** The task's first plain sentence: without Markdown, paths, code, or the notes about who did it and when. */
export function simpleText(title: string, detail: string): string {
  const clean = (s: string) =>
    s
      .replace(/`[^`]*`/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/[A-Za-z]:\\[^\s,;)]+/g, '')
      .replace(/(?:Logs|docs|Assets|ArtSource|tools)[\\/][^\s,;)]+/g, '')
      .replace(/\((?:usuario|[^()]*\d{1,2}-\d{1,2}[^()]*)\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const body = clean(detail)
  const parts = body.split(/(?<=[.!?])\s+/).filter((p) => p.length > 8 && !/^(hech[oa]|visto|commit|pruebas?|plan|ver |nota:)/i.test(p))
  let out = parts[0] ?? clean(title)
  if (out.length > 260) out = out.slice(0, 259).replace(/\s+\S*$/, '') + '…'
  return out ? out[0].toUpperCase() + out.slice(1) : out
}

export interface TaskMediaItem {
  kind: 'image' | 'video' | 'audio' | 'model'
  src: string
  thumb?: string
  caption?: string
  group?: string
  /** A file of the gallery: it opens in the viewer, with its notes. */
  assetId?: number
  from: 'entrega' | 'decision' | 'archivo'
}

const parentOf = (id: string) => id.match(/^([A-Za-z]+\d+)[a-z]$/)?.[1]
const MEDIA_FILE = /[\w.\-/\\]+\.(?:png|jpe?g|webp|gif|mp4|webm|ogg|wav|mp3|flac|glb|fbx|blend)/gi
const FOLDER_REF = /(?:Logs|docs[\\/]research|docs[\\/]capturas|ArtSource|Assets)[\\/][^\s`"'),;:»]+/g

function folderRefs(text: string): string[] {
  return [...new Set((text.match(FOLDER_REF) ?? []).map((f) => f.replace(/\\/g, '/').replace(/[./]+$/, '')).filter((f) => !/\.\w{2,5}$/.test(f)))]
}

function assetItem(r: any): TaskMediaItem {
  return { kind: r.kind, src: `pmc://file/${r.id}`, thumb: r.kind === 'audio' ? undefined : `pmc://thumb/${r.id}?s=420`, caption: r.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), group: r.folder ?? undefined, assetId: r.id, from: 'archivo' }
}

function decisionItems(db: DB, projectId: string, ids: string[]): TaskMediaItem[] {
  const out: TaskMediaItem[] = []
  for (const id of ids) {
    for (const d of db.prepare('SELECT id, title, images FROM decisions WHERE project_id = ? AND task_ext_id = ? ORDER BY created_at DESC').all(projectId, id) as any[]) {
      let list: DecisionMedia[] = []
      try { list = JSON.parse(d.images) } catch { /* empty */ }
      list.forEach((m, n) => {
        const kind = (m.kind ?? mediaKind(m.path)) as TaskMediaItem['kind']
        if (kind === 'image' || kind === 'audio' || kind === 'video') out.push({ kind, src: `pmc://dimg/${d.id}/${n}`, thumb: kind === 'image' ? `pmc://dimg/${d.id}/${n}` : undefined, caption: m.caption, group: m.group ?? d.title, from: 'decision' })
      })
    }
  }
  return out
}

/** Everything that shows a task: its card first, then what was asked about it, then the files its text names. */
export function taskMedia(db: DB, projectId: string, t: { extId?: string; title: string; detail: string }): TaskMediaItem[] {
  const out: TaskMediaItem[] = []
  const text = `${t.title} ${t.detail}`
  if (t.extId) {
    const card = getTaskCard(db, projectId, t.extId)
    card?.media.forEach((m, n) => {
      const kind = (m.kind ?? mediaKind(m.path)) as TaskMediaItem['kind']
      const src = `pmc://card/${encodeURIComponent(projectId)}/${encodeURIComponent(t.extId!)}/${n}`
      out.push({ kind, src, thumb: kind === 'image' ? src : undefined, caption: m.caption, group: m.group, from: 'entrega' })
    })
    const parent = parentOf(t.extId)
    out.push(...decisionItems(db, projectId, parent ? [t.extId, parent] : [t.extId]))
  }
  const seen = new Set<number>()
  const add = (rows: any[]) => { for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(assetItem(r)) } }
  const names = [...new Set((text.match(MEDIA_FILE) ?? []).map((n) => n.split(/[\\/]/).pop()!.toLowerCase()))].slice(0, 12)
  const byName = db.prepare('SELECT id, name, kind, folder FROM assets WHERE project_id = ? AND gone = 0 AND lower(name) = ? ORDER BY mtime DESC LIMIT 1')
  for (const n of names) add(byName.all(projectId, n) as any[])
  const inFolder = db.prepare(`SELECT a.id AS id, a.name AS name, a.kind AS kind, a.folder AS folder, MAX(a.mtime) AS at FROM assets a WHERE a.project_id = ? AND a.gone = 0 AND (lower(a.folder) = ? OR lower(a.folder) LIKE ?)
    GROUP BY a.name COLLATE NOCASE, a.size ORDER BY at DESC LIMIT 6`)
  const folders = folderRefs(text)
  if (t.extId) {
    const id = t.extId.toLowerCase()
    const parent = parentOf(t.extId)?.toLowerCase()
    for (const x of parent ? [id, parent] : [id]) folders.push(`logs/${x}`, `docs/research/${x}`)
  }
  for (const f of folders.slice(0, 6)) add(inFolder.all(projectId, f.toLowerCase(), `${f.toLowerCase()}/%`) as any[])
  return out.slice(0, 24)
}

/** One picture per task for the board, all at once and without opening a thing. */
export function taskCovers(db: DB, projectId: string): Record<number, { thumb?: string; audio?: boolean; video?: boolean; card?: boolean }> {
  const out: Record<number, { thumb?: string; audio?: boolean; video?: boolean; card?: boolean }> = {}
  const decisions = new Map<string, { thumb?: string; audio: boolean; video: boolean }>()
  for (const d of db.prepare("SELECT id, task_ext_id AS ext, images FROM decisions WHERE project_id = ? AND task_ext_id IS NOT NULL ORDER BY created_at").all(projectId) as any[]) {
    let list: DecisionMedia[] = []
    try { list = JSON.parse(d.images) } catch { /* empty */ }
    const pic = list.findIndex((m) => (m.kind ?? mediaKind(m.path)) === 'image')
    decisions.set(d.ext, { thumb: pic >= 0 ? `pmc://dimg/${d.id}/${pic}` : decisions.get(d.ext)?.thumb, audio: list.some((m) => m.kind === 'audio'), video: list.some((m) => m.kind === 'video') })
  }
  const cards = new Map<string, TaskCard>()
  for (const r of db.prepare('SELECT ext_id FROM task_cards WHERE project_id = ?').all(projectId) as any[]) {
    const c = getTaskCard(db, projectId, r.ext_id)
    if (c) cards.set(r.ext_id, c)
  }
  const names = new Map<string, number>()
  const newestInFolder = new Map<string, number>()
  for (const r of db.prepare("SELECT id, name, folder FROM assets WHERE project_id = ? AND gone = 0 AND kind = 'image' ORDER BY mtime").all(projectId) as any[]) {
    names.set(r.name.toLowerCase(), r.id)
    if (r.folder) newestInFolder.set(r.folder.toLowerCase(), r.id)
  }
  const tasks = db.prepare('SELECT id, ext_id, title, detail FROM tasks WHERE project_id = ? AND gone = 0').all(projectId) as any[]
  for (const t of tasks) {
    const ext: string | undefined = t.ext_id ?? undefined
    const card = ext ? cards.get(ext) : undefined
    const dec = ext ? decisions.get(ext) ?? (parentOf(ext) ? decisions.get(parentOf(ext)!) : undefined) : undefined
    const item: { thumb?: string; audio?: boolean; video?: boolean; card?: boolean } = {}
    if (card) {
      item.card = true
      const pic = card.media.findIndex((m) => (m.kind ?? mediaKind(m.path)) === 'image')
      if (pic >= 0) item.thumb = `pmc://card/${encodeURIComponent(projectId)}/${encodeURIComponent(ext!)}/${pic}`
      if (card.media.some((m) => m.kind === 'audio')) item.audio = true
      if (card.media.some((m) => m.kind === 'video')) item.video = true
    }
    if (dec && !card?.simple) {
      item.thumb ??= dec.thumb
      item.audio ||= dec.audio
      item.video ||= dec.video
    }
    if (!item.thumb && !card?.simple) {
      const text = `${t.title} ${t.detail}`
      for (const n of text.match(MEDIA_FILE) ?? []) {
        const id = names.get(n.split(/[\\/]/).pop()!.toLowerCase())
        if (id) { item.thumb = `pmc://thumb/${id}?s=320`; break }
      }
      if (!item.thumb) {
        const folders = folderRefs(text).map((f) => f.toLowerCase())
        if (ext) folders.push(`logs/${ext.toLowerCase()}`, `docs/research/${ext.toLowerCase()}`)
        const parent = ext ? parentOf(ext)?.toLowerCase() : undefined
        if (parent) folders.push(`logs/${parent}`, `docs/research/${parent}`)
        for (const f of folders) {
          const id = newestInFolder.get(f)
          if (id) { item.thumb = `pmc://thumb/${id}?s=320`; break }
        }
      }
    }
    if (item.thumb || item.audio || item.video || item.card) out[t.id] = item
  }
  return out
}
