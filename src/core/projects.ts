import { t } from './i18n'
// Projects: a folder (usually a git repository) with its copies (worktrees), docs and media folders.
// Git is only read, with --no-optional-locks so not even the index gets refreshed.
import { execFile } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { CopyStatus, DocSource, ProjectConfig, Settings } from './types'
import type { DB } from './db'
import { findMediaDirs } from './profile'
import { BOOKKEEPING, parseDiff, TASK_ID, taskOfSubject, type TaskCommit } from './taskdiff'

export function git(cwd: string, args: string[], timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 << 20 }, (err, stdout) =>
      err ? reject(new Error(String(err.message).split('\n')[0])) : resolve(stdout)
    )
  })
}

export async function listWorktrees(root: string): Promise<{ path: string; branch?: string; head?: string }[]> {
  try {
    const out = await git(root, ['worktree', 'list', '--porcelain'])
    const list: { path: string; branch?: string; head?: string }[] = []
    let cur: { path: string; branch?: string; head?: string } | undefined
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        cur = { path: line.slice(9).replace(/\//g, '\\') }
        list.push(cur)
      } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '')
      else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5)
    }
    return list
  } catch {
    return [{ path: root }]
  }
}

export function copyLabel(root: string, path: string): string {
  if (path.toLowerCase() === root.toLowerCase()) return 'Copia principal'
  const m = path.match(/worktrees[\\/]([^\\/]+)$/i)
  return m ? m[1] : basename(path)
}

export async function copyStatus(path: string, label: string): Promise<CopyStatus> {
  const readAt = Date.now()
  try {
    const [st, log] = await Promise.all([
      git(path, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b', '--untracked-files=normal']),
      git(path, ['log', '-1', '--format=%H%x1f%s%x1f%ct'])
    ])
    const lines = st.split(/\r?\n/).filter(Boolean)
    const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
    const branch = head.split('...')[0].replace(/^No commits yet on /, '')
    const ahead = head.match(/ahead (\d+)/)
    const [hash, subject, ct] = log.trim().split('\x1f')
    return {
      path,
      label,
      branch,
      head: hash?.slice(0, 9),
      headSubject: subject,
      headAt: ct ? Number(ct) * 1000 : undefined,
      dirty: lines.filter((l) => !l.startsWith('??')).length,
      untracked: lines.filter((l) => l.startsWith('??')).length,
      changed: lines.slice(0, 400).map((l) => l.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, '')),
      ahead: ahead ? Number(ahead[1]) : undefined,
      readAt
    }
  } catch (e) {
    return { path, label, dirty: 0, untracked: 0, readAt, error: (e as Error).message }
  }
}

export interface Commit {
  hash: string
  at: number
  subject: string
  author: string
  branches: string
}

export async function recentCommits(root: string, sinceDays = 21, max = 400): Promise<Commit[]> {
  try {
    const out = await git(root, ['log', '--all', `--since=${sinceDays}.days`, `--max-count=${max}`, '--format=%h%x1f%ct%x1f%s%x1f%an%x1f%D'])
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [hash, ct, subject, author, refs] = l.split('\x1f')
        return { hash, at: Number(ct) * 1000, subject, author, branches: refs ?? '' }
      })
  } catch {
    return []
  }
}

/** EV133: the commits since a moment in every branch, counted by git: the list above stops at 400 (534 in one day, 13-11). */
export async function commitsSince(root: string, since: number): Promise<number | undefined> {
  try {
    const n = Number((await git(root, ['rev-list', '--all', '--count', `--since=@${Math.floor(since / 1000)}`])).trim())
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/** Of all the copies' docs folders, the file changed last (TASKS.md is kept in every copy). */
export function newestDoc(project: ProjectConfig, name: string): DocSource | undefined {
  let best: DocSource | undefined
  for (const dir of project.docsDirs) {
    const file = join(dir, name)
    try {
      const st = statSync(file)
      if (!best || st.mtimeMs > best.mtime) {
        const copy = project.copies
          .filter((c) => dir.toLowerCase().startsWith(c.path.toLowerCase() + '\\'))
          .sort((a, b) => b.path.length - a.path.length)[0]
        best = { file, mtime: st.mtimeMs, copy: copy?.label ?? basename(dir) }
      }
    } catch { /* not in this copy */ }
  }
  return best
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8').replace(/^﻿/, '')
}

/** What Astra delivers lives outside the project (Documents\\Codex\\<date>\\<chat>): the folders the project's notes cite. */
export function citedFolders(docsDirs: string[], codex = join(homedir(), 'Documents', 'Codex')): string[] {
  const found = new Set<string>()
  for (const dir of docsDirs) {
    for (const name of ['RELEVO.md', 'TASKS.md', 'STATE.md']) {
      let text = ''
      try { text = readFileSync(join(dir, name), 'utf8') } catch { continue }
      for (const m of text.matchAll(/Codex[\\/](\d{4}-\d{2}-\d{2})[\\/]([^\\/`"'\s)»,;:]+)/g)) {
        const d = join(codex, m[1], m[2])
        if (!found.has(d) && existsSync(d)) found.add(d)
      }
    }
  }
  return [...found]
}

const mediaCache = new Map<string, { at: number; dirs: string[] }>()
function cachedMediaDirs(root: string): string[] {
  const hit = mediaCache.get(root.toLowerCase())
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.dirs
  let dirs: string[] = []
  try { dirs = findMediaDirs(root) } catch { /* unreadable: the usual folders still count */ }
  mediaCache.set(root.toLowerCase(), { at: Date.now(), dirs })
  return dirs
}

const PROJECT_COLORS = ['#FF6B8B', '#64D2FF', '#FFD60A', '#5E5CE6', '#FF9F0A', '#30D158']

export async function detectProject(root: string, name?: string, id?: string, color?: string): Promise<ProjectConfig> {
  const trees = await listWorktrees(root)
  const copies = trees.map((t) => ({ path: t.path, label: copyLabel(root, t.path), branch: t.branch }))
  if (!copies.length) copies.push({ path: root, label: t('Copia principal'), branch: undefined })
  const docsDirs = copies.map((c) => join(c.path, 'docs')).filter((d) => existsSync(d))
  const mediaDirs: string[] = []
  for (const c of copies) {
    // Everything that gets made, not only the tests: what the game uses (Assets, Audio), its originals and the notes' pictures.
    for (const sub of ['Logs', 'data\\producciones', 'Assets', 'ArtSource', 'Art', 'Audio', 'docs\\capturas', 'docs\\galeria', 'docs\\research', 'captures', 'screenshots', 'renders']) {
      const d = join(c.path, sub)
      if (existsSync(d)) mediaDirs.push(d)
    }
  }
  // And every other folder of each copy with pictures, videos, sounds or models in it (core/profile.ts): no project
  // needs its gallery placed by hand. Cached for half an hour: on a big game the looking takes about a second.
  for (const c of copies) for (const d of cachedMediaDirs(c.path)) if (!mediaDirs.some((m) => m.toLowerCase() === d.toLowerCase() || d.toLowerCase().startsWith(m.toLowerCase() + '\\'))) mediaDirs.push(d)
  mediaDirs.push(...citedFolders(docsDirs))
  const slug = (id ?? (name ?? basename(root)).toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')) || 'proyecto'
  return {
    id: slug,
    name: name ?? basename(root),
    root,
    copies,
    docsDirs,
    mediaDirs,
    color: color ?? PROJECT_COLORS[Math.abs([...slug].reduce((a, c) => a + c.charCodeAt(0), 0)) % PROJECT_COLORS.length],
    createdAt: Date.now(),
    readOnly: true,
    allowBuzon: false
  }
}

export function loadProjects(db: DB): ProjectConfig[] {
  return (db.prepare('SELECT config FROM projects ORDER BY created_at').all() as { config: string }[]).map((r) => JSON.parse(r.config))
}

export function saveProject(db: DB, p: ProjectConfig): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO projects(id, name, config, created_at, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, config = excluded.config, updated_at = excluded.updated_at'
  ).run(p.id, p.name, JSON.stringify(p), p.createdAt, now)
}

/** Every table that keeps something of a project by its id: removing the project (EV169) empties them of it. */
export const PROJECT_TABLES = ['tasks', 'events', 'assets', 'comments', 'instructions', 'claims', 'claim_history', 'decisions', 'assignments', 'task_cards', 'task_changes', 'verifications', 'memories'] as const

/**
 * EV169 (the user, 14-11 14:40: «añade a la app una opción para borrar proyectos»): the project and everything the
 * database kept about it, in one go. The caller makes a copy of the database first; the folder is not touched here.
 */
export function forgetProject(db: DB, id: string): void {
  db.exec('BEGIN')
  try {
    for (const table of PROJECT_TABLES) db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/**
 * EV169: gallery entries of a project that no longer exists (a scan that was under way when it was removed, 14-11: the
 * photos of the first project removed came back). '*' is not a project but everything, and stays. Returns how many went.
 */
export function dropOrphanAssets(db: DB): number {
  if (!(db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n) return 0
  return Number(db.prepare("DELETE FROM assets WHERE project_id <> '*' AND project_id NOT IN (SELECT id FROM projects)").run().changes)
}

/**
 * EV169: what changes in the settings when a project goes: nothing may name it any more (its wheel, its backup account,
 * starts scheduled on it, its routines, turn order, smart cleaning, autonomy and backups), it stops being the open one,
 * and its folder is not offered again as a project («Añadirlo como proyecto»).
 */
export function settingsWithoutProject(s: Settings, id: string, root: string): Partial<Settings> {
  const drop = <V>(r: Record<string, V> | undefined): Record<string, V> => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => k !== id))
  return {
    relayChains: drop(s.relayChains),
    routines: drop(s.routines),
    nextOrderBy: drop(s.nextOrderBy),
    smartClean: drop(s.smartClean),
    improveAsked: drop(s.improveAsked),
    reserves: (s.reserves ?? []).filter((r) => r.projectId !== id),
    schedules: Object.fromEntries(Object.entries(s.schedules ?? {}).filter(([, v]) => v?.projectId !== id)),
    autonomyOff: (s.autonomyOff ?? []).filter((x) => x !== id),
    ...(s.backup?.off ? { backup: { ...s.backup, off: s.backup.off.filter((x) => x !== id) } } : {}),
    declinedFolders: [...new Set([...(s.declinedFolders ?? []), root])],
    ...(s.activeProjectId === id ? { activeProjectId: undefined } : {})
  }
}

/**
 * EV169: whether a project's folder may go to the bin along with it. Never a drive, the user's folder, its Downloads,
 * Documents or Desktop, nor the folder of this app (or one that holds it): only the project's own folder.
 */
export function binnable(root: string, appDir: string, home = homedir()): boolean {
  const r = root.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  if (!/^[a-z]:\\[^\\]/.test(r)) return false // a drive itself, or not a folder on a drive
  const keep = [home, ...['Downloads', 'Documents', 'Desktop', 'OneDrive'].map((d) => join(home, d)), process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], appDir]
  return !keep.some((k) => k && isInside(k, root))
}

/** Refreshes the list of copies (worktrees come and go) without losing the user's choices. */
export async function refreshProjectCopies(db: DB, p: ProjectConfig): Promise<ProjectConfig> {
  const fresh = await detectProject(p.root, p.name, p.id, p.color)
  const merged: ProjectConfig = {
    ...p,
    copies: fresh.copies,
    docsDirs: [...new Set([...fresh.docsDirs, ...p.docsDirs.filter((d) => existsSync(d))])],
    mediaDirs: [...new Set([...fresh.mediaDirs, ...p.mediaDirs.filter((d) => existsSync(d))])].filter((d) => !p.mediaExcluded?.includes(d))
  }
  if (JSON.stringify(merged) !== JSON.stringify(p)) saveProject(db, merged)
  return merged
}

/**
 * A path is the folder itself or something inside it; one that only starts the same is not («D:\Video App» is not
 * in «D:\Video», 13-11). Case, slashes and a trailing separator do not matter.
 */
export function isInside(path: string, folder: string): boolean {
  const norm = (s: string) => s.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  const p = norm(path)
  const f = norm(folder)
  return Boolean(f) && (p === f || p.startsWith(f + '\\'))
}

export function projectForPath(projects: ProjectConfig[], path: string): { project?: ProjectConfig; copy?: string } {
  const lower = path.toLowerCase().replace(/\//g, '\\')
  let best: { project?: ProjectConfig; copy?: string; len: number } = { len: -1 }
  for (const p of projects) {
    for (const c of [...p.copies, { path: p.root, label: t('Copia principal') }]) {
      const cp = c.path.toLowerCase()
      if ((lower === cp || lower.startsWith(cp + '\\')) && cp.length > best.len) best = { project: p, copy: c.label, len: cp.length }
    }
  }
  return { project: best.project, copy: best.copy }
}

// ---- integration between copies (read only) -----------------------------------------------------------------------

export interface BranchIntegration {
  label: string
  path: string
  branch?: string
  base: string
  /** Commits in this branch that the base does not have yet: pending integration. */
  ahead: number
  /** Commits in the base this branch does not have. */
  behind: number
  pending: { hash: string; subject: string; at: number }[]
  /** Files changed on both sides since they split: where a merge could conflict. */
  overlap: string[]
  changedHere: number
  dirty: number
  error?: string
}

export async function integration(root: string, copies: CopyStatus[]): Promise<BranchIntegration[]> {
  const main = copies.find((c) => c.label === 'Copia principal')
  const base = main?.branch
  const out: BranchIntegration[] = []
  if (!base) return out
  for (const c of copies) {
    if (!c.branch || c.branch === base) continue
    const item: BranchIntegration = { label: c.label, path: c.path, branch: c.branch, base, ahead: 0, behind: 0, pending: [], overlap: [], changedHere: 0, dirty: c.dirty }
    try {
      const counts = (await git(root, ['rev-list', '--left-right', '--count', `${base}...${c.branch}`])).trim().split(/\s+/).map(Number)
      item.behind = counts[0] || 0
      item.ahead = counts[1] || 0
      if (item.ahead) {
        const log = await git(root, ['log', '--format=%h%x1f%s%x1f%ct', '-n', '30', `${base}..${c.branch}`])
        item.pending = log.split(/\r?\n/).filter(Boolean).map((l) => {
          const [hash, subject, ct] = l.split('\x1f')
          return { hash, subject, at: Number(ct) * 1000 }
        })
      }
      const mb = (await git(root, ['merge-base', base, c.branch])).trim()
      const here = (await git(root, ['diff', '--name-only', `${mb}..${c.branch}`])).split(/\r?\n/).filter(Boolean)
      item.changedHere = here.length
      if (item.behind && here.length) {
        const there = new Set((await git(root, ['diff', '--name-only', `${mb}..${base}`])).split(/\r?\n/).filter(Boolean))
        item.overlap = here.filter((f) => there.has(f)).slice(0, 200)
      }
    } catch (e) {
      item.error = (e as Error).message
    }
    out.push(item)
  }
  return out
}

/** The commits that are a task's (newest first) with their code, without the record files; heavy ones cut short. */
export async function taskDiff(root: string, extId: string, maxCommits = 20, maxLines = 3000): Promise<TaskCommit[]> {
  if (!TASK_ID.test(extId)) return []
  const log = await git(root, ['log', '--all', '-E', `--grep=(^|[^0-9A-Za-z])${extId}([^0-9]|$)`, '--format=%H%x1f%ct%x1f%s', '-n', '80'])
  const mine = log.split(/\r?\n/).filter(Boolean).map((l) => { const [hash, ct, subject] = l.split('\x1f'); return { hash, at: Number(ct) * 1000, subject } }).filter((c) => taskOfSubject(c.subject) === extId)
  const out: TaskCommit[] = []
  let left = maxLines
  for (const c of mine.slice(0, maxCommits)) {
    const show = await git(root, ['-c', 'core.quotePath=false', 'show', '--format=', '--no-color', '--no-ext-diff', '-U3', c.hash])
    const files = parseDiff(show, Math.max(40, Math.min(400, left))).filter((f) => !BOOKKEEPING.test(f.path))
    if (!files.length) continue
    left -= files.reduce((n, f) => n + f.hunks.reduce((k, h) => k + h.lines.length, 0), 0)
    out.push({ ...c, files })
  }
  return out
}
