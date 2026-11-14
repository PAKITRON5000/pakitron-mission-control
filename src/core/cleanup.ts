// A clean project (EV100; the user, 13-11: «proyectos como the game project o el science project ocupan muchísimo espacio… algo
// que de vez en cuando los Claude vayan depurando… que haya una opción de borrado inteligente y lo borre del todo, o si no
// sabe seguro si lo necesitará, que lo deje aparte… para hacerle un seguimiento… hazlo inteligente»).
//
// Three piles: «sobra» (it comes back by itself: build caches and the like) can go for good when the user turned smart
// deletion on; «dudoso» is set aside (moved, not deleted) and watched until something asks for it back or time and the
// project's progress say it is not needed; «queda» is never touched. Here only the deciding, from plain facts; no node
// imports. Measuring and moving are main's.

export type Pile = 'sobra' | 'dudoso' | 'queda'

export interface Entry {
  /** Path relative to the copy it is in, with «/». */
  rel: string
  kind: 'dir' | 'file'
  size: number
  mtime: number
  /** Full path, «/» or «\\», when known (for the Claudes' notes, pmc desechable / conservar). */
  path?: string
  /** Which copy of the project: the main folder or a worktree, and whether someone works there now. */
  copy?: { main: boolean; active: boolean }
}

export interface CleanupFacts {
  now: number
  /** Files with a note of the user in Revisar (never touched). */
  noted: Set<string>
  /** Words that open tasks, the code or the scenes name (a file named there is still wanted). */
  named: Set<string>
  /** Tracked by git and not pushed anywhere: it is work. */
  tracked?: (rel: string) => boolean
  /** Same name and size somewhere else in the project, newer. */
  newerTwin?: (e: Entry) => boolean
  /** EV100: the Claudes' notes while they work, by full path in lower case with «/»: keep it, or it is disposable. */
  marks?: Map<string, { kind: 'desechable' | 'conservar'; why: string; by?: string }>
  /** Not used for this long, a heavy file with nothing naming it is doubtful. */
  quietDays?: number
}

const DAY = 86400_000
/** Folders that come back by themselves: Unity's caches, build outputs, tool caches. */
/** Pure temporary files: they go anywhere (except in the copy someone works in now). */
const TEMPORARY = /(^|\/)(Temp|Logs|MemoryCaptures|__pycache__|\.pytest_cache|\.vite|\.cache|\.parcel-cache)$/i
/** What the project needs to run but can be made again (npm install, Unity's import): it goes only in copies at rest, never in the main one. */
const REINSTALLABLE = /(^|\/)(Library|obj|\.next|node_modules)$/i
const BUILDS = /(^|\/)(Builds?|dist|out|win-unpacked|release)$/i
const HEAVY = 50 * 1024 * 1024
const MEDIA = /\.(mp4|mov|mkv|avi|webm|wav|flac|png|jpe?g|exr|tga|psd|blend1?|fbx|obj|glb|gltf|zip|7z|rar)$/i

export function classify(e: Entry, f: CleanupFacts): { pile: Pile; why: string } {
  const name = e.rel.split('/').pop() ?? e.rel
  const low = e.rel.toLowerCase()
  if ([...f.noted].some((p) => p.toLowerCase().endsWith(low))) return { pile: 'queda', why: 'tiene una nota tuya en Revisar' }
  if (f.named.has(name.toLowerCase())) return { pile: 'queda', why: 'lo nombra una tarea abierta, el código o una escena' }
  const mark = e.path ? f.marks?.get(e.path.split('\\').join('/').toLowerCase()) : undefined
  if (mark?.kind === 'conservar') return { pile: 'queda', why: `${mark.by ? 'Claude ' + mark.by.replace(/\D/g, '') : 'Un Claude'} dijo que se conserva${mark.why ? ': ' + mark.why : ''}` }
  // A disposable one is only doubtful: set aside and watched, never straight to the bin on a Claude's word.
  if (mark?.kind === 'desechable') return { pile: 'dudoso', why: `${mark.by ? 'Claude ' + mark.by.replace(/\D/g, '') : 'Un Claude'} lo marcó como desechable${mark.why ? ': ' + mark.why : ''}` }
  if (e.kind === 'dir' && (TEMPORARY.test(e.rel) || REINSTALLABLE.test(e.rel))) {
    // A cache of the copy someone works in now is being used: only the ones of copies at rest go.
    if (e.copy?.active) return { pile: 'queda', why: 'es de una copia en la que se trabaja (ahora o estos días)' }
    if (REINSTALLABLE.test(e.rel) && e.copy?.main !== false) return { pile: 'queda', why: 'el proyecto la necesita para funcionar (se puede rehacer, pero tarda)' }
    return { pile: 'sobra', why: /node_modules/i.test(name) ? 'se vuelve a instalar sola (npm install) y nadie ha tocado esta copia en 7 días' : TEMPORARY.test(e.rel) ? 'son archivos temporales' : 'se vuelve a generar sola al abrir esta copia, que nadie ha tocado en 7 días' }
  }
  if (e.kind === 'dir' && BUILDS.test(e.rel) && f.now - e.mtime > 7 * DAY) return { pile: 'sobra', why: 'una compilación vieja: se vuelve a hacer cuando haga falta' }
  if (f.tracked?.(e.rel)) return { pile: 'queda', why: 'está guardado en git: es trabajo' }
  if (e.kind === 'file' && f.newerTwin?.(e)) return { pile: 'dudoso', why: 'hay una copia igual y más nueva en otro sitio del proyecto' }
  const quiet = (f.quietDays ?? 21) * DAY
  if (e.kind === 'file' && e.size >= HEAVY && MEDIA.test(name) && f.now - e.mtime > quiet) {
    return { pile: 'dudoso', why: `pesa ${Math.round(e.size / 1048576)} MB, nadie lo nombra y no se toca desde hace ${Math.round((f.now - e.mtime) / DAY)} días` }
  }
  return { pile: 'queda', why: 'se usa o es reciente' }
}

/**
 * A set-aside file goes back, stays aside, or can go for good: back if something names it again; gone after `weeks`
 * aside with nothing asking for it, or once the tasks that touched it are closed and the project moved on.
 */
export function asideFate(a: { at: number; name: string }, f: { now: number; named: Set<string>; weeks?: number; tasksOpen?: boolean }): 'volver' | 'esperar' | 'borrar' {
  if (f.named.has(a.name.toLowerCase())) return 'volver'
  const weeks = (f.weeks ?? 4) * 7 * DAY
  if (f.now - a.at >= weeks || (f.tasksOpen === false && f.now - a.at >= 7 * DAY)) return 'borrar'
  return 'esperar'
}

/** «3,2 GB». */
export function sizeText(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1).replace('.', ',')} GB`
  if (bytes >= 1 << 20) return `${Math.round(bytes / (1 << 20))} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
