// Folder trust (EV103). Before anything else, Claude Code asks once per folder and account «Quick safety check: Is this
// a project you trust?», with «No, exit» chosen by default: a window the app opens while the user is away stays stuck
// there. `--permission-mode auto` does not cover it. The answer lives in the account's .claude.json, in
// `projects["C:/ruta"].hasTrustDialogAccepted`; a trusted parent is not enough (a trusted «B:/» still asked in
// «D:\Video»). So the app writes that mark itself for each project folder and copy, in every account, before
// opening a window and on a sweep.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AccountConfig } from './types'
import { home } from './paths'

/** What Claude Code writes for a folder it has not seen; the app adds only these, never touching other entries. */
const NEW_ENTRY = {
  allowedTools: [] as string[],
  mcpContextUris: [] as string[],
  mcpServers: {},
  enabledMcpjsonServers: [] as string[],
  disabledMcpjsonServers: [] as string[],
  hasTrustDialogAccepted: true,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false
}

/** The account's own .claude.json: the default account keeps it in the user folder, the others in their folder. */
export function claudeJsonOf(acc: Pick<AccountConfig, 'configDir'>): string {
  return acc.configDir ? join(acc.configDir, '.claude.json') : join(home(), '.claude.json')
}

/** The key Claude Code uses for a folder: forward slashes, capital drive letter, no slash at the end ("C:/Users/…"). */
export function trustKey(dir: string): string {
  let p = dir.trim().replace(/\\/g, '/')
  const bash = /^\/([a-zA-Z])(\/|$)/.exec(p)
  if (bash) p = `${bash[1]}:/${p.slice(3)}`
  p = p.replace(/\/{2,}/g, '/')
  if (/^[a-zA-Z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1)
  if (/^[A-Z]:$/.test(p)) p += '/'
  if (p.length > 3) p = p.replace(/\/+$/, '')
  return p
}

function parentKey(key: string): string | undefined {
  if (/^[A-Z]:\/$/.test(key) || key === '/') return undefined
  const i = key.lastIndexOf('/')
  if (i < 0) return undefined
  return i <= 2 && /^[A-Z]:/.test(key) ? key.slice(0, 3) : key.slice(0, i) || '/'
}

type Projects = Record<string, { hasTrustDialogAccepted?: boolean } | undefined>

/** Whether the folder or one that contains it is marked trusted (what the user sees as «ya confía»). */
export function isTrusted(projects: Projects | undefined, dir: string): boolean {
  for (let k: string | undefined = trustKey(dir); k; k = parentKey(k)) if (projects?.[k]?.hasTrustDialogAccepted === true) return true
  return false
}

/**
 * Whether Claude Code starts there without asking. Only the folder's own mark counts for sure: claude5 had «B:/»
 * trusted and still asked in «D:\Video» (seen in a real window, 13-11), so a parent is never relied on.
 */
export function startsWithoutAsking(projects: Projects | undefined, dir: string): boolean {
  return projects?.[trustKey(dir)]?.hasTrustDialogAccepted === true
}

export interface TrustResult {
  file: string
  /** Folders marked now. */
  added: string[]
  /** Why nothing was written, when nothing could be: the account has never started here, or its file does not read. */
  skipped?: string
}

/**
 * Marks the folders as trusted in that .claude.json. Only adds: an entry the folder already has keeps all its fields
 * (only the mark changes); every folder gets its own mark, even under a trusted parent. Writes to a side file and
 * renames it, and only when something changes, so a running session never reads half a file. A file that does not
 * parse is never rewritten (it could be a session writing it right now): the next sweep tries again.
 */
export function ensureTrusted(file: string, dirs: string[]): TrustResult {
  if (!existsSync(file)) return { file, added: [], skipped: 'la cuenta aún no ha arrancado en este PC' }
  let raw: string
  let j: { projects?: Projects } & Record<string, unknown>
  try {
    raw = readFileSync(file, 'utf8')
    j = JSON.parse(raw)
  } catch {
    return { file, added: [], skipped: 'su .claude.json no se puede leer ahora' }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { file, added: [], skipped: 'su .claude.json no es lo esperado' }
  const projects: Projects = j.projects && typeof j.projects === 'object' ? j.projects : {}
  const added: string[] = []
  for (const d of dirs) {
    if (!d || startsWithoutAsking(projects, d)) continue
    const k = trustKey(d)
    projects[k] = projects[k] ? { ...projects[k], hasTrustDialogAccepted: true } : { ...NEW_ENTRY }
    added.push(k)
  }
  if (!added.length) return { file, added }
  j.projects = projects
  const tmp = join(dirname(file), `.claude.json.pmc-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(tmp, JSON.stringify(j, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* nothing left */ }
    return { file, added: [], skipped: `no se pudo escribir: ${(e as Error).message}` }
  }
  return { file, added }
}

/** Every folder a project may be opened in: its root and its copies. */
export function projectFolders(projects: { root: string; copies?: { path: string }[] }[]): string[] {
  const out = new Map<string, string>()
  for (const p of projects) for (const d of [p.root, ...(p.copies ?? []).map((c) => c.path)]) if (d && existsSync(d)) out.set(trustKey(d), d)
  return [...out.values()]
}

/** The sweep: every account with a login on this PC gets the project folders marked. */
export function trustEverywhere(accounts: Pick<AccountConfig, 'id' | 'configDir'>[], folders: string[]): (TrustResult & { account: string })[] {
  return accounts.map((a) => ({ account: a.id, ...ensureTrusted(claudeJsonOf(a), folders) }))
}
