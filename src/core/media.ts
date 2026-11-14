import { t } from './i18n'
// The gallery's index: images, videos, 3D models and audio in a project's media folders. Files are never copied or
// moved; the database keeps path, size, date and a quick fingerprint (size + first/last 64 KB) to spot duplicates.
// Each file also knows its folder without the copy it is in (the same folder in four copies is one folder for the user),
// what it is (`category`) and where it comes from (`source`).
import { createHash } from 'node:crypto'
import { openSync, readSync, closeSync, readdirSync, statSync, promises as fsp } from 'node:fs'
import { basename, extname, join, relative, sep, dirname } from 'node:path'
import type { AssetKind, ProjectConfig } from './types'
import type { DB } from './db'

const KIND: Record<string, AssetKind> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image', '.avif': 'image',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video', '.m4v': 'video', '.avi': 'video',
  '.glb': 'model', '.gltf': 'model', '.fbx': 'model', '.obj': 'model', '.blend': 'model', '.vrm': 'model',
  '.ogg': 'audio', '.wav': 'audio', '.mp3': 'audio', '.flac': 'audio'
}

export function kindOf(file: string): AssetKind | undefined {
  return KIND[extname(file).toLowerCase()]
}

export type AssetSource = 'juego' | 'arte' | 'astra' | 'pruebas' | 'docs' | 'otros'

export const SOURCES: { id: AssetSource; label: string; hint: string }[] = [
  { id: 'juego', get label() { return t('En el juego') }, get hint() { return t('Lo que el juego usa de verdad: imágenes, películas, música y modelos') } },
  { id: 'astra', get label() { return t('De Astra') }, get hint() { return t('Lo que ha dibujado Astra: fichas, referencias y piezas') } },
  { id: 'arte', get label() { return t('Arte de origen') }, get hint() { return t('Los originales de los que sale el arte del juego') } },
  { id: 'pruebas', get label() { return t('Pruebas de los Claude') }, get hint() { return t('Capturas y comprobaciones hechas mientras trabajan') } },
  { id: 'docs', get label() { return t('Documentos') }, get hint() { return t('Imágenes guardadas con las notas del proyecto') } },
  { id: 'otros', get label() { return t('Otras carpetas') }, get hint() { return t('Carpetas que has añadido tú') } }
]

/** Words of a path: "Logs/rachas_lab/heroKing.png" → logs, rachas, lab, hero, king, png. */
function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// By whole words, in order: «ui» must not catch «build» and «pig» must not catch «_Game».
const CATEGORY_RULES: [RegExp, string][] = [
  [/^(rachas?|streaks?|elementa)/, 'Rachas'],
  [/^tutorial/, 'Tutoriales'],
  [/^(music|musica|soundtrack)/, 'Música'],
  [/^(sfx|sounds?|sonidos?|voces|voices?|voz)$/, 'Sonidos y voces'],
  [/^(hero|heroes?|arquer|guerrer|cocinero|obrero|mago|brujo|alquimista|probador|personaj|cabezas?$|heads?$|manos?$|hands?$|golpes?|gestos?|ropa|cerd|piglets?|oficios?|rey$|reyes$|kings?$|caras?$|faces?$|cosmetic|coleccion|agarres?|skins?$|clothes|outfit|retrato|portrait|fidget)/, 'Personajes'],
  [/^(castill|castles?$|citadel|murall|torres?$|towers?$|rockfort|fort$|fortaleza|balcon|trono|throne|gates?$|machines?$|maquinas?$)/, 'Castillos'],
  [/^(hud\d*[a-z]?$|ui$|menus?\d*$|interfaz|icons?$|iconos?$|logos?$|botones|buttons?$|comic$|cartas?$|pantallas?$)/, 'Interfaz y menús'],
  [/^(vfx\d*$|fx$|fire|fuego|burst|efect|lava|explos|smoke|humo|particle|sling|impact)/, 'Efectos'],
  [/^(maps?$|mapas?$|escenar|terrain|terreno|campamento|camps?$|mundo|worlds?$|climes?$|themes?$|suelos?$|arbol|timber|workings|trees?$|rocks?$|rocas?$|nieve|snow|volcan|tropic|caldera|glaciar|overview|tour$|tirolina|ladder)/, 'Mapas y escenarios'],
  [/^(textur|material|emblem|art$)/, 'Arte y materiales'],
  [/^(captur|captures?$|shots?$|screens?$|screenshots?$)/, 'Capturas de partida']
]

/** What a file is, from the words of its folder and name. */
export function categoryOf(rel: string, kind: AssetKind): string {
  const words = tokens(rel)
  for (const [re, cat] of CATEGORY_RULES) if (words.some((w) => re.test(w))) return t(cat)
  if (kind === 'video') return t('Vídeos')
  if (kind === 'model') return t('Modelos 3D')
  if (kind === 'audio') return t('Sonidos y voces')
  return t('Otras imágenes')
}

const NAMES: Record<string, string> = {
  art: 'Arte', audio: 'Audio', music: 'Música', sfx: 'Efectos de sonido', sounds: 'Sonidos', voices: 'Voces', tutorials: 'Tutoriales', hud: 'HUD', icons: 'Iconos',
  icon: 'Icono', models: 'Modelos', textures: 'Texturas', materials: 'Materiales', menu: 'Menú', logs: 'Pruebas', assets: 'Juego', artsource: 'Arte de origen',
  streamingassets: 'Datos del juego', hudastra: 'Piezas del HUD de Astra', hudportraits: 'Retratos del HUD', emblems: 'Emblemas', fx: 'Efectos', generated: 'Generados',
  packcerdito: 'Pack del cerdito', capturas: 'Capturas', captures: 'Capturas de partida', galeria: 'Galería', research: 'Investigación', hero: 'Personajes (modelos)',
  salto: 'Salto visual', castillos: 'Castillos', rachas: 'Rachas', rachas_lab: 'Laboratorio de rachas', gestos: 'Gestos', golpes: 'Golpes', arquera: 'Arquera',
  coleccion: 'Colección de cosméticos', probador: 'Probador', review: 'Revisiones', verify: 'Comprobaciones', audit: 'Auditoría', before: 'Antes', after: 'Después',
  fire: 'Fuego', fireground: 'Fuego en el suelo', burst: 'Explosiones', smoke: 'Humo', maps: 'Mapas', hud_propuesta: 'Propuestas de HUD', hud_fotos: 'Fotos del HUD', tiras: 'Tiras',
  outputs: 'Entregas', comic: 'Cómic', rachas_cartas: 'Cartas de rachas', elemental: 'Rachas elementales', agarres: 'Agarres', martillo: 'Martillo', fidget: 'Descansos', motion: 'Movimiento',
  tirolina: 'Tirolina', ladder: 'Escalas', look: 'Encuadres', tour: 'Paseos por el mapa', machine: 'Máquinas', overview: 'Vista general'
}

/** A folder's name for people: known words in Spanish, the rest with spaces and a capital. */
export function prettyFolder(seg: string): string {
  const known = NAMES[seg.toLowerCase()]
  if (known) return t(known)
  const s = seg.replace(/^_+/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : seg
}

/** Where a file comes from, by the first folder of its place in the project. */
export function sourceOf(folder: string): AssetSource {
  const first = (folder.split('/')[0] ?? '').toLowerCase()
  if (first === 'assets' || first === 'audio') return 'juego'
  if (first === 'astra') return 'astra'
  if (first === 'artsource' || first === 'art') return 'arte'
  if (first === 'docs') return 'docs'
  if (first === 'logs' || first === 'captures' || first === 'screenshots' || first === 'renders') return 'pruebas'
  return 'otros'
}

/** The place of a file for the user: `rel` keeps the copy it is in; `folder` does not. */
export function placeOf(project: ProjectConfig, file: string): { rel: string; folder: string; source: AssetSource } {
  const copy = copyOf(project, dirname(file))
  if (copy) {
    const inside = relative(copy.path, file).split(sep).join('/')
    const folder = inside.includes('/') ? inside.slice(0, inside.lastIndexOf('/')) : ''
    return { rel: (copy.label !== 'Copia principal' && copy.label !== t('Copia principal') ? copy.label + '/' : '') + inside, folder, source: sourceOf(folder) }
  }
  // Outside the project: what Astra delivers (Documents\Codex\<date>\<chat>\…), or a folder the user added.
  const parts = file.split(/[\\/]/)
  const codex = parts.findIndex((p) => p.toLowerCase() === 'codex')
  const dirs = codex >= 0 ? ['Astra', ...parts.slice(codex + 1, -1)] : [t('Otras'), ...parts.slice(Math.max(0, parts.length - 3), -1)]
  const folder = dirs.join('/')
  return { rel: `${folder}/${parts[parts.length - 1]}`, folder, source: codex >= 0 ? 'astra' : 'otros' }
}

export function quickHash(file: string, size: number): string {
  const h = createHash('sha1')
  h.update(String(size))
  const fd = openSync(file, 'r')
  try {
    const n = Math.min(65536, size)
    const buf = Buffer.alloc(n)
    readSync(fd, buf, 0, n, 0)
    h.update(buf)
    if (size > 131072) {
      readSync(fd, buf, 0, n, size - n)
      h.update(buf)
    }
  } finally {
    closeSync(fd)
  }
  return h.digest('hex').slice(0, 20)
}

/** The copy a folder belongs to: the longest matching path, since worktrees live inside the main copy. */
export function copyOf(project: ProjectConfig, dir: string): ProjectConfig['copies'][number] | undefined {
  const d = dir.toLowerCase()
  return project.copies
    .filter((c) => d === c.path.toLowerCase() || d.startsWith(c.path.toLowerCase() + sep))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

export interface ScanResult {
  scanned: number
  added: number
  changed: number
  removed: number
  ms: number
}

const SKIP_DIRS = new Set(['library', 'temp', 'obj', 'node_modules', '.git', 'packagecache', '.venv', 'venv', '__pycache__', 'site-packages', '.vs', '.idea', '.cache'])
const MAX_DEPTH = 14

type Found = { file: string; size: number; mtime: number }

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > MAX_DEPTH) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name.toLowerCase())) yield* walk(full, depth + 1)
    } else if (e.isFile() && kindOf(e.name)) yield full
  }
}

function collect(project: ProjectConfig): Found[] {
  const out: Found[] = []
  for (const dir of project.mediaDirs) {
    for (const file of walk(dir)) {
      try {
        const st = statSync(file)
        out.push({ file, size: st.size, mtime: Math.round(st.mtimeMs) })
      } catch { /* just deleted */ }
    }
  }
  return out
}

/** The same walk without blocking the app: the files are read by the system's thread pool. */
async function collectAsync(project: ProjectConfig): Promise<Found[]> {
  const out: Found[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return
    let entries
    try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    const files = entries.filter((e) => e.isFile() && kindOf(e.name))
    for (let i = 0; i < files.length; i += 64) {
      await Promise.all(files.slice(i, i + 64).map(async (e) => {
        const file = join(dir, e.name)
        try {
          const st = await fsp.stat(file)
          out.push({ file, size: st.size, mtime: Math.round(st.mtimeMs) })
        } catch { /* just deleted */ }
      }))
    }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name.toLowerCase())) await visit(join(dir, e.name), depth + 1)
  }
  for (const dir of project.mediaDirs) await visit(dir, 0)
  return out
}

/** Bump it when the rules above change: every file gets its category and place worked out again. */
const RULES_VERSION = '2'

function applyScan(db: DB, project: ProjectConfig, found: Found[], t0: number): ScanResult {
  const now = Date.now()
  const rulesKey = `mediaRules:${project.id}`
  const fresh = (db.prepare('SELECT value FROM meta WHERE key = ?').get(rulesKey) as { value: string } | undefined)?.value !== RULES_VERSION
  const existing = new Map<string, { id: number; size: number; mtime: number; gone: number; folder: string | null }>()
  for (const r of db.prepare('SELECT id, path, size, mtime, gone, folder FROM assets WHERE project_id = ?').all(project.id) as any[]) {
    existing.set(r.path, { id: r.id, size: r.size, mtime: r.mtime, gone: r.gone, folder: r.folder })
  }
  const ins = db.prepare('INSERT INTO assets(project_id, path, rel, name, kind, category, size, mtime, first_seen, folder, source) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  const upd = db.prepare('UPDATE assets SET size = ?, mtime = ?, hash = NULL, gone = 0 WHERE id = ?')
  const place = db.prepare('UPDATE assets SET folder = ?, source = ?, category = ? WHERE id = ?')
  const seen = new Set<string>()
  let added = 0, changed = 0, removed = 0
  db.exec('BEGIN')
  try {
    for (const f of found) {
      if (seen.has(f.file)) continue
      seen.add(f.file)
      const prev = existing.get(f.file)
      const kind = kindOf(f.file)!
      const name = basename(f.file)
      if (!prev) {
        const p = placeOf(project, f.file)
        ins.run(project.id, f.file, p.rel, name, kind, categoryOf(`${p.folder}/${name}`, kind), f.size, f.mtime, now, p.folder, p.source)
        added++
        continue
      }
      if (prev.size !== f.size || prev.mtime !== f.mtime || prev.gone) {
        upd.run(f.size, f.mtime, prev.id)
        changed++
      }
      if (fresh || prev.folder == null) {
        const p = placeOf(project, f.file)
        place.run(p.folder, p.source, categoryOf(`${p.folder}/${name}`, kind), prev.id)
      }
    }
    const gone = db.prepare('UPDATE assets SET gone = 1 WHERE id = ?')
    for (const [path, r] of existing) {
      if (!seen.has(path) && !r.gone) {
        gone.run(r.id)
        removed++
      }
    }
    db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(rulesKey, RULES_VERSION)
    db.exec('COMMIT')
    return { scanned: found.length, added, changed, removed, ms: Date.now() - t0 }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** Indexes the media folders. */
export function scanMedia(db: DB, project: ProjectConfig): ScanResult {
  const t0 = Date.now()
  return applyScan(db, project, collect(project), t0)
}

/** The same for the app: only the short final write to the database happens on its main thread. */
export async function scanMediaAsync(db: DB, project: ProjectConfig): Promise<ScanResult> {
  const t0 = Date.now()
  return applyScan(db, project, await collectAsync(project), t0)
}

/** Fingerprints for assets that don't have one yet, a few at a time. Duplicates share a fingerprint. */
/**
 * `until`: a moment (ms) after which it stops and leaves the rest for the next round. It runs in the app's main process:
 * 13-11, with a video export filling the processor, one round over the video project's new files took 1,3 s every 5 s.
 */
export function hashPending(db: DB, projectId: string, max = 200, until = Infinity): number {
  const rows = db.prepare('SELECT id, path, size FROM assets WHERE project_id = ? AND hash IS NULL AND gone = 0 ORDER BY mtime DESC LIMIT ?').all(projectId, max) as any[]
  const set = db.prepare('UPDATE assets SET hash = ? WHERE id = ?')
  let n = 0
  for (const r of rows) {
    if (Date.now() > until) break
    try {
      set.run(quickHash(r.path, r.size), r.id)
      n++
    } catch {
      set.run('error', r.id)
    }
  }
  return n
}
