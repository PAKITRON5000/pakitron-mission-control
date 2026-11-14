// What the gallery shows. By default a file counts once, however many copies of the project hold it (the same name and
// size is the same file): the count on screen is what the user can actually scroll through. All numbers come from here.
import type { Asset } from './types'
import type { DB } from './db'
import { prettyFolder, SOURCES } from './media'

export type GalleryOrder = 'fecha' | 'carpeta' | 'nombre'

export interface AssetQuery {
  projectId: string
  kind?: string
  category?: string
  source?: string
  /** A folder and everything inside it. */
  folder?: string
  text?: string
  from?: number
  to?: number
  status?: string
  /** false: every copy of a file is listed. */
  unique?: boolean
  order?: GalleryOrder
  offset?: number
  limit?: number
}

function whereOf(q: AssetQuery, skip: (keyof AssetQuery)[] = []): { where: string; args: any[] } {
  // A file that is gone still shows while it has a note with a kept copy.
  const where = ['a.project_id = ?', "(a.gone = 0 OR EXISTS (SELECT 1 FROM comments k WHERE k.asset_id = a.id AND k.kept_path IS NOT NULL AND k.status != 'aprobado'))"]
  const args: any[] = [q.projectId]
  const use = (k: keyof AssetQuery) => q[k] != null && q[k] !== '' && !skip.includes(k)
  if (use('kind')) { where.push('a.kind = ?'); args.push(q.kind) }
  if (use('category')) { where.push('a.category = ?'); args.push(q.category) }
  if (use('source')) { where.push('a.source = ?'); args.push(q.source) }
  if (use('folder')) { where.push('(a.folder = ? OR substr(a.folder, 1, ?) = ?)'); args.push(q.folder, q.folder!.length + 1, q.folder + '/') }
  if (use('text')) {
    // Every word has to appear somewhere in the name or the place: «racha aguila» finds racha_a_aguila.mp4.
    for (const w of q.text!.trim().split(/\s+/).slice(0, 6)) { where.push('(a.rel LIKE ? OR a.name LIKE ?)'); args.push(`%${w}%`, `%${w}%`) }
  }
  if (use('from')) { where.push('a.mtime >= ?'); args.push(q.from) }
  if (use('to')) { where.push('a.mtime <= ?'); args.push(q.to) }
  if (q.status === 'comentados') where.push("EXISTS (SELECT 1 FROM comments c JOIN assets b ON b.id = c.asset_id WHERE b.project_id = a.project_id AND b.name = a.name AND b.size = a.size AND c.status NOT IN ('aprobado'))")
  if (q.status === 'duplicados') where.push('(SELECT COUNT(*) FROM assets b WHERE b.project_id = a.project_id AND b.name = a.name AND b.size = a.size AND b.gone = 0) > 1')
  return { where: where.join(' AND '), args }
}

const GROUP = 'GROUP BY a.name COLLATE NOCASE, a.size'

function toAsset(r: any, notes: Map<string, number>): Asset & { copies: number; folder: string; source: string } {
  return {
    id: r.id, projectId: r.project_id, path: r.path, rel: r.rel, name: r.name, kind: r.kind, category: r.category, size: r.size, mtime: r.mtime,
    firstSeen: r.first_seen, hash: r.hash ?? undefined, width: r.width ?? undefined, height: r.height ?? undefined, account: r.account ?? undefined,
    taskExtId: r.task_ext_id ?? undefined, status: r.status, openComments: notes.get(`${r.name.toLowerCase()}|${r.size}`) ?? 0,
    copies: r.copies ?? 1, folder: r.folder ?? '', source: r.source ?? 'otros'
  }
}

export function queryAssets(db: DB, q: AssetQuery): { total: number; items: ReturnType<typeof toAsset>[]; groups: Record<string, number> } {
  const { where, args } = whereOf(q)
  const unique = q.unique !== false
  const order = q.order ?? 'fecha'
  const sort = order === 'carpeta' ? 'a.folder COLLATE NOCASE, a.mtime DESC, a.id DESC' : order === 'nombre' ? 'a.name COLLATE NOCASE, a.id DESC' : 'a.mtime DESC, a.id DESC'
  const sql = unique
    ? `SELECT a.*, MAX(a.mtime) AS newest, COUNT(*) AS copies FROM assets a WHERE ${where} ${GROUP} ORDER BY ${sort} LIMIT ? OFFSET ?`
    : `SELECT a.*, 1 AS copies FROM assets a WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`
  const rows = db.prepare(sql).all(...args, q.limit ?? 120, q.offset ?? 0) as any[]
  const inner = unique ? `SELECT a.folder AS folder, MAX(a.mtime) AS mtime FROM assets a WHERE ${where} ${GROUP}` : `SELECT a.folder AS folder, a.mtime AS mtime FROM assets a WHERE ${where}`
  // How many there really are in each day or folder, not how many happen to be loaded.
  const groups: Record<string, number> = {}
  let total = 0
  const key = order === 'carpeta' ? 'folder' : "date(mtime / 1000, 'unixepoch', 'localtime')"
  for (const r of db.prepare(`SELECT ${key} AS k, COUNT(*) AS n FROM (${inner}) GROUP BY k`).all(...args) as any[]) {
    groups[r.k ?? ''] = r.n
    total += r.n
  }
  const notes = new Map<string, number>()
  for (const r of db.prepare("SELECT b.name AS name, b.size AS size, COUNT(*) AS n FROM comments c JOIN assets b ON b.id = c.asset_id WHERE b.project_id = ? AND c.status NOT IN ('aprobado') GROUP BY b.name, b.size").all(q.projectId) as any[]) {
    notes.set(`${r.name.toLowerCase()}|${r.size}`, r.n)
  }
  return { total, items: rows.map((r) => toAsset(r, notes)), groups }
}

export interface Facets {
  total: number
  copies: number
  kinds: { kind: string; n: number }[]
  categories: { category: string; n: number }[]
  sources: { source: string; label: string; hint: string; n: number }[]
}

/** The counts next to each filter: each one counts with the other filters on, and once per file. */
export function assetFacets(db: DB, q: AssetQuery): Facets {
  const count = (dim: 'kind' | 'category' | 'source', skip: keyof AssetQuery) => {
    const { where, args } = whereOf(q, [skip, 'offset', 'limit'])
    return db.prepare(`SELECT ${dim} AS v, COUNT(*) AS n FROM (SELECT a.kind AS kind, a.category AS category, a.source AS source FROM assets a WHERE ${where} ${GROUP}) GROUP BY v ORDER BY n DESC`).all(...args) as { v: string; n: number }[]
  }
  const { where, args } = whereOf(q)
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM assets a WHERE ${where} ${GROUP})`).get(...args) as { n: number }).n
  const all = (db.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${where}`).get(...args) as { n: number }).n
  const src = new Map(count('source', 'source').map((r) => [r.v, r.n]))
  return {
    total,
    copies: all - total,
    kinds: count('kind', 'kind').map((r) => ({ kind: r.v, n: r.n })),
    categories: count('category', 'category').map((r) => ({ category: r.v, n: r.n })),
    sources: SOURCES.filter((s) => src.get(s.id)).map((s) => ({ source: s.id, label: s.label, hint: s.hint, n: src.get(s.id)! }))
  }
}

export interface Album {
  path: string
  name: string
  /** The folders on the way, for albums pulled up from deep inside. */
  parent?: string
  n: number
  kinds: Record<string, number>
  covers: number[]
  at: number
}

interface Node { path: string; n: number; kinds: Record<string, number>; at: number; covers: { id: number; at: number }[]; children: Map<string, Node>; own: number }

const newNode = (path: string): Node => ({ path, n: 0, kinds: {}, at: 0, covers: [], children: new Map(), own: 0 })

function treeOf(db: DB, q: AssetQuery): Node {
  const { where, args } = whereOf(q, ['folder'])
  const rows = db.prepare(`SELECT a.id AS id, a.folder AS folder, a.kind AS kind, MAX(a.mtime) AS at FROM assets a WHERE ${where} ${GROUP}`).all(...args) as { id: number; folder: string | null; kind: string; at: number }[]
  const root = newNode('')
  for (const r of rows) {
    const parts = (r.folder ?? '').split('/').filter(Boolean)
    let node = root
    const visit = (x: Node) => {
      x.n++
      x.kinds[r.kind] = (x.kinds[r.kind] ?? 0) + 1
      x.at = Math.max(x.at, r.at)
      if (r.kind === 'image' || r.kind === 'video' || r.kind === 'model') {
        x.covers.push({ id: r.id, at: r.at })
        if (x.covers.length > 24) {
          x.covers.sort((a, b) => b.at - a.at)
          x.covers.length = 8
        }
      }
    }
    visit(node)
    for (const p of parts) {
      let next = node.children.get(p)
      if (!next) {
        next = newNode(node.path ? `${node.path}/${p}` : p)
        node.children.set(p, next)
      }
      node = next
      visit(node)
    }
    node.own++
  }
  return root
}

function find(root: Node, path: string): Node | undefined {
  let n: Node | undefined = root
  for (const p of path.split('/').filter(Boolean)) n = n?.children.get(p)
  return n
}

function toAlbum(n: Node, base: string): Album {
  const rest = n.path.slice(base ? base.length + 1 : 0).split('/').filter(Boolean)
  const name = prettyFolder(rest[rest.length - 1] ?? n.path)
  return {
    path: n.path,
    name,
    parent: rest.length > 1 ? rest.slice(0, -1).map(prettyFolder).join(' › ') : undefined,
    n: n.n,
    kinds: n.kinds,
    covers: [...n.covers].sort((a, b) => b.at - a.at).slice(0, 4).map((c) => c.id),
    at: n.at
  }
}

/**
 * The albums inside a folder: a folder holding most of the files is opened up, so «Assets › _Game › Art» does not
 * hide what is in it (Tutoriales, HUD…) behind three clicks.
 */
function albumsOf(node: Node): Album[] {
  const out: Node[] = []
  const open = (x: Node) => {
    for (const c of x.children.values()) {
      if (c.children.size > 0 && c.own === 0 && c.n > node.n * 0.5) open(c)
      else if (c.children.size === 1 && c.own === 0) open(c)
      else out.push(c)
    }
  }
  open(node)
  return out.map((c) => toAlbum(c, node.path)).sort((a, b) => b.at - a.at)
}

export interface FolderView {
  path: string
  crumbs: { path: string; name: string }[]
  albums: Album[]
  /** Files right in this folder, not in an album under it. */
  own: number
}

export function assetFolder(db: DB, q: AssetQuery): FolderView {
  const root = treeOf(db, q)
  const path = q.folder ?? ''
  const node = path ? find(root, path) : root
  const parts = path.split('/').filter(Boolean)
  const crumbs = parts.map((p, i) => ({ path: parts.slice(0, i + 1).join('/'), name: prettyFolder(p) }))
  return { path, crumbs, albums: node ? albumsOf(node) : [], own: node?.own ?? 0 }
}

/** The gallery's first screen: where everything comes from, each with its albums. */
export function galleryHome(db: DB, q: AssetQuery): { source: string; label: string; hint: string; n: number; albums: Album[]; more: number }[] {
  const out: { source: string; label: string; hint: string; n: number; albums: Album[]; more: number }[] = []
  for (const s of SOURCES) {
    const root = treeOf(db, { ...q, source: s.id })
    if (!root.n) continue
    const albums = albumsOf(root)
    out.push({ source: s.id, label: s.label, hint: s.hint, n: root.n, albums: albums.slice(0, 12), more: Math.max(0, albums.length - 12) })
  }
  return out
}
