// Changes Mission Control makes to Claude Code's own settings, always with a backup first and always reversible:
//   - statusLine: so each account reports its 5-hour and weekly usage (official statusLine JSON on stdin).
// If an account already had a statusLine, it is kept and chained: ours runs it and prints its output.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AccountConfig } from './types'
import { configDirOf } from './sessions'
import { paths } from './paths'

export const STATUSLINE_MARK = /pmc\.mjs"?\s+statusline(\s|$)/
const isOurs = (cmd?: string) => Boolean(cmd && STATUSLINE_MARK.test(cmd))

export function settingsFile(acc: AccountConfig): string {
  return join(configDirOf(acc), 'settings.json')
}

function readJson(file: string): any {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  return text.trim() ? JSON.parse(text) : {}
}

/** Writes through a temp file and rename, so a crash never leaves a half-written settings.json. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = file + '.pmc-tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function backupFile(file: string, tag: string): string | undefined {
  if (!existsSync(file)) return undefined
  const dir = join(paths.backupsDir(), 'config')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = join(dir, `${tag}-${stamp}.json`)
  copyFileSync(file, target)
  return target
}

/**
 * A CLAUDE.md that a work copy reads twice (its own and the one of the folder it sits in, with the same text) is left out
 * for sessions in that copy (EV24): Claude Code's `claudeMdExcludes`, in the copy's own `.claude/settings.local.json`
 * (never versioned, never an account's settings). A copy of the file is kept first; everything else in it stays.
 */
export function excludeClaudeMd(copyRoot: string, claudeMd: string, tag = 'settings-local'): { file: string; backup?: string; added: boolean } {
  const file = join(copyRoot, '.claude', 'settings.local.json')
  mkdirSync(join(copyRoot, '.claude'), { recursive: true })
  const s = readJson(file)
  const path = claudeMd.split('\\').join('/')
  const list: string[] = Array.isArray(s.claudeMdExcludes) ? s.claudeMdExcludes : []
  if (list.some((x) => x.toLowerCase() === path.toLowerCase())) return { file, added: false }
  const backup = backupFile(file, tag)
  s.claudeMdExcludes = [...list, path]
  writeJsonAtomic(file, s)
  return { file, backup, added: true }
}

export function chainFile(): string {
  return join(paths.root(), 'statusline-chain.json')
}

export function readChain(): Record<string, string> {
  try { return JSON.parse(readFileSync(chainFile(), 'utf8')) } catch { return {} }
}

export function statusLineCommand(nodeExe: string, pmcPath: string, acc: AccountConfig): string {
  const q = (s: string) => `"${s.replace(/\\/g, '/')}"`
  return `${q(nodeExe)} ${q(pmcPath)} statusline ${acc.id}`
}

export interface StatusLineState {
  installed: boolean
  ours: boolean
  command?: string
  otherCommand?: string
  file: string
}

export function statusLineState(acc: AccountConfig): StatusLineState {
  const file = settingsFile(acc)
  try {
    const s = readJson(file)
    const cmd: string | undefined = s?.statusLine?.command
    const ours = isOurs(cmd)
    return { installed: Boolean(cmd), ours, command: cmd, otherCommand: ours ? readChain()[acc.id] : cmd, file }
  } catch {
    return { installed: false, ours: false, file }
  }
}

export function installStatusLine(acc: AccountConfig, nodeExe: string, pmcPath: string): { backup?: string; command: string } {
  const file = settingsFile(acc)
  const s = readJson(file)
  const backup = backupFile(file, `settings-${acc.id}`)
  const command = statusLineCommand(nodeExe, pmcPath, acc)
  const prev: string | undefined = s?.statusLine?.command
  if (prev && !isOurs(prev)) {
    const chain = readChain()
    chain[acc.id] = prev
    mkdirSync(paths.root(), { recursive: true })
    writeFileSync(chainFile(), JSON.stringify(chain, null, 2), 'utf8')
  }
  s.statusLine = { ...(s.statusLine ?? {}), type: 'command', command }
  writeJsonAtomic(file, s)
  return { backup, command }
}

export function uninstallStatusLine(acc: AccountConfig): { backup?: string; restored?: string } {
  const file = settingsFile(acc)
  const s = readJson(file)
  if (!isOurs(s?.statusLine?.command)) return {}
  const backup = backupFile(file, `settings-${acc.id}`)
  const chain = readChain()
  const prev = chain[acc.id]
  if (prev) {
    s.statusLine = { ...s.statusLine, command: prev }
    delete chain[acc.id]
    writeFileSync(chainFile(), JSON.stringify(chain, null, 2), 'utf8')
  } else delete s.statusLine
  writeJsonAtomic(file, s)
  return { backup, restored: prev }
}

// ---- hooks (coordination) --------------------------------------------------------------------------------------------
// Added next to whatever hooks the account already has (the game project keeps its own in each project); only ours are removed.

export const HOOK_MARK = /pmc\.mjs"?\s+hook(\s|$)/
const isOurHook = (h: any) => typeof h?.command === 'string' && HOOK_MARK.test(h.command)

export const HOOK_EVENTS: { event: string; matcher?: string; async: boolean }[] = [
  { event: 'SessionStart', async: false },
  // Not in the background: its answer («do not stop, there is work») is what autonomous mode is. Run asynchronously, Claude
  // Code never read it and every account stopped at the end of each turn (12-11, the user: «el modo autónomo está activado,
  // no deberías haberte detenido, ni tú ni ningún claude»).
  { event: 'Stop', async: false },
  { event: 'StopFailure', async: true },
  // EV76: not in the background either: what it prints is added to the summary's instructions only when Claude Code waits
  // for it (checked in 2.1: `newCustomInstructions`); in the background it was never read.
  { event: 'PreCompact', async: false },
  { event: 'SessionEnd', async: true },
  { event: 'PostToolUse', matcher: 'Write|Edit|MultiEdit|NotebookEdit', async: false },
  // Delivers the "someone took over your task" notice before an account that comes back edits anything.
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell', async: false }
]

export function hookCommand(nodeExe: string, pmcPath: string, acc: AccountConfig): string {
  const q = (s: string) => `"${s.split('\\').join('/')}"`
  return `${q(nodeExe)} ${q(pmcPath)} hook ${acc.id}`
}

function stripOurs(hooks: any): any {
  const out: any = {}
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    const kept = (groups as any[])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !isOurHook(h)) }))
      .filter((g) => g.hooks.length > 0)
    if (kept.length) out[event] = kept
  }
  return out
}

export function hooksState(acc: AccountConfig): { installed: boolean; events: string[]; file: string; outdated: boolean } {
  const file = settingsFile(acc)
  try {
    const s = readJson(file)
    const events = Object.entries(s?.hooks ?? {}).filter(([, g]) => (g as any[]).some((x) => (x.hooks ?? []).some(isOurHook))).map(([e]) => e)
    // Also out of date: one of ours set to run in the background when it must not (or the other way round).
    const ours = (event: string) => ((s?.hooks?.[event] ?? []) as any[]).flatMap((g) => g.hooks ?? []).find(isOurHook)
    const wrongMode = HOOK_EVENTS.some((h) => { const o = ours(h.event); return o && Boolean(o.async) !== h.async })
    return { installed: events.length > 0, events, file, outdated: events.length > 0 && (HOOK_EVENTS.some((h) => !events.includes(h.event)) || wrongMode) }
  } catch {
    return { installed: false, events: [], file, outdated: false }
  }
}

export function installHooks(acc: AccountConfig, nodeExe: string, pmcPath: string): { backup?: string } {
  const file = settingsFile(acc)
  const s = readJson(file)
  const backup = backupFile(file, `settings-${acc.id}`)
  const command = hookCommand(nodeExe, pmcPath, acc)
  const hooks = stripOurs(s.hooks)
  for (const h of HOOK_EVENTS) {
    const entry: any = { hooks: [{ type: 'command', command, timeout: h.async ? 20 : h.event === 'PreToolUse' ? 5 : h.event === 'Stop' ? 15 : 10, ...(h.async ? { async: true } : {}) }] }
    if (h.matcher) entry.matcher = h.matcher
    hooks[h.event] = [...(hooks[h.event] ?? []), entry]
  }
  s.hooks = hooks
  writeJsonAtomic(file, s)
  return { backup }
}

/**
 * EV52: the same hooks in a project folder (`.claude/settings.local.json`), so any account working there is seen by the
 * app without touching its own settings. The command names no account: `pmc hook` takes it from CLAUDE_CONFIG_DIR.
 * Only adds (the project's own hooks, like the game project's wake_after_limit.ps1, stay) and copies the file first.
 */
export function installProjectHooks(dir: string, nodeExe: string, pmcPath: string): { file: string; backup?: string } {
  const file = join(dir, '.claude', 'settings.local.json')
  mkdirSync(dirname(file), { recursive: true })
  const s = existsSync(file) ? readJson(file) : {}
  const backup = existsSync(file) ? backupFile(file, 'settings-local') : undefined
  const q = (x: string) => `"${x.split('\\').join('/')}"`
  const command = `${q(nodeExe)} ${q(pmcPath)} hook`
  const hooks = stripOurs(s.hooks)
  for (const h of HOOK_EVENTS) {
    const entry: any = { hooks: [{ type: 'command', command, timeout: h.async ? 20 : h.event === 'PreToolUse' ? 5 : h.event === 'Stop' ? 15 : 10, ...(h.async ? { async: true } : {}) }] }
    if (h.matcher) entry.matcher = h.matcher
    hooks[h.event] = [...(hooks[h.event] ?? []), entry]
  }
  s.hooks = hooks
  writeJsonAtomic(file, s)
  return { file, backup }
}

export function uninstallHooks(acc: AccountConfig): { backup?: string } {
  const file = settingsFile(acc)
  const s = readJson(file)
  if (!hooksState(acc).installed) return {}
  const backup = backupFile(file, `settings-${acc.id}`)
  const hooks = stripOurs(s.hooks)
  if (Object.keys(hooks).length) s.hooks = hooks
  else delete s.hooks
  writeJsonAtomic(file, s)
  return { backup }
}
