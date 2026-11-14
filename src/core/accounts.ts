// The four accounts and what can be known about each without touching their login: the expected email (from the
// user's launchers), the email the folder is logged in with (oauthAccount in .claude.json) and whether a credentials
// file exists. The credentials file itself is never opened.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountConfig, AccountId, AccountIdentity, AccountUsage, LimitHit, UsageSnapshot } from './types'
import { home, nativePath, pathKey, paths } from './paths'
import { limitDirs } from './thispc'
import { parseCreditsFile, parseWakeLog } from './parse/limits'
import { configDirOf } from './sessions'
import { planOf, type LoginState } from './logins'

export const DEFAULT_ACCOUNTS: AccountConfig[] = [
  { id: 'claude1', alias: 'Principal', configDir: '', color: '#FF9F0A' },
  { id: 'claude2', alias: 'Secundaria', configDir: join(home(), '.claude-segunda'), color: '#0A84FF' },
  { id: 'claude3', alias: 'Tercera', configDir: join(home(), '.claude-tercera'), color: '#BF5AF2' },
  { id: 'claude4', alias: 'Cuarta', configDir: join(home(), '.claude-cuarta'), color: '#30D158' }
]

/** The accounts as the app last saved them (Ajustes › Cuentas), for the CLI, which never opens the database for this. */
export function configuredAccounts(): AccountConfig[] {
  try {
    const list = JSON.parse(readFileSync(join(paths.root(), 'accounts.json'), 'utf8'))
    if (Array.isArray(list) && list.length && list.every((a) => typeof a?.id === 'string')) return list as AccountConfig[]
  } catch { /* the app has not written it yet */ }
  return DEFAULT_ACCOUNTS
}

export function accountFromConfigDir(dir: string | undefined): AccountId {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').split('/').join('\\').toLowerCase()
  if (dir) {
    const hit = configuredAccounts().find((a) => a.configDir && norm(a.configDir) === norm(dir))
    if (hit) return hit.id
  }
  const leaf = (dir ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase()
  if (leaf === '.claude-segunda') return 'claude2'
  if (leaf === '.claude-tercera') return 'claude3'
  if (leaf === '.claude-cuarta') return 'claude4'
  return 'claude1'
}

const identityCache = new Map<string, { mtime: number; email?: string }>()
let loginsCache: { mtime: number; all: Record<string, LoginState> } | undefined

/** EV146: what `claude auth status` said of each account last time the app asked (logins.json; no e-mail in it). */
export function readLogins(): Record<string, LoginState> {
  try {
    const st = statSync(paths.logins())
    // A BOM (Windows editors, PowerShell's Set-Content) would make it unreadable.
    if (loginsCache?.mtime !== st.mtimeMs) loginsCache = { mtime: st.mtimeMs, all: JSON.parse(readFileSync(paths.logins(), 'utf8').replace(/^﻿/, '')) }
    return loginsCache.all
  } catch { return {} }
}

export function readIdentity(acc: AccountConfig): AccountIdentity {
  const json = acc.configDir ? join(acc.configDir, '.claude.json') : join(home(), '.claude.json')
  const cred = acc.configDir ? join(acc.configDir, '.credentials.json') : join(home(), '.claude', '.credentials.json')
  let email: string | undefined
  try {
    const st = statSync(json)
    const c = identityCache.get(json)
    if (c && c.mtime === st.mtimeMs) email = c.email
    else {
      const j = JSON.parse(readFileSync(json, 'utf8'))
      email = j?.oauthAccount?.emailAddress
      identityCache.set(json, { mtime: st.mtimeMs, email })
    }
  } catch { /* not logged in yet */ }
  // EV146: a Console sign-in, a key or a cloud provider leave no credentials file; `claude auth status` says it instead.
  const login = readLogins()[acc.id]
  const plan = planOf(login)
  return {
    email,
    // macOS: Claude Code keeps the sign-in in the Keychain, never in a file; the account's e-mail in .claude.json says it.
    hasLogin: existsSync(cred) || login?.loggedIn === true || (process.platform === 'darwin' && Boolean(email)),
    ...(plan ? { plan } : {}),
    emailMismatch: Boolean(email && acc.emailExpected && email.toLowerCase() !== acc.emailExpected.toLowerCase())
  }
}

/** An account with a login on this PC that Mission Control does not follow yet. */
export interface FoundAccount {
  /** The number its launcher gives it: launchers go by number, so another number would open another account. */
  id?: AccountId
  alias: string
  configDir: string
  email?: string
  /** EV146: false when the folder has no credentials file; a Console, key or cloud sign-in leaves none, so the app asks `claude auth status`. */
  signedIn?: boolean
}

/**
 * Looks in the launchers (claude-accesos\\claudeN.cmd) and the ~\\.claude-* folders. The credentials file is never opened.
 * `withoutLogin`: also the folders with no credentials file (marked signedIn: false), for the app to ask Claude Code.
 */
export function detectAccounts(known: Pick<AccountConfig, 'id' | 'configDir'>[], dir = home(), opts: { withoutLogin?: boolean } = {}): FoundAccount[] {
  const key = (p: string) => pathKey(p)
  const followed = new Set(known.map((a) => key(a.configDir || join(dir, '.claude'))))
  const taken = new Set(known.map((a) => a.id))
  const found = new Map<string, FoundAccount>()
  const alias = (folder: string) => {
    const name = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!.replace(/^\.claude-?/, '') || 'Cuenta'
    return name[0].toUpperCase() + name.slice(1)
  }
  const list = (d: string) => { try { return readdirSync(d) } catch { return [] as string[] } }
  for (const file of list(join(dir, 'claude-accesos'))) {
    const n = /^claude(\d+)\.cmd$/i.exec(file)
    if (!n) continue
    let text = ''
    try { text = readFileSync(join(dir, 'claude-accesos', file), 'utf8') } catch { continue }
    const m = /CLAUDE_CONFIG_DIR=([^"\r\n]+)/i.exec(text)
    if (!m) continue
    // A launcher writes its folder Windows' way; on another system it is read with that system's separator.
    const configDir = nativePath(m[1].trim().replace(/%USERPROFILE%/gi, dir).split('\\').join('/'))
    const id = `claude${n[1]}` as AccountId
    found.set(key(configDir), { id: taken.has(id) ? undefined : id, alias: alias(configDir), configDir })
  }
  for (const name of list(dir)) {
    if (!/^\.claude-/.test(name)) continue
    const configDir = join(dir, name)
    if (!found.has(key(configDir))) found.set(key(configDir), { alias: alias(configDir), configDir })
  }
  const number = (f: FoundAccount) => (f.id ? Number(f.id.slice(6)) : Infinity)
  return [...found.entries()]
    .filter(([k]) => !followed.has(k))
    .map(([, f]) => ({ f, who: readIdentity({ id: 'claude0' as AccountId, alias: '', configDir: f.configDir, color: '' }) }))
    .filter((x) => x.who.hasLogin || opts.withoutLogin)
    .map((x) => ({ ...x.f, email: x.who.email, ...(x.who.hasLogin ? {} : { signedIn: false }) }))
    .sort((a, b) => number(a) - number(b))
}

export function readUsageSnapshot(account: AccountId): UsageSnapshot | undefined {
  try {
    return JSON.parse(readFileSync(paths.usageFile(account), 'utf8')) as UsageSnapshot
  } catch {
    return undefined
  }
}

export type UsageReading = { at: number; five?: number; week?: number; fiveResets?: number; weekResets?: number }

/**
 * How much of its week an account spent over some readings: what went up between one reading and the next of the same
 * week. A recharge in the middle (96 % → 1 %) no longer cancels what was spent (13-11: «Claude 1 gastó 0 % de su
 * semana» after spending its whole week and being recharged). Undefined with fewer than two readings.
 */
export function weekSpent(h: UsageReading[]): number | undefined {
  const r = h.filter((x) => typeof x.week === 'number')
  if (r.length < 2) return undefined
  let spent = 0
  for (let i = 1; i < r.length; i++) {
    const d = r[i].week! - r[i - 1].week!
    if (d > 0 && r[i].weekResets === r[i - 1].weekResets) spent += d
  }
  return Math.round(spent)
}

/** EV115: each rebuild of the accounts read every account's whole reading history (about 150 KB each); now only when it changed. */
const usageHistoryCache = new Map<string, { mtime: number; size: number; rows: UsageReading[] }>()

export function readUsageHistory(account: AccountId, sinceMs: number): UsageReading[] {
  const file = paths.usageHistory(account)
  try {
    const st = statSync(file)
    let c = usageHistoryCache.get(file)
    if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
      const rows: UsageReading[] = []
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue
        try {
          const j = JSON.parse(line)
          rows.push({ at: j.at, five: j.five, week: j.week, fiveResets: j.fiveResets, weekResets: j.weekResets })
        } catch { /* partial */ }
      }
      c = { mtime: st.mtimeMs, size: st.size, rows }
      usageHistoryCache.set(file, c)
    }
    return c.rows.filter((r) => r.at >= sinceMs)
  } catch {
    return []
  }
}

/**
 * Limits recorded by the game project's wake hook. Its credits_<account>.txt names the account after the settings folder and
 * took any folder it did not know for claude1 (claude6's limit of 7-11 at 08:09 landed in credits_claude1.txt), and a
 * wake.log line only has the session. Both are checked against the folders that really ran the session.
 */
export function readLimits(owners: Map<string, { account: AccountId }>, accounts: AccountConfig[] = configuredAccounts()): Map<AccountId, LimitHit[]> {
  const by = new Map<AccountId, LimitHit[]>()
  const push = (a: AccountId, h: LimitHit) => {
    const arr = by.get(a) ?? []
    arr.push(h)
    by.set(a, arr)
  }
  const ranIt = sessionEnvIndex(accounts)
  const attribute = (claimed: AccountId | undefined, short: string | undefined): AccountId | undefined => {
    const ran = short ? ranIt(short) : []
    return ran.length && (!claimed || !ran.includes(claimed)) ? ran[0] : claimed
  }
  const shortOwner = new Map<string, AccountId>()
  for (const [sid, o] of owners) shortOwner.set(sid.slice(0, 8), o.account)
  // EV129: which folders, from este-pc.json (a project's own hook; none by default).
  for (const dir of limitDirs()) {
    let ids: AccountId[] = []
    try { ids = readdirSync(dir).map((f) => f.match(/^credits_(claude\d{1,2})\.txt$/)?.[1]).filter(Boolean) as AccountId[] } catch { /* none */ }
    for (const id of ids) {
      try {
        const h = parseCreditsFile(readFileSync(join(dir, `credits_${id}.txt`), 'utf8'))
        const a = h && attribute(id, h.sessionShort)
        if (h && a) push(a, h)
      } catch { /* none */ }
    }
    try {
      for (const h of parseWakeLog(readFileSync(join(dir, 'wake.log'), 'utf8'))) {
        const a = attribute(h.sessionShort ? shortOwner.get(h.sessionShort) : undefined, h.sessionShort)
        if (a) push(a, h)
      }
    } catch { /* none */ }
  }
  for (const arr of by.values()) arr.sort((a, b) => b.at - a.at)
  return by
}

/**
 * Claude Code keeps a session-env/<session id> folder in the settings folder of the account that runs a conversation
 * (the conversations themselves are shared). Gives, for a session's first 8 characters, the accounts that ran it, the
 * most recent first.
 */
function sessionEnvIndex(accounts: AccountConfig[]): (short: string) => AccountId[] {
  let index: Map<string, { id: AccountId; dir: string }[]> | undefined
  return (short) => {
    if (!index) {
      index = new Map()
      for (const acc of accounts) {
        const dir = join(configDirOf(acc), 'session-env')
        let names: string[] = []
        try { names = readdirSync(dir) } catch { continue }
        for (const n of names) {
          const k = n.slice(0, 8)
          index.set(k, [...(index.get(k) ?? []), { id: acc.id, dir: join(dir, n) }])
        }
      }
    }
    const hits = index.get(short) ?? []
    if (hits.length < 2) return hits.map((h) => h.id)
    const mtime = (p: string) => { try { return statSync(p).mtimeMs } catch { return 0 } }
    return hits.map((h) => ({ id: h.id, t: mtime(h.dir) })).sort((a, b) => b.t - a.t).map((h) => h.id)
  }
}

/**
 * Puts together what is known about an account's usage. A limit counts as active while its reset is in the future,
 * unless the account demonstrably worked after it (a reply that was not a limit error).
 */
export function buildUsage(
  account: AccountId,
  limits: LimitHit[],
  lastGoodActivityAt: number | undefined,
  now: number,
  /** When the user said «La he recargado»: nothing tells it before the account's first reply, so his word clears older limits. */
  rechargedAt?: number
): AccountUsage {
  const snapshot = readUsageSnapshot(account)
  const all = [...limits]
  // A window the status line read at 100 % is a limit with its exact reset. Without it an account that ran out outside
  // The game project (the only project with the wake hook) showed "sin uso" with no return time and went last in Próximo.
  if (snapshot)
    for (const [w, kind] of [[snapshot.fiveHour, '5 horas'], [snapshot.sevenDay, 'semanal']] as const)
      if (w && w.usedPct >= 100 && w.resetsAt)
        all.push({ at: snapshot.capturedAt, resetsAt: w.resetsAt, kind, sessionShort: snapshot.sessionId?.slice(0, 8), source: 'statusline' })
  all.sort((a, b) => b.at - a.at)
  const lastLimit = all[0]
  const history = readUsageHistory(account, now - 8 * 86400_000)
  let activeLimit: LimitHit | undefined
  for (const l of all) {
    if (l.resetsAt <= now) continue
    if (rechargedAt && rechargedAt > l.at) continue
    // Only real work after the limit clears it. A status line reading is not enough: an old, finished session repaints
    // its last known (pre-limit) percentages, which is how claude4 showed 37 % with its week used up (2-11).
    if (lastGoodActivityAt && lastGoodActivityAt > l.at + 120_000) continue
    // Work that left a trace once its windows were closed counts too (11-11: claude6 ran out of its week at 00:46, got
    // the week back at 11:32, worked until its 5 hours ran out at 14:06, and still showed "semanal agotado" until Friday).
    if (workedAfter(l, all, history)) continue
    if (!activeLimit || l.resetsAt > activeLimit.resetsAt) activeLimit = l
  }
  return { snapshot, activeLimit, lastLimit, history }
}

const FIVE_HOURS = 5 * 3600_000

/**
 * Proof that the account worked after a limit, with no conversation open: (1) a later 5-hour limit whose whole window
 * began after it (that window was filled by new work), or (2) the status line watching that window's use go up through
 * at least three readings below 100 %. One stale session repaints a single figure; two alternate between two.
 */
// (3) One reading below 100 % whose 5-hour window began after the limit: that window only exists because the API answered
// after it, so the figure is new (12-11: the user topped up claude3's week and it was still told "0 % de la semana"). A
// stale session repaints the window it had before the limit, so it cannot pass for this.
export function workedAfter(l: LimitHit, all: LimitHit[], history: UsageReading[]): boolean {
  const after = l.at + 120_000
  if (all.some((h) => h.kind === '5 horas' && h.at > after && h.resetsAt - FIVE_HOURS > after)) return true
  const field = l.kind === 'semanal' ? 'week' : l.kind === '5 horas' ? 'five' : undefined
  if (!field) return false
  if (history.some((x) => x.at > after && typeof x[field] === 'number' && x[field]! < 100 && typeof x.fiveResets === 'number' && x.fiveResets - FIVE_HOURS > after)) return true
  const seen =history.filter((x) => x.at > after).map((x) => x[field]).filter((v): v is number => typeof v === 'number' && v < 100)
  let rises = 0
  for (let i = 1; i < seen.length; i++) if (seen[i] > seen[i - 1]) rises++
  return rises >= 2 && new Set(seen).size >= 3
}
