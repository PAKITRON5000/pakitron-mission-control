// Backups of the projects on another disk (EV44; the user, Decidir #135 «B»: G:\Copias de proyectos). Everything is in
// git only on this PC: if C: fails, it is lost. Each night the app copies each project's git history to a bare repository
// on the other disk: the first time all of it (a local clone: the object files are copied as they are, no repacking),
// then only what is new (`git push` of every branch and tag). Never anything deleted there: no --prune, no forced
// pushes; a branch whose history was rewritten keeps the old one in the copy and the new one beside it, under
// `reescritas/<día>/`. LFS files (the game project's images, 7 GB) are copied file by file (they never change once written).
// No node imports: the screens show the defaults.
import { nightWindow } from './routines'

export interface BackupSettings {
  on?: boolean
  dir?: string
  hora?: string
  /** Projects the user left out. */
  off?: string[]
}

// The user's PC has its other disk at G:. Anywhere else (a Mac, 14-11) nothing is copied until a folder is chosen in
// Ajustes: a default on a disk that is not there would fail every night.
const onWindows = typeof process === 'undefined' || process.platform === 'win32'
export const BACKUP_DEFAULTS = onWindows
  ? { on: true, dir: 'G:\\Copias de proyectos', hora: '03:00' }
  : { on: false, dir: `${process.env.HOME ?? ''}/Copias de proyectos`, hora: '03:00' }

export interface BackupMemory {
  /** Night (nightWindow › key) of the last good copy, by project. */
  nights: Record<string, string>
  /** Last try, by project: a failed or put-off one waits half an hour. */
  tries: Record<string, number>
  /** Last result, by project. */
  last: Record<string, { at: number; ok: boolean; summary: string }>
  /** Day a failure was last told to the user, by project: once a day, not every half hour. */
  warned: Record<string, string>
}

export const emptyBackupMemory = (): BackupMemory => ({ nights: {}, tries: {}, last: {}, warned: {} })

export const BACKUP_RETRY_MS = 30 * 60_000

export function backupSettings(s?: BackupSettings): Required<BackupSettings> {
  return { on: s?.on ?? BACKUP_DEFAULTS.on, dir: s?.dir || BACKUP_DEFAULTS.dir, hora: s?.hora || BACKUP_DEFAULTS.hora, off: s?.off ?? [] }
}

/** Where a project's copy lives: one bare repository per project, named by its id. */
export function backupTarget(dir: string, projectId: string): string {
  // A Windows folder (a drive letter or «\») keeps «\»; a Mac's keeps «/».
  const sep = /^[a-z]:|\\/i.test(dir) ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${projectId.replace(/[^\w.-]/g, '_')}.git`
}

/**
 * The project to copy now, if any. One at a time, once per night from the chosen hour (the user agreed to «una copia
 * cada noche»; the first one is 41 GB for the game project and must not land in his working day). Nothing while he plays or
 * edits video (`busy`); a failed one is tried again half an hour later, while the night lasts.
 */
export function dueBackup(projects: { id: string; git: boolean }[], settings: BackupSettings | undefined, mem: BackupMemory, now: number, busy: boolean): { projectId: string; night: string; first: boolean } | undefined {
  const s = backupSettings(settings)
  if (!s.on || busy) return undefined
  const w = nightWindow(s.hora, now)
  if (!w.inside) return undefined
  for (const p of projects) {
    if (!p.git || s.off.includes(p.id)) continue
    if (now - (mem.tries[p.id] ?? 0) < BACKUP_RETRY_MS) continue
    if (mem.nights[p.id] !== w.key) return { projectId: p.id, night: w.key, first: !mem.last[p.id]?.ok }
  }
  return undefined
}

/** Branches `git push --porcelain` refused (their history was rewritten): lines «!\t<from>:<to>\t[rejected] …». */
export function rejectedBranches(porcelain: string): string[] {
  return porcelain.split(/\r?\n/)
    .filter((l) => l.startsWith('!'))
    .map((l) => l.split('\t')[1]?.split(':')[0] ?? '')
    .filter((r) => r.startsWith('refs/heads/'))
    .map((r) => r.slice('refs/heads/'.length))
}

/** Where a rewritten branch is kept in the copy, beside the old one (nothing is overwritten). */
export function rewrittenRefspec(branch: string, now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `+refs/heads/${branch}:refs/heads/reescritas/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}/${branch}`
}

/** What changed, from `git push --porcelain`: refs updated or created (« » fast-forward, «*» new, «+» forced). */
export function pushedRefs(porcelain: string): number {
  return porcelain.split(/\r?\n/).filter((l) => /^[ *+]\t/.test(l)).length
}

/** After a run: what to remember; tells whether the failure should be told now (once a day). */
export function rememberBackup(mem: BackupMemory, projectId: string, night: string, ok: boolean, summary: string, now: number): { tell: boolean } {
  mem.tries[projectId] = now
  mem.last[projectId] = { at: now, ok, summary }
  if (ok) { mem.nights[projectId] = night; delete mem.warned[projectId]; return { tell: false } }
  const d = new Date(now)
  const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  if (mem.warned[projectId] === day) return { tell: false }
  mem.warned[projectId] = day
  return { tell: true }
}
