import { t } from './i18n'
// Sessions of Claude Code, from documented or plain-file sources only:
//   - `claude agents --json` with each account's CLAUDE_CONFIG_DIR: live sessions (documented, "for scripting").
//   - <configDir>/history.jsonl: which account typed into which conversation (local prompt history).
//   - projects/<cwd>/<session>.jsonl: the tail of the conversation, for model, title and last activity. Read only.
import { execFile } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, fstatSync, readdirSync, statSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountConfig, AccountId, LimitHit, LiveSession } from './types'
import { home } from './paths'
import { limitFromTranscriptEntry } from './parse/limits'

export function configDirOf(acc: AccountConfig): string {
  return acc.configDir || join(home(), '.claude')
}

/**
 * Markers a Claude Code session puts in the environment of what it runs. Inherited by a new `claude`, they make it
 * believe it is a child session and it stops saving its conversation ("Transcript saving is off").
 */
export const INHERITED_CLAUDE_VARS = [
  'CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SKIP_PROMPT_HISTORY', 'AI_AGENT'
]

export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  for (const k of INHERITED_CLAUDE_VARS) delete out[k]
  return out
}

export function envFor(acc: AccountConfig): NodeJS.ProcessEnv {
  const env = cleanEnv(process.env)
  if (acc.configDir) env.CLAUDE_CONFIG_DIR = acc.configDir
  else delete env.CLAUDE_CONFIG_DIR
  return env
}

let claudeExe: string | undefined
/** Claude Code's program, or undefined when this PC does not have it (EV126: a newcomer installs it from Primeros pasos). */
export function claudeInstalled(): string | undefined {
  if (claudeExe) return claudeExe
  const candidates = [join(home(), '.local', 'bin', 'claude.exe'), join(home(), '.local', 'bin', 'claude')]
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (dir) candidates.push(join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'))
  }
  // Only a found one is kept: installed while the app is open, it is seen at the next look without restarting it.
  claudeExe = candidates.find((c) => existsSync(c))
  return claudeExe
}

export function findClaude(): string {
  return claudeInstalled() ?? 'claude'
}

export interface AgentsJsonRow {
  pid?: number
  id?: string
  cwd: string
  kind?: string
  startedAt?: number
  sessionId: string
  name?: string
  status?: string
  state?: string
  waitingFor?: string
}

export function listAgents(acc: AccountConfig, timeoutMs = 20000): Promise<AgentsJsonRow[]> {
  // EV157: the demo pictures (scripts/demo.mjs) show invented sessions; only ever in capture mode, never on real data.
  if (process.env.PMC_SHOT_DIR && process.env.PMC_DEMO_AGENTS) {
    try { return Promise.resolve((JSON.parse(readFileSync(process.env.PMC_DEMO_AGENTS, 'utf8'))[acc.id] ?? []) as AgentsJsonRow[]) } catch { return Promise.resolve([]) }
  }
  return new Promise((resolve, reject) => {
    const child = execFile(findClaude(), ['agents', '--json'], { env: envFor(acc), timeout: timeoutMs, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) return reject(new Error(err.message.split('\n')[0]))
      const text = stdout.trim()
      const start = text.indexOf('[')
      if (start < 0) return reject(new Error(t('Respuesta sin lista de sesiones')))
      try {
        resolve(JSON.parse(text.slice(start)) as AgentsJsonRow[])
      } catch (e) {
        reject(new Error(t('No se pudo leer la lista de sesiones')))
      }
    })
    child.stdin?.end()
  })
}

export function toLiveSession(r: AgentsJsonRow): LiveSession {
  return {
    sessionId: r.sessionId,
    shortId: (r.id ?? r.sessionId).slice(0, 8),
    pid: r.pid,
    cwd: r.cwd,
    kind: r.kind === 'background' ? 'background' : 'interactive',
    name: r.name,
    status: r.status,
    state: r.state,
    waitingFor: r.waitingFor,
    startedAt: r.startedAt
  }
}

// ---- history.jsonl: session -> account, and the user's own prompts -------------------------------------------------

export interface PromptRecord {
  account: AccountId
  at: number
  text: string
  project?: string
  sessionId?: string
}

const historyCache = new Map<string, { mtime: number; rows: PromptRecord[] }>()

export function readHistory(acc: AccountConfig): PromptRecord[] {
  const file = join(configDirOf(acc), 'history.jsonl')
  let st
  try { st = statSync(file) } catch { return [] }
  const cached = historyCache.get(file)
  if (cached && cached.mtime === st.mtimeMs) return cached.rows
  const rows: PromptRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line) as { display?: string; timestamp?: number; project?: string; sessionId?: string }
      if (typeof j.timestamp !== 'number') continue
      rows.push({ account: acc.id, at: j.timestamp, text: String(j.display ?? ''), project: j.project, sessionId: j.sessionId })
    } catch { /* partial line */ }
  }
  historyCache.set(file, { mtime: st.mtimeMs, rows })
  return rows
}

/** For each conversation, the account that typed into it last (conversations are shared between accounts). */
export function sessionOwners(accounts: AccountConfig[]): Map<string, { account: AccountId; at: number }> {
  const owners = new Map<string, { account: AccountId; at: number }>()
  for (const acc of accounts) {
    for (const r of readHistory(acc)) {
      if (!r.sessionId) continue
      const prev = owners.get(r.sessionId)
      if (!prev || r.at > prev.at) owners.set(r.sessionId, { account: acc.id, at: r.at })
    }
  }
  return owners
}

// ---- conversation tail ---------------------------------------------------------------------------------------------

export function projectsDir(): string {
  return join(home(), '.claude', 'projects')
}

export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

let dirsCache: { at: number; dirs: string[] } | undefined

/**
 * Every folder where Claude Code keeps conversations: ~/.claude/projects and each account's own (`~/.claude-*` and any
 * configDir given). Folders linked to one already listed count once. 13-11: Claude 5 keeps its own, not linked, and the
 * app read none of its conversations (no title, last activity or limit message; in Chats its windows showed no text and
 * «hace 10 horas», when it was opened, while it was working).
 */
export function projectsDirs(extra: string[] = []): string[] {
  const now = Date.now()
  if (!dirsCache || now - dirsCache.at > 60_000) {
    const found = [projectsDir()]
    try { for (const n of readdirSync(home())) if (/^\.claude-[\w.-]+$/.test(n)) found.push(join(home(), n, 'projects')) } catch { /* no home */ }
    dirsCache = { at: now, dirs: found }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of [...extra.map((c) => join(c, 'projects')), ...dirsCache.dirs]) {
    let real: string
    try { real = realpathSync(d).toLowerCase() } catch { continue }
    if (!seen.has(real)) { seen.add(real); out.push(d) }
  }
  return out
}

const transcriptCache = new Map<string, string>()

/** The file of a conversation, in whichever account's folder it is (`configDir` first when known). */
export function findTranscript(sessionId: string, cwd?: string, configDir?: string): string | undefined {
  const known = transcriptCache.get(sessionId)
  if (known && existsSync(known)) return known
  const bases = projectsDirs(configDir ? [configDir] : [])
  const hit = (f: string) => { transcriptCache.set(sessionId, f); return f }
  if (cwd) {
    for (const base of bases) {
      const direct = join(base, encodeCwd(cwd), `${sessionId}.jsonl`)
      if (existsSync(direct)) return hit(direct)
    }
  }
  for (const base of bases) {
    try {
      for (const d of readdirSync(base)) {
        const f = join(base, d, `${sessionId}.jsonl`)
        if (existsSync(f)) return hit(f)
      }
    } catch { /* no projects dir */ }
  }
  return undefined
}

export interface TranscriptTail {
  lastActivityAt?: number
  model?: string
  title?: string
  lastPrompt?: string
  branch?: string
  cwd?: string
  rateLimited: boolean
  /** EV146: the last reply was «out of credit» (a key or Console account, `billing_error`): stopped like at a limit, with no reset. */
  noCredit?: boolean
  /** When the last reply was a usage-limit message: when it came and the reset the API gave with it. */
  limit?: LimitHit
  lastAssistantText?: string
  size: number
  mtime: number
}

function readTail(file: string, bytes: number): { text: string; size: number; mtime: number } {
  const fd = openSync(file, 'r')
  try {
    const st = fstatSync(fd)
    const n = Math.min(st.size, bytes)
    const buf = Buffer.alloc(n)
    readSync(fd, buf, 0, n, st.size - n)
    return { text: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs }
  } finally {
    closeSync(fd)
  }
}

/** `parsedTo`: the byte just after the last whole line read (a line still being written is read next time). */
const tailCache = new Map<string, { mtime: number; size: number; parsedTo: number; tail: TranscriptTail }>()

interface TailSeen { title: boolean; prompt: boolean; act: boolean; branch: boolean; cwd: boolean; assistant: boolean }
const unseen = (): TailSeen => ({ title: false, prompt: false, act: false, branch: false, cwd: false, assistant: false })

/** Lines from the newest back: each field takes the newest value there (the first found); `seen` says which were found. */
function scanTail(lines: string[], tail: TranscriptTail, seen: TailSeen): void {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (!l || l[0] !== '{') continue
    // EV115: a picture read in the conversation is one line of 1-2 MB (base64); parsing it only for its time held the app.
    // The lines around it say the same (13-11: «cuentas 435 ms» after Claudes read screenshots).
    if (l.length > 200_000) continue
    let j: any
    try { j = JSON.parse(l) } catch { continue }
    if (j.type === 'custom-title' || j.type === 'agent-name') {
      if (!seen.title) { seen.title = true; tail.title = j.type === 'custom-title' ? j.customTitle : j.agentName }
    } else if (j.type === 'last-prompt') {
      if (!seen.prompt) { seen.prompt = true; tail.lastPrompt = j.lastPrompt }
    } else if (j.type === 'assistant' || j.type === 'user') {
      const t = Date.parse(j.timestamp)
      if (!seen.act && Number.isFinite(t)) { seen.act = true; tail.lastActivityAt = t }
      if (!seen.branch && j.gitBranch) { seen.branch = true; tail.branch = j.gitBranch }
      if (!seen.cwd && j.cwd) { seen.cwd = true; tail.cwd = j.cwd }
      if (j.type === 'assistant' && !seen.assistant && !j.isSidechain) {
        seen.assistant = true
        tail.model = j.message?.model
        tail.noCredit = j.error === 'billing_error' || /"error":"billing_error"/.test(l) || undefined
        tail.rateLimited = j.error === 'rate_limit' || /"error":"rate_limit"/.test(l) || Boolean(tail.noCredit)
        tail.limit = tail.rateLimited && !tail.noCredit ? limitFromTranscriptEntry(j) : undefined
        const content = j.message?.content
        const txt = Array.isArray(content) ? content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join(' ').trim() : ''
        tail.lastAssistantText = txt ? txt.slice(0, 500) : undefined
      }
      if (j.type === 'user' && !seen.prompt && typeof j.message?.content === 'string' && !j.isSidechain) {
        seen.prompt = true
        tail.lastPrompt = j.message.content.slice(0, 400)
      }
    }
    if (seen.assistant && seen.title && seen.prompt && seen.branch) break
  }
}

/** The bytes of a file from `from` to `to`. */
function readRange(file: string, from: number, to: number): Buffer {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.max(0, to - from))
    readSync(fd, buf, 0, buf.length, from)
    return buf
  } finally {
    closeSync(fd)
  }
}

export function readTranscriptTail(file: string): TranscriptTail | undefined {
  let st
  try { st = statSync(file) } catch { return undefined }
  const c = tailCache.get(file)
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.tail
  // EV115: a conversation at work only grows: only what was added since the last read is read (13-11: re-reading 384 KB
  // of every working conversation on each rebuild of the accounts held the app up to 358 ms). Newer lines win.
  if (c && st.size > c.size && st.size - c.parsedTo <= 2 << 20) {
    const buf = readRange(file, c.parsedTo, st.size)
    const end = buf.lastIndexOf(10)
    const tail: TranscriptTail = { ...c.tail, size: st.size, mtime: st.mtimeMs }
    if (end >= 0) scanTail(buf.subarray(0, end).toString('utf8').split('\n'), tail, unseen())
    if (tail.model === '<synthetic>') tail.model = undefined
    tailCache.set(file, { mtime: st.mtimeMs, size: st.size, parsedTo: c.parsedTo + end + 1, tail })
    return tail
  }
  const tail: TranscriptTail = { rateLimited: false, size: st.size, mtime: st.mtimeMs }
  const seen = unseen()
  let parsedTo = st.size
  for (const bytes of [384 << 10, 3 << 20]) {
    const { text } = readTail(file, bytes)
    const lines = text.split('\n')
    if (bytes < st.size) lines.shift() // first line is cut
    // A last line still being written is not read now: the next read starts from it.
    parsedTo = st.size - Buffer.byteLength(text.slice(text.lastIndexOf('\n') + 1))
    scanTail(lines, tail, seen)
    if (seen.assistant || bytes >= st.size) break
  }
  if (tail.model === '<synthetic>') tail.model = undefined
  tailCache.set(file, { mtime: st.mtimeMs, size: st.size, parsedTo, tail })
  return tail
}

/** Saved conversations of one working folder, newest first (resumable with `claude --resume`). */
export function savedSessions(cwd: string, limit = 30): { sessionId: string; file: string; mtime: number; size: number }[] {
  // From every account's folder (projectsDirs): the ones in an account's own, unlinked folder were missing.
  const out: { sessionId: string; file: string; mtime: number; size: number }[] = []
  for (const base of projectsDirs()) {
    const dir = join(base, encodeCwd(cwd))
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue
        const st = statSync(join(dir, f))
        out.push({ sessionId: f.slice(0, -6), file: join(dir, f), mtime: st.mtimeMs, size: st.size })
      }
    } catch { /* not in this account's folder */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}
