import { t } from './i18n'
// Two small things the hooks and the app share through plain files, so neither costs any usage:
//   - what each account is doing right now (the last tool it ran, what it said when it stopped), written by `pmc hook`;
//   - the files the user left a note on, which no Claude may overwrite or delete, and the copy kept of each.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, closeSync, fstatSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AccountActivity, AccountId, Activity } from './types'
import { isInside, paths } from './paths'
import type { DB } from './db'

// ---- activity -------------------------------------------------------------------------------------------------------

export const activityDir = () => join(paths.root(), 'activity')
export const activityFile = (account: string) => join(activityDir(), `${account}.jsonl`)

/**
 * When the other accounts called a tool in this folder since `since` (`pmc guarda`: a file changed by an order leaves no
 * «archivo» event, so whose script it was is told by who was running something here then). Not from the copies of
 * `.claude/worktrees` inside it: another copy. Only the tail of each file is read.
 */
export function toolCallsIn(folder: string, since: number, except: string): number[] {
  const out: number[] = []
  let names: string[] = []
  try { names = readdirSync(activityDir()) } catch { return out }
  const copies = join(folder, '.claude', 'worktrees')
  for (const n of names) {
    if (!n.endsWith('.jsonl') || n === `${except}.jsonl`) continue
    let text = ''
    try {
      const fd = openSync(join(activityDir(), n), 'r')
      try {
        const size = fstatSync(fd).size
        const len = Math.min(size, 512 * 1024)
        const buf = Buffer.alloc(len)
        readSync(fd, buf, 0, len, size - len)
        text = buf.toString('utf8')
      } finally { closeSync(fd) }
    } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.includes('"PreToolUse"')) continue
      try {
        const a = JSON.parse(line) as Activity
        if (a.at >= since && a.cwd && isInside(a.cwd, folder) && !isInside(a.cwd, copies)) out.push(a.at)
      } catch { /* a line cut by the tail */ }
    }
  }
  return out
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/**
 * EV201 (the user, 15-11 15:28: «debería actualizarse también en lo que trabaja cada claude, el de una cuenta… está con IV
 * CUATRO y en chats sigue poniendo mission control»): the absolute folders and files a shell command names (in quotes or
 * not, Windows or Git Bash style), up to four. A Claude opened in one project's folder that works in another one says it
 * this way (`cd "B:\VIDEO DOS"`, a script run there): only the paths are kept, never the command.
 */
export function commandPaths(cmd: string): string[] {
  const out: string[] = []
  const add = (p: string | undefined) => {
    const c = (p ?? '').trim().replace(/[\\/]+$/, '')
    if (c.length > 3 && c.length < 300 && out.length < 4 && !out.includes(c)) out.push(c)
  }
  const text = cmd.slice(0, 4000)
  for (const m of text.matchAll(/"([A-Za-z]:[\\/][^"\r\n]*)"|'([A-Za-z]:[\\/][^'\r\n]*)'/g)) add(m[1] ?? m[2])
  for (const m of text.matchAll(/(?<![\w"'\\/:.-])([A-Za-z]:[\\/][^\s"'|&;<>()]*)/g)) add(m[1])
  // Git Bash: /c/Users/…, /b/VIDEO DOS/… (in quotes, with its spaces).
  for (const m of text.matchAll(/"\/([a-zA-Z])\/([^"\r\n]*)"|'\/([a-zA-Z])\/([^'\r\n]*)'/g)) add(`${(m[1] ?? m[3]).toUpperCase()}:\\${(m[2] ?? m[4]).replace(/\//g, '\\')}`)
  for (const m of text.matchAll(/(?<![\w"'\\/:.~-])\/([a-zA-Z])\/([^\s"'|&;<>()]+)/g)) add(`${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`)
  return out
}

/**
 * EV201: the project a conversation works in now, by what it touched lately (files it wrote or edited, folders its
 * commands named): the most touched of its last six inside a project, the latest on a tie. Undefined when it touched
 * nothing of a project in the last `withinMs`: then the folder its window was opened in says it, as until now.
 */
export function workingProjectOf(touches: { at: number; path: string }[] | undefined, projectOf: (path: string) => string | undefined, now = Date.now(), withinMs = 45 * 60_000): string | undefined {
  const seen: string[] = []
  for (const t of [...(touches ?? [])].sort((a, b) => b.at - a.at)) {
    if (now - t.at > withinMs || seen.length >= 6) break
    const id = projectOf(t.path)
    if (id) seen.push(id)
  }
  if (!seen.length) return undefined
  const count = new Map<string, number>()
  for (const id of seen) count.set(id, (count.get(id) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || seen.indexOf(a[0]) - seen.indexOf(b[0]))[0][0]
}

/** One line saying what a hook event means, in the user's words; undefined when it says nothing worth showing. */
export function describeHook(data: any): (Activity & { message?: string }) | undefined {
  const at = Date.now()
  const ev = String(data?.hook_event_name ?? '')
  const base = { at, sessionId: data?.session_id, cwd: data?.cwd, event: ev }
  const input = data?.tool_input ?? {}
  const file = input.file_path ?? input.notebook_path
  if (ev === 'PreToolUse') {
    const tool = String(data?.tool_name ?? '')
    if (tool === 'Bash' || tool === 'PowerShell') {
      const d = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : String(input.command ?? '').split(/\r?\n/)[0]
      const paths = commandPaths(String(input.command ?? ''))
      return d ? { ...base, text: short(d, 140), ...(paths.length ? { paths } : {}) } : undefined
    }
    if (file) return { ...base, text: `${tool === 'Write' ? 'Escribe' : 'Edita'} ${basename(String(file))}`, file: String(file) }
    return undefined
  }
  if (ev === 'Stop') {
    const m = typeof data?.last_assistant_message === 'string' ? data.last_assistant_message.trim() : ''
    return { ...base, text: t('Ha terminado un turno'), message: m ? short(m.replace(/\s+/g, ' '), 700) : undefined }
  }
  if (ev === 'SessionStart') return { ...base, text: data?.source === 'resume' ? t('Retoma una sesión') : data?.source === 'compact' ? t('Sigue tras compactar') : t('Empieza una sesión') }
  if (ev === 'SessionEnd') return { ...base, text: t('Ha cerrado la sesión') }
  if (ev === 'StopFailure') return { ...base, text: t('Se ha parado: {v0}', { v0: data?.error ?? 'error' }) }
  if (ev === 'PreCompact') return { ...base, text: t('Compacta su conversación') }
  return undefined
}

/** `pmc ahora "…"`: the sentence the user reads to know at a glance what this account is working on. */
export function setFocus(account: string, text: string, sessionId?: string): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/^ahora (estoy |está )?/i, '')
  const clean = t ? t[0].toUpperCase() + t.slice(1, 160) : ''
  if (clean) appendActivity(account, { at: Date.now(), event: 'Focus', text: clean, sessionId })
  return clean
}

export function appendActivity(account: string, a: Activity & { message?: string }): void {
  mkdirSync(activityDir(), { recursive: true })
  appendFileSync(activityFile(account), JSON.stringify(a) + '\n')
}

/** The last lines of an account's activity file (reads only its tail). */
export function readActivity(account: AccountId, keep = 14): AccountActivity {
  const out: AccountActivity = { recent: [], focusHistory: [] }
  let text = ''
  try {
    const fd = openSync(activityFile(account), 'r')
    try {
      const size = fstatSync(fd).size
      const n = Math.min(size, 48 * 1024)
      const buf = Buffer.alloc(n)
      readSync(fd, buf, 0, n, size - n)
      text = buf.toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return out
  }
  const lines = text.split('\n').filter(Boolean).reverse()
  for (const line of lines) {
    let a: Activity & { message?: string }
    try { a = JSON.parse(line) } catch { continue }
    // EV201: what each conversation touched lately, newest first (workingProjectOf).
    if (a.sessionId && (a.file || a.paths?.length)) {
      const by = (out.touchesBySession ??= {})
      const list = by[a.sessionId] ?? (Object.keys(by).length < 12 ? (by[a.sessionId] = []) : undefined)
      for (const p of [a.file, ...(a.paths ?? [])]) if (p && list && list.length < 10) list.push({ at: a.at, path: p })
    }
    if (a.event === 'Focus') {
      if (a.sessionId) {
        const by = (out.focusBySession ??= {})
        if (!by[a.sessionId] && Object.keys(by).length < 12) by[a.sessionId] = { at: a.at, text: a.text }
      }
      if (!out.focus) out.focus = { at: a.at, text: a.text, sessionId: a.sessionId }
      else if (out.focusHistory.length < 6 && out.focusHistory[out.focusHistory.length - 1]?.text !== a.text && out.focus.text !== a.text) out.focusHistory.push({ at: a.at, text: a.text })
      continue
    }
    if (a.message && !out.lastMessage) out.lastMessage = { at: a.at, text: a.message }
    if (out.recent.length < keep) out.recent.push({ at: a.at, sessionId: a.sessionId, cwd: a.cwd, event: a.event, text: a.text, file: a.file })
  }
  out.now = out.recent[0]
  return out
}

/** Keeps the activity files small: the last lines only, now and then (the app does it, never a hook). */
export function trimActivity(account: AccountId, maxBytes = 600 * 1024, keepLines = 400): void {
  const f = activityFile(account)
  try {
    if (statSync(f).size <= maxBytes) return
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean)
    writeFileSync(f, lines.slice(-keepLines).join('\n') + '\n')
  } catch { /* busy: next time */ }
}

// ---- files with a note of the user ----------------------------------------------------------------------------------

export const keptDir = () => join(paths.root(), 'kept')
export const protectedFile = () => join(paths.root(), 'protected.json')
const KEEP_LIMIT = 400 << 20

/** Copies the file as it is now (one copy per version), so the note keeps showing what the user saw. */
export function keepCopy(assetId: number, file: string, mtime: number): string | undefined {
  try {
    const st = statSync(file)
    if (st.size > KEEP_LIMIT) return undefined
    mkdirSync(keptDir(), { recursive: true })
    const target = join(keptDir(), `${assetId}-${mtime}${extname(file).toLowerCase()}`)
    if (!existsSync(target)) copyFileSync(file, target)
    return target
  } catch {
    return undefined
  }
}

/** Writes the list of noted files for the hooks (one cheap read per tool call). */
export function writeProtected(db: DB): number {
  const rows = db
    .prepare(`SELECT DISTINCT a.path FROM assets a JOIN comments c ON c.asset_id = a.id WHERE c.status != 'aprobado'`)
    .all() as { path: string }[]
  try {
    writeFileSync(protectedFile(), JSON.stringify({ at: Date.now(), files: rows.map((r) => r.path) }))
  } catch { /* next change */ }
  return rows.length
}

export function readProtected(): string[] {
  try {
    return (JSON.parse(readFileSync(protectedFile(), 'utf8')).files as string[]) ?? []
  } catch {
    return []
  }
}

const norm = (p: string) => p.split('/').join('\\').toLowerCase()
const DELETE_WORDS = /(^|[\s;&|(])(rm|del|erase|rmdir|remove-item|ri|unlink)\b|os\.remove|\.unlink\(|shutil\.rmtree/i

// ---- EV80: the user's hard rules («no toques X»), enforced before the tool runs, not only said ----------------------------

export const rulesFile = () => join(paths.root(), 'rules.json')

/**
 * What a rule forbids touching: «no toques `tools/unity.ps1`», «No borres la carpeta Assets/Art», «nunca modifiques
 * settings.local.json». Only something that looks like a file or a folder (a dot, a slash or quotes): a rule about a
 * way of working («no toques nada sin probarlo») is said, not enforced.
 */
export function hardRuleTargets(text: string): string[] {
  const out: string[] = []
  const re = /\b(?:no|nunca)\s+(?:toques|toquéis|borres|borréis|modifiques|cambies|edites|sobrescribas|tocar|borrar|modificar)\s+(?:nunca\s+)?(?:el |la |los |las )?(?:archivo |fichero |carpeta |script )?(?:[«"`']([^«»"`']{3,120})[»"`']|(\S{3,120}))/gi
  for (const m of text.matchAll(re)) {
    const quoted = m[1]?.trim()
    const bare = m[2]?.replace(/[.,;:)]+$/, '')
    const t = quoted ?? bare
    if (t && (quoted || /[./\\]/.test(t))) out.push(t)
  }
  return out
}

export function writeRules(db: DB): number {
  let rows: { text: string }[] = []
  try { rows = db.prepare("SELECT text FROM memories WHERE kind = 'regla' AND gone = 0").all() as { text: string }[] } catch { /* no memories yet */ }
  const rules = rows.flatMap((r) => hardRuleTargets(r.text).map((target) => ({ target, text: r.text.slice(0, 300) })))
  try { writeFileSync(rulesFile(), JSON.stringify({ at: Date.now(), rules })) } catch { /* next change */ }
  return rules.length
}

export function readRules(): { target: string; text: string }[] {
  try { return (JSON.parse(readFileSync(rulesFile(), 'utf8')).rules as { target: string; text: string }[]) ?? [] } catch { return [] }
}

const CHANGE_WORDS = /(^|[\s;&|(])(rm|del|erase|rmdir|mv|move|ren|rename|remove-item|move-item|rename-item|set-content|out-file|clear-content|add-content|ri|unlink|sed\s+-i|git\s+(checkout|restore|reset|clean|rm|mv))\b|>{1,2}|os\.remove|\.unlink\(|shutil\.rmtree|writeFileSync|copy-item|copy\s|cp\s/i

/** A tool call that would change or delete what a hard rule protects: the reason the Claude reads, or undefined. */
export function guardRules(data: any, rules = readRules()): string | undefined {
  if (!rules.length) return undefined
  const tool = String(data?.tool_name ?? '')
  const input = data?.tool_input ?? {}
  const n = (s: string) => s.split('/').join('\\').toLowerCase()
  const said = (r: { target: string; text: string }) => `Mission Control: regla del usuario («${r.text}»). No se puede cambiar ni borrar ${r.target}: si de verdad hace falta, pregúntaselo con pmc decide y sigue con otra cosa.`
  const target = input.file_path ?? input.notebook_path
  if (target && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const t = n(String(target))
    const hit = rules.find((r) => t.includes(n(r.target)))
    return hit ? said(hit) : undefined
  }
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string' && CHANGE_WORDS.test(input.command)) {
    const cmd = n(input.command)
    const hit = rules.find((r) => cmd.includes(n(r.target)))
    return hit ? said(hit) : undefined
  }
  return undefined
}

/**
 * Whether a tool call would overwrite or delete a noted file: Write/Edit on it, or a delete command naming it. The
 * reason is what the Claude reads. Copies over it by a program (a capture with the same name) are not seen here;
 * the kept copy covers those.
 */
export function guardProtected(data: any, files = readProtected()): string | undefined {
  if (!files.length) return undefined
  const tool = String(data?.tool_name ?? '')
  const input = data?.tool_input ?? {}
  const reason = (f: string) => `Mission Control: ${basename(f)} tiene una nota del usuario y no se puede sobrescribir ni borrar. Guarda la versión nueva con otro nombre (por ejemplo ${basename(f, extname(f))}_v2${extname(f)}) y sigue.`
  const target = input.file_path ?? input.notebook_path
  if (target && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const t = norm(String(target))
    const hit = files.find((f) => norm(f) === t)
    return hit ? reason(hit) : undefined
  }
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string' && DELETE_WORDS.test(input.command)) {
    const cmd = input.command.toLowerCase()
    const hit = files.find((f) => basename(f).length >= 6 && cmd.includes(basename(f).toLowerCase()))
    return hit ? reason(hit) : undefined
  }
  return undefined
}
