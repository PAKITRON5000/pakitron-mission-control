import { t } from '../core/i18n'
// The local service inside the app: keeps the database current from the real sources on timers, and answers the
// interface. Reads are cheap and incremental (mtime checks); nothing here spends any account's usage.
import { fitTeam, settingsFor, teamAdvice } from '../core/workmode'
import { linkRecentCorrections } from '../core/changes'
import { EventEmitter } from 'node:events'
import { existsSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AccountActivity, AccountConfig, AccountId, AgentCard, CopyStatus, ProjectConfig, Settings, Task } from '../core/types'
import { activityDir, readActivity, trimActivity, writeProtected, writeRules } from '../core/live'
import { pendingDecisionCount } from '../core/decisions'
import { home } from '../core/paths'
import { openDb, backupDb, getSetting, setSetting, addEvent, type DB } from '../core/db'
import { DEFAULT_ACCOUNTS, readLimits, detectAccounts, readIdentity } from '../core/accounts'
import { isStalled, STALL_MS } from '../core/pace'
import { listAgents, sessionOwners, savedSessions, readTranscriptTail } from '../core/sessions'
import { detectProject, loadProjects, saveProject, refreshProjectCopies, copyStatus, recentCommits, commitsSince, projectForPath, forgetProject, settingsWithoutProject, dropOrphanAssets, type Commit } from '../core/projects'
import { syncTasks, listTasks, buildAgents, describeBuildTimes, allHeartbeats, summarize, timeline, daySummary } from '../core/engine'
import type { SkillsTally } from '../core/skills'
import { scanMediaAsync, hashPending } from '../core/media'
import { listAssignments, pruneAssignments, seedAssignments } from '../core/coord'
import { modeOf } from '../core/workmode'
import { isSessionWorking } from '../core/working'
import { installNodeShim, installShims, nodeShimPath, shimDir } from '../core/shim'
import { applyPendingRestore } from '../core/restore'
import { codexChats, placeCodexChats } from '../core/astra'
import { statusLineState, hooksState, type StatusLineState } from '../core/integrations'
import { checkBuzonReceipts } from '../core/review'
import { isInside, nativePath, pathKey, paths } from '../core/paths'

export interface DashboardState {
  now: number
  projects: ProjectConfig[]
  activeProjectId: string
  summary?: ReturnType<typeof summarize>
  agents: AgentCard[]
  statusLine: Record<string, StatusLineState>
  hooks: Record<string, boolean>
  hooksOutdated: Record<string, boolean>
  nodeExe?: string
  enCurso?: string
  refreshedAt: Record<string, number>
  day?: ReturnType<typeof daySummary>
  /** EV133: the skills of the project on screen, for the board (counted in the background, never on opening it). */
  skills?: SkillsTally
  /** EV133: what the Claudes must not forget in the project on screen (its own and the ones for every project). */
  memories?: number
  settings: Settings
  dataDir: string
  /** What each account is doing now, from its hooks. */
  activity: Record<string, AccountActivity>
  decisionsPending: number
  /**
   * What waits for the user in every project, not only the one on screen (the user, 12-11: «si tengo abierto uno de los
   * dos y la pregunta es en el otro, a lo mejor no lo veo»): questions in Decidir, finished tasks and corrections.
   */
  pending: Record<string, { decisions: number; review: number; comments: number }>
  /** Corrections the Claudes have finished, waiting for the user's eye. */
  commentsToReview: number
  accounts: AccountConfig[]
  /** The floating window of the Claudes is open (the dock steps aside in the main window). */
  floating?: boolean
}

const NL = String.fromCharCode(10)
const BS = String.fromCharCode(92)

export class Service extends EventEmitter {
  db: DB
  accounts: AccountConfig[] = DEFAULT_ACCOUNTS
  projects: ProjectConfig[] = []
  agents: AgentCard[] = []
  live = new Map<AccountId, { rows?: any[]; at?: number; error?: string }>()
  copies = new Map<string, CopyStatus[]>()
  commits = new Map<string, Commit[]>()
  /** EV133: commits since midnight per project, counted by git in the background (refreshGit). */
  commitsToday = new Map<string, { since: number; n: number }>()
  tasks = new Map<string, Task[]>()
  docMtimes = new Map<string, number>()
  refreshedAt: Record<string, number> = {}
  timers: NodeJS.Timeout[] = []
  watchers: FSWatcher[] = []
  nodeExe?: string
  pmcPath = join(paths.binDir(), 'pmc.mjs')
  private pushTimer?: NodeJS.Timeout
  private activityTimer?: NodeJS.Timeout
  private busy = new Set<string>()
  /** EV169: projects removed while the app runs: a gallery scan that was half-way through one must not bring it back. */
  private removed = new Set<string>()
  activity: Record<string, AccountActivity> = {}
  /** EV133: skills per project (main/index.ts › tallySkills), kept in skills-tally.json so the board has them at once. */
  skillsTally: Record<string, SkillsTally> = (() => { try { return JSON.parse(readFileSync(join(paths.root(), 'skills-tally.json'), 'utf8')) } catch { return {} } })()

  constructor() {
    super()
    mkdirSync(paths.root(), { recursive: true })
    // A copy the user chose to restore (Ajustes › Datos) goes in before the database is opened (core/restore.ts).
    let restored: string | undefined
    try { restored = applyPendingRestore(paths.root(), paths.db()) } catch { /* the current database stays */ }
    this.db = openDb()
    if (restored) addEvent(this.db, { at: Date.now(), kind: 'aviso', title: t('Restaurada la copia de la base de datos {v0}', { v0: restored.split(/[\\/]/).pop() }), source: 'Mission Control' })
    const firstRun = !this.db.prepare("SELECT 1 FROM settings WHERE key = 'accounts'").get()
    this.accounts = getSetting(this.db, 'accounts', DEFAULT_ACCOUNTS)
    // EV97: the first time, every Claude Code folder of this PC with a sign-in is an account (here: .claude-quinta and
    // .claude-sexta were left out), and the default ones with no sign-in are not (at least one stays).
    if (firstRun) {
      try {
        for (const f of detectAccounts(this.accounts)) this.addAccount({ id: f.id, alias: f.alias, configDir: f.configDir, emailExpected: f.email })
        const signed = this.accounts.filter((a) => readIdentity(a).hasLogin)
        // With no sign-in anywhere (a PC with nothing yet), only the main one stays, waiting for its /login: the other
        // defaults were this PC's accounts, not a newcomer's (13-11, tried with an empty user folder).
        this.saveAccounts(signed.length ? signed : this.accounts.filter((a) => !a.configDir).slice(0, 1))
        // EV110: and the way of working that fits that many accounts (one: each on its own; two or more: each on its own
        // too until the user reads Anthropic's rules and turns the hand-over on, EV140).
        const advice = teamAdvice(Math.max(1, signed.length), false, false)
        this.setSettings({ ...settingsFor(advice.mode), maxFronts: advice.fronts, workModeBy: 'app' })
        this.log(`primer arranque: ${advice.title}`)
      } catch (e) { this.log(`primer arranque, cuentas: ${(e as Error).message}`) }
    } else if (this.settings.relayRulesAt == null) {
      // EV140 (Decidir #147 «B»): a PC that already had the app keeps working as it did; only new installs start with it off.
      this.setSettings({ relayRulesAt: Date.now() })
    }
    this.writeAccounts()
  }

  /** accounts.json: the same list for the CLI (hooks, pmc claim), which never opens the database for it. */
  private writeAccounts(): void {
    try {
      mkdirSync(paths.root(), { recursive: true })
      writeFileSync(join(paths.root(), 'accounts.json'), JSON.stringify(this.accounts, null, 1))
    } catch { /* next change */ }
  }

  private saveAccounts(list: AccountConfig[]): void {
    this.accounts = list
    setSetting(this.db, 'accounts', list)
    this.writeAccounts()
    for (const id of [...this.live.keys()]) if (!list.some((a) => a.id === id)) this.live.delete(id)
    void this.refreshAgents()
  }

  /** A new account: the next free number, its own config folder (created if missing; its login is done in a terminal). */
  addAccount(a: { id?: string; alias: string; configDir?: string; emailExpected?: string; color?: string }): AccountConfig {
    // An account found on the PC keeps its number: that number is the launcher that opens it.
    const wanted = a.id && /^claude\d+$/.test(a.id) && !this.accounts.some((x) => x.id === a.id) ? Number(a.id.slice(6)) : undefined
    const n = wanted ?? Math.max(0, ...this.accounts.map((x) => Number(x.id.slice(6)) || 0)) + 1
    const id = `claude${n}` as AccountId
    const slug = a.alias.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || String(n)
    const configDir = a.configDir?.trim() || join(home(), `.claude-${slug}`)
    if (this.accounts.some((x) => (x.configDir || '').toLowerCase() === configDir.toLowerCase())) throw new Error(t('Esa carpeta ya es de otra cuenta'))
    mkdirSync(configDir, { recursive: true })
    const palette = ['#FF9F0A', '#0A84FF', '#BF5AF2', '#30D158', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68', '#5E5CE6', '#FF6B8B']
    const acc: AccountConfig = { id, alias: a.alias.trim() || `Cuenta ${n}`, configDir, emailExpected: a.emailExpected?.trim() || undefined, color: a.color || palette[(n - 1) % palette.length] }
    this.saveAccounts([...this.accounts, acc])
    addEvent(this.db, { at: Date.now(), account: id, kind: 'cuenta', title: t('Cuenta añadida: Claude {n} ({alias})', { n: n, alias: acc.alias }), detail: configDir, source: 'Mission Control' })
    return acc
  }

  updateAccount(id: AccountId, patch: Partial<AccountConfig>): AccountConfig {
    const cur = this.accounts.find((a) => a.id === id)
    if (!cur) throw new Error(t('Cuenta desconocida'))
    const next = { ...cur, ...patch, id: cur.id }
    this.saveAccounts(this.accounts.map((a) => (a.id === id ? next : a)))
    return next
  }

  /** Takes the account out of Mission Control. Its folder, login and conversations stay where they are. */
  removeAccount(id: AccountId): void {
    if (!this.accounts.some((a) => a.id === id)) throw new Error(t('Cuenta desconocida'))
    if (this.accounts.length <= 1) throw new Error(t('Tiene que quedar al menos una cuenta'))
    this.saveAccounts(this.accounts.filter((a) => a.id !== id))
    addEvent(this.db, { at: Date.now(), account: id, kind: 'cuenta', title: t('Cuenta quitada de Mission Control: Claude {v0}', { v0: id.slice(6) }), source: 'Mission Control' })
  }

  /** Re-reads the activity files (hooks append to them on every tool), at most every 1,5 s. */
  readAllActivity(): void {
    const next: Record<string, AccountActivity> = {}
    for (const a of this.accounts) next[a.id] = readActivity(a.id)
    this.activity = next
    this.push()
  }

  private activitySoon(): void {
    if (this.activityTimer) return
    this.activityTimer = setTimeout(() => {
      this.activityTimer = undefined
      this.readAllActivity()
    }, 1500)
  }

  get settings(): Settings {
    return getSetting<Settings>(this.db, 'ui', { theme: 'system', reduceMotion: 'system', density: 'comfortable' })
  }

  setSettings(patch: Partial<Settings>): Settings {
    const s = { ...this.settings, ...patch }
    setSetting(this.db, 'ui', s)
    if ('accountStatus' in patch || 'recharged' in patch) this.rebuildAgents()
    else this.push()
    return s
  }

  get activeProjectId(): string {
    const id = this.settings.activeProjectId
    return id && this.projects.some((p) => p.id === id) ? id : this.projects[0]?.id ?? ''
  }

  project(id = this.activeProjectId): ProjectConfig | undefined {
    return this.projects.find((p) => p.id === id)
  }

  async start(cliSource?: string): Promise<void> {
    // Node first: without it the launchers of `pmc` name bin\node.cmd, which findNode leaves (EV126).
    this.nodeExe = findNode()
    this.installCli(cliSource)
    this.projects = loadProjects(this.db)
    if (!this.projects.length) await this.seedProjects()
    try { const n = dropOrphanAssets(this.db); if (n) this.log(`galería: ${n} piezas de proyectos que ya no están, quitadas`) } catch (e) { this.log(`galería: ${(e as Error).message}`) }
    try { seedAssignments(this.db) } catch (e) { this.log(`encargos: ${(e as Error).message}`) }
    try { for (const p of this.projects) linkRecentCorrections(this.db, p.id) } catch (e) { this.log(`notas: ${(e as Error).message}`) }
    for (const p of this.projects) {
      try { Object.assign(p, await refreshProjectCopies(this.db, p)) } catch { /* keep */ }
    }
    this.dailyBackup()
    // First paint quickly with what is cheap, then the rest.
    this.syncDocs(true)
    this.push()
    await this.refreshAgents()
    void this.scanAllMedia()
    void this.refreshGit()
    this.every(20_000, 'agentes', () => void this.refreshAgents())
    this.every(8_000, 'documentos', () => this.syncDocs(false))
    this.every(90_000, 'galeria', () => void this.scanAllMedia())
    this.every(60_000, 'git', () => void this.refreshGit())
    this.every(5_000, 'huellas', () => this.hashSome())
    this.every(5_000, 'avisos', () => this.ingestSpool())
    this.ingestSpool()
    this.every(3600_000, 'copiabd', () => this.dailyBackup())
    for (const dir of [paths.usageDir(), paths.liveSessionsDir()]) {
      mkdirSync(dir, { recursive: true })
      // EV115: every status line and every hook writes here (several times a second with a few Claudes at work); one
      // rebuild a second at most, not one per file (each reads every project's RELEVO and every account's history).
      try { this.watchers.push(watch(dir, () => this.rebuildSoon())) } catch { /* polling covers it */ }
    }
    mkdirSync(activityDir(), { recursive: true })
    this.readAllActivity()
    try { this.watchers.push(watch(activityDir(), () => this.activitySoon())) } catch { /* polling covers it */ }
    this.every(30_000, 'actividad', () => this.readAllActivity())
    this.every(3600_000, 'recorte', () => { for (const a of this.accounts) trimActivity(a.id) })
    try { writeProtected(this.db) } catch { /* next change */ }
    // EV80: the user's hard rules for the hooks, again every minute (a rule written in Memoria counts within a minute).
    try { writeRules(this.db) } catch { /* next change */ }
    this.every(60_000, 'reglas', () => { try { writeRules(this.db) } catch { /* next round */ } })
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    for (const w of this.watchers) w.close()
    try { this.db.close() } catch { /* closed */ }
  }

  private installCli(source?: string): void {
    if (!source || !existsSync(source)) return
    mkdirSync(paths.binDir(), { recursive: true })
    const target = this.pmcPath
    try {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== readFileSync(source, 'utf8')) copyFileSync(source, target)
    } catch { /* in use: next start */ }
    // `pmc` as a bare word in every window (EV35, core/shim.ts). Never from a capture run or a copy of the data: the
    // launchers are for every window on the PC (13-11, a capture on a copy pointed them at %TEMP% for half an hour).
    if (process.env.PMC_SHOT_DIR || process.env.PMC_DATA_DIR) return
    try { const made = installShims(target); if (made.length) this.log(`orden pmc puesta en ${shimDir()}: ${made.join(', ')}`) } catch { /* next start */ }
  }

  private async seedProjects(): Promise<void> {
    // No project of anyone's is added by name or path (EV129: the first one this app was made for used to be): the
    // first time, the user adds his (EV97); only this app's own folder, when it is run from it.
    const self = process.cwd()
    if (existsSync(join(self, 'ENCARGO.md'))) {
      const p = await detectProject(self, 'Mission Control', 'mission-control', '#64D2FF')
      saveProject(this.db, p)
    }
    this.projects = loadProjects(this.db)
  }

  async addProject(root: string, name?: string): Promise<ProjectConfig> {
    if (!existsSync(root)) throw new Error(t('La carpeta no existe'))
    const p = await detectProject(root, name)
    if (this.projects.some((x) => x.id === p.id)) p.id = `${p.id}-${Date.now().toString(36).slice(-4)}`
    this.removed.delete(p.id)
    saveProject(this.db, p)
    this.projects = loadProjects(this.db)
    addEvent(this.db, { projectId: p.id, at: Date.now(), kind: 'proyecto', title: t('Proyecto añadido: {name}', { name: p.name }), source: 'Mission Control' })
    this.syncDocs(true)
    void this.scanAllMedia()
    void this.refreshGit()
    return p
  }

  updateProject(id: string, patch: Partial<ProjectConfig>): ProjectConfig {
    const p = this.project(id)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const next = { ...p, ...patch, id: p.id }
    saveProject(this.db, next)
    this.projects = loadProjects(this.db)
    this.push()
    return next
  }

  /**
   * EV169: Mission Control forgets the project: everything it kept about it and every setting that named it. A copy of
   * the database goes first (Ajustes › Copias brings it back). The folder stays where it is: the caller may bin it.
   */
  removeProject(id: string): { name: string; root: string; backup: string } {
    const p = this.project(id)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const backup = backupDb(this.db)
    this.removed.add(id)
    forgetProject(this.db, id)
    this.projects = loadProjects(this.db)
    for (const m of [this.docMtimes, this.tasks, this.copies, this.commits, this.commitsToday]) m.delete(id)
    addEvent(this.db, { at: Date.now(), kind: 'proyecto', title: t('Proyecto quitado de Mission Control: {name}', { name: p.name }), detail: p.root, source: 'Mission Control' })
    this.setSettings(settingsWithoutProject(this.settings, id, p.root))
    return { name: p.name, root: p.root, backup }
  }

  private dailyBackup(): void {
    const last = getSetting<number>(this.db, 'lastBackup', 0)
    if (Date.now() - last < 20 * 3600_000) return
    try {
      backupDb(this.db)
      setSetting(this.db, 'lastBackup', Date.now())
    } catch { /* retried next hour */ }
  }

  backupNow(): string {
    const f = backupDb(this.db)
    setSetting(this.db, 'lastBackup', Date.now())
    return f
  }

  /** TASKS.md / RELEVO.md / Buzón: re-read only when one of them changed on disk. */
  syncDocs(force: boolean): void {
    let changed = false
    for (const p of this.projects) {
      let sig = 0
      for (const d of p.docsDirs) for (const f of ['TASKS.md', 'RELEVO.md', 'Buzón.md']) {
        try { sig += statSync(join(d, f)).mtimeMs } catch { /* missing */ }
      }
      if (!force && this.docMtimes.get(p.id) === sig) continue
      this.docMtimes.set(p.id, sig)
      try {
        syncTasks(this.db, p)
        pruneAssignments(this.db, p.id)
        this.tasks.set(p.id, listTasks(this.db, p.id))
        checkBuzonReceipts(this.db, p)
      } catch (e) {
        this.log(`tasks ${p.id}: ${(e as Error).message}`)
      }
      changed = true
    }
    this.refreshedAt.docs = Date.now()
    if (changed) this.rebuildAgents()
  }

  async refreshAgents(): Promise<void> {
    if (this.busy.has('agents')) return
    this.busy.add('agents')
    try {
      await Promise.all(
        this.accounts.map(async (a) => {
          try {
            this.live.set(a.id, { rows: await listAgents(a), at: Date.now() })
          } catch (e) {
            const prev = this.live.get(a.id)
            this.live.set(a.id, { rows: prev?.rows, at: prev?.at, error: (e as Error).message })
          }
        })
      )
      this.refreshedAt.agents = Date.now()
      this.rebuildAgents()
    } finally {
      this.busy.delete('agents')
    }
  }

  /** EV115: a timer of the app's own work, timed like the window's calls (what blocks it more than 80 ms is logged). */
  private every(ms: number, name: string, fn: () => void): void {
    this.timers.push(setInterval(() => timed((s) => this.log(s), name, fn), ms))
  }

  private rebuildTimer?: NodeJS.Timeout
  /** Many changes in a row (status lines, hooks) make one rebuild, a second later. */
  rebuildSoon(): void {
    if (this.rebuildTimer) return
    this.rebuildTimer = setTimeout(() => { this.rebuildTimer = undefined; timed((s) => this.log(s), 'cuentas', () => this.rebuildAgents()) }, 1000)
  }

  rebuildAgents(): void {
    const t0 = performance.now()
    let t1 = t0
    let t2 = t0
    try {
      const hb = allHeartbeats(this.projects)
      this.heartbeats = hb.byProject
      this.enCurso = hb.enCurso
      t1 = performance.now()
      this.agents = buildAgents({ accounts: this.accounts, projects: this.projects, live: this.live, tasksByProject: this.tasks, heartbeats: hb.byProject, recharged: this.settings.recharged })
      t2 = performance.now()
      // An account spending with nothing to show for it: one line in the timeline per half hour, for the user to look.
      try {
        const now = Date.now()
        for (const a of this.agents) {
          if (a.state !== 'trabajando') continue
          // Writes are only recorded inside the projects: an account at work in another folder (claude5 in D:\Video
          // APP, 12-11) would always look stuck.
          if (!a.sessions.some((s) => s.projectId && isSessionWorking(s))) continue
          const progress = (this.db.prepare("SELECT at FROM events WHERE account = ? AND kind IN ('archivo', 'reserva') AND at > ?").all(a.id, now - STALL_MS) as { at: number }[]).map((r) => r.at)
          const stuck = isStalled(a.usage.history, progress, now)
          if (stuck) addEvent(this.db, { projectId: a.sessions[0]?.projectId, at: now, account: a.id, kind: 'aviso', title: t('Claude {v0} ha gastado {points} puntos de sus 5 horas en {minutes} min sin escribir ni reservar nada: mira si está atascado', { v0: a.id.slice(6), points: stuck.points, minutes: stuck.minutes }), source: 'Mission Control', dedupe: `stall:${a.id}:${Math.floor(now / STALL_MS)}` })
        }
      } catch { /* a notice, never a failure */ }
      // What the user said about an account goes before anything read from it: it is not offered, launched or counted on.
      const status = this.settings.accountStatus ?? {}
      for (const a of this.agents) {
        const s = status[a.id]
        if (!s || a.state === 'trabajando' || a.state === 'esperando') continue
        a.state = s === 'baja' ? 'baja' : 'apartada'
        a.stateReason = s === 'baja' ? t('De baja: ya no se paga') : t('Apartada por ti: no se usa')
      }
      this.writeTeam()
    } catch (e) {
      this.log(`agents: ${(e as Error).message}`)
    }
    try { this.fitWorkMode() } catch (e) { this.log(`forma de trabajar: ${(e as Error).message}`) }
    // EV115: where the time goes when it is slow (relays; accounts and their conversations; the rest).
    if (performance.now() - t0 > 150) this.log(`cuentas por partes: relevos ${Math.round(t1 - t0)} ms, cuentas ${Math.round(t2 - t1)} ms (${describeBuildTimes() || 'nada de 5 ms'}), resto ${Math.round(performance.now() - t2)} ms`)
    this.push()
  }

  /**
   * EV128 (the user, 13-11: «gestión de créditos… sin que el usuario tenga que estar pidiendo nada»): while the way of
   * working is the one the app chose, it follows the team. One account works on and takes up its own work when its usage
   * is back; once a second one is signed in, they relay. Never once the user has chosen one himself.
   */
  private fitWorkMode(): void {
    if (this.settings.workModeBy !== 'app' || !this.agents.length) return
    const signed = this.agents.filter((a) => a.identity.hasLogin && a.state !== 'baja' && a.state !== 'apartada' && !this.settings.accountStatus?.[a.id]).length
    const fit = fitTeam(this.settings, signed)
    if (!fit) return
    const { advice } = fit
    this.setSettings(fit.patch)
    addEvent(this.db, { at: Date.now(), kind: 'aviso', title: t('{title}: la app lo ha puesto así sola (se cambia en Relevos › Cómo trabajan los Claude)', { title: advice.title }), detail: advice.why, source: 'Mission Control' })
    this.log(`forma de trabajar puesta por la app: ${advice.title}`)
  }

  /** A small summary of the four accounts for the SessionStart hook, so every Claude knows how the others are. */
  private writeTeam(): void {
    const now = Date.now()
    const given = new Map<string, string>()
    for (const p of this.projects) for (const x of listAssignments(this.db, p.id)) given.set(x.from, x.to)
    const team = this.agents.map((a) => {
      const s = a.sessions.find((x) => x.status === 'busy') ?? a.sessions.find((x) => x.pid) ?? a.sessions[0]
      const w = a.usage.snapshot?.sevenDay
      const f = a.usage.snapshot?.fiveHour
      return {
        id: a.id, state: a.state, reason: a.stateReason, status: this.settings.accountStatus?.[a.id],
        backAt: a.usage.activeLimit?.resetsAt,
        weekFree: a.usage.activeLimit?.kind === 'semanal' ? 0 : w && w.resetsAt > now ? Math.max(0, 100 - Math.round(w.usedPct)) : undefined,
        fiveFree: f && f.resetsAt > now ? Math.max(0, 100 - Math.round(f.usedPct)) : undefined,
        // When the figure was read: an account is only read while it answers, so a top-up shows with its first reply.
        usageAt: a.usage.activeLimit ? a.usage.activeLimit.at : a.usage.snapshot?.capturedAt,
        doing: a.state === 'trabajando' ? s?.title : undefined,
        projectId: s?.projectId,
        // Tasks the user already gave to another account are not waiting for anyone.
        stuck: a.state === 'sin-uso' && !given.has(a.id) ? a.assigned.slice(0, 8).map((t) => t.extId ?? t.title.slice(0, 40)) : [],
        // 14-11: by project, so a session is told only this project's (core/coord.ts › teamContext).
        // A blocked one waits for the user, not for another account: not «parada» (14-11: EV25).
        stuckIn: a.state === 'sin-uso' && !given.has(a.id) ? a.assigned.filter((t) => t.status !== 'bloqueada').reduce<Record<string, string[]>>((m, t) => { const k = t.projectId ?? ''; if ((m[k] ??= []).length < 8) m[k].push(t.extId ?? t.title.slice(0, 40)); return m }, {}) : undefined,
        gaveTo: given.get(a.id)
      }
    })
    try { writeFileSync(join(paths.root(), 'team.json'), JSON.stringify({ at: now, team, mode: modeOf(this.settings), orders: Object.fromEntries(this.projects.map((p) => [p.id, (this.settings.nextOrderBy?.[p.id] ?? this.settings.nextOrder ?? []).filter((id) => !this.settings.accountStatus?.[id])])), order: (this.settings.nextOrderBy?.[this.activeProjectId] ?? this.settings.nextOrder ?? []).filter((id) => !this.settings.accountStatus?.[id]), out: Object.keys(this.settings.accountStatus ?? {}).filter((id) => this.settings.accountStatus?.[id]) })) } catch { /* next round */ }
  }

  heartbeats = new Map<string, import('../core/types').Heartbeat[]>()
  enCurso = new Map<string, string>()

  /** Astra's chat folders whose name points to a project go to its gallery by themselves (core/astra.ts); every 30 min. */
  private astraAt = 0
  private placeAstra(): void {
    const now = Date.now()
    if (now - this.astraAt < 30 * 60_000) return
    this.astraAt = now
    // Folders already in a gallery, or that the user took out of one («Quitar»), are left alone.
    const taken = new Set<string>()
    for (const p of this.projects) for (const d of [...p.mediaDirs, ...(p.mediaExcluded ?? [])]) taken.add(d.toLowerCase())
    const projects = this.projects.map((p) => ({ id: p.id, name: p.name, vocabulary: (this.db.prepare('SELECT title FROM tasks WHERE project_id = ? AND gone = 0 ORDER BY source_line DESC LIMIT 400').all(p.id) as { title: string }[]).map((r) => r.title) }))
    for (const x of placeCodexChats(codexChats(), projects, taken)) {
      const p = this.project(x.projectId)
      if (!p) continue
      this.updateProject(p.id, { mediaDirs: [...p.mediaDirs, x.dir] })
      addEvent(this.db, { projectId: p.id, at: now, kind: 'proyecto', title: t('Galería: añadida la carpeta de Astra «{v0}» ({why})', { v0: x.dir.split(/[\\/]/).pop(), why: x.why }), detail: x.dir, source: 'Mission Control' })
    }
  }

  async scanAllMedia(): Promise<void> {
    if (this.busy.has('media')) return
    this.busy.add('media')
    try { this.placeAstra() } catch (e) { this.log(`astra: ${(e as Error).message}`) }
    try {
      for (const p of this.projects) {
        if (this.removed.has(p.id)) continue
        try {
          // A worktree that appeared, or a new folder of Astra's cited in the notes, comes in by itself.
          try { Object.assign(p, await refreshProjectCopies(this.db, p)) } catch { /* keep what we had */ }
          const r = await scanMediaAsync(this.db, p)
          if (r.added || r.changed || r.removed) this.log(`media ${p.id}: +${r.added} ~${r.changed} -${r.removed} (${r.ms} ms)`)
          if (r.added && this.refreshedAt.media) this.emit('assets', p.id)
        } catch (e) {
          this.log(`media ${p.id}: ${(e as Error).message}`)
        }
        // EV169 (14-11: a removed project's photos came back): removed while it was being scanned, what the scan wrote goes too.
        if (this.removed.has(p.id)) forgetProject(this.db, p.id)
      }
      this.refreshedAt.media = Date.now()
      this.push()
    } finally {
      this.busy.delete('media')
    }
  }

  /** Events written by the hooks (pmc hook) since the last read: sessions opened, limits, compactions, files written. */
  ingestSpool(): void {
    const dir = paths.spoolDir()
    let files: string[] = []
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort() } catch { return }
    let added = 0
    for (const f of files.slice(-7)) {
      const file = join(dir, f)
      let size = 0
      try { size = statSync(file).size } catch { continue }
      const prev = (this.db.prepare('SELECT offset FROM spool_offsets WHERE file = ?').get(f) as { offset: number } | undefined)?.offset ?? 0
      if (size <= prev) continue
      const buf = readFileSync(file).subarray(prev)
      const text = buf.toString('utf8')
      const end = text.lastIndexOf(NL)
      if (end < 0) continue
      for (const line of text.slice(0, end).split(NL)) {
        let e: any
        try { e = JSON.parse(line) } catch { continue }
        const { project, copy } = projectForPath(this.projects, e.cwd ?? '')
        const who = `Claude ${String(e.account).slice(6)}`
        const base = { projectId: project?.id, at: e.at, account: e.account, source: `hook ${e.event}`, ref: e.sessionId }
        if (e.event === 'SessionStart') added += Number(addEvent(this.db, { ...base, kind: 'sesion', title: t('{who} {v0} una sesión{v1}', { who: who, v0: e.source === 'resume' ? t('retomó') : e.source === 'compact' ? t('siguió tras compactar') : t('abrió'), v1: copy ? t(' en {copy}', { copy: copy }) : '' }), dedupe: `ss:${e.sessionId}:${e.at}` }))
        else if (e.event === 'StopFailure') { this.emit('stop-failure', e, project); added += Number(addEvent(this.db, { ...base, kind: 'limite', title: t('{who} se ha parado: {v0}', { who: who, v0: e.error ?? t('error') }), detail: e.message, dedupe: `sf:${e.sessionId}:${e.at}` })) }
        else if (e.event === 'Stop') this.emit('stop', e, project)
        else if (e.event === 'PreCompact') added += Number(addEvent(this.db, { ...base, kind: 'compacta', title: t('{who} compactó su conversación ({v0})', { who: who, v0: e.source ?? 'auto' }), dedupe: `pc:${e.sessionId}:${e.at}` }))
        else if (e.event === 'SessionEnd') added += Number(addEvent(this.db, { ...base, kind: 'sesion', title: t('{who} cerró una sesión{v0}', { who: who, v0: copy ? t(' en {copy}', { copy: copy }) : '' }), dedupe: `se:${e.sessionId}:${e.at}` }))
        else if (e.event === 'PostToolUse' && e.file) {
          const winPath = nativePath(String(e.file))
          const rel = project && isInside(winPath, project.root) && pathKey(winPath) !== pathKey(project.root) ? winPath.slice(project.root.replace(/[\\/]+$/, '').length + 1) : winPath
          // The file's own project goes first: a window opened in one project that edits another (claude1, 12-11) was
          // counted as working in its window's, and its hand-off was opened there.
          const owner = projectForPath(this.projects, winPath).project ?? project
          added += Number(addEvent(this.db, { ...base, projectId: owner?.id, kind: 'archivo', title: t('{who} escribió {rel}', { who: who, rel: rel }), detail: winPath, dedupe: `pt:${e.sessionId}:${winPath}:${Math.floor(e.at / 600_000)}` }))
          if (project) this.db.prepare('UPDATE assets SET account = ? WHERE project_id = ? AND lower(path) = lower(?)').run(e.account, project.id, winPath)
        }
      }
      this.db.prepare('INSERT INTO spool_offsets(file, offset) VALUES(?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset').run(f, prev + Buffer.byteLength(text.slice(0, end + 1), 'utf8'))
    }
    if (added) this.push()
  }

  private hashSome(): void {
    // At most ~120 ms a round (EV115): what is left waits 5 s; the app never stops for a pile of new videos.
    // Each round starts with the next project, so one with many new files does not keep the others waiting.
    const until = Date.now() + 120
    const n = this.projects.length
    this.hashTurn = (this.hashTurn + 1) % Math.max(1, n)
    for (let k = 0; k < n; k++) {
      if (Date.now() > until) break
      const p = this.projects[(this.hashTurn + k) % n]
      try { hashPending(this.db, p.id, 150, until) } catch { /* next round */ }
    }
  }
  private hashTurn = 0

  async refreshGit(): Promise<void> {
    if (this.busy.has('git')) return
    this.busy.add('git')
    try {
      for (const p of this.projects) {
        const list = await Promise.all(p.copies.map((c) => copyStatus(c.path, c.label)))
        this.copies.set(p.id, list)
        this.commits.set(p.id, await recentCommits(p.root))
        // EV133: today's count apart, by git: the list stops at 400 and a busy day has more (534 on 13-11).
        const midnight = new Date().setHours(0, 0, 0, 0)
        const today = await commitsSince(p.root, midnight)
        if (today != null) this.commitsToday.set(p.id, { since: midnight, n: today })
      }
      this.refreshedAt.git = Date.now()
      this.push()
    } finally {
      this.busy.delete('git')
    }
  }

  state(): DashboardState {
    const p = this.project()
    const statusLine: Record<string, StatusLineState> = {}
    const hooks: Record<string, boolean> = {}
    const hooksOutdated: Record<string, boolean> = {}
    for (const a of this.accounts) { statusLine[a.id] = statusLineState(a); const h = hooksState(a); hooks[a.id] = h.installed; hooksOutdated[a.id] = h.outdated }
    const installed: Record<string, boolean> = {}
    for (const a of this.accounts) installed[a.id] = statusLine[a.id].ours
    const tasks = p ? this.tasks.get(p.id) ?? [] : []
    let day
    if (p) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      day = daySummary(this.timeline(p.id, start.getTime(), Date.now()), start.getTime(), tasks)
      const c = this.commitsToday.get(p.id)
      if (c && c.since === start.getTime()) day.commits = Math.max(day.commits, c.n)
    }
    return {
      now: Date.now(),
      projects: this.projects,
      activeProjectId: this.activeProjectId,
      summary: p ? summarize(p, tasks, this.agents, this.heartbeats.get(p.id) ?? [], this.copies.get(p.id) ?? [], installed) : undefined,
      agents: this.agents,
      statusLine,
      hooks,
      hooksOutdated,
      nodeExe: this.nodeExe,
      enCurso: p ? this.enCurso.get(p.id) : undefined,
      refreshedAt: this.refreshedAt,
      day,
      skills: p ? this.skillsTally[p.id] : undefined,
      memories: p ? (this.db.prepare("SELECT COUNT(*) n FROM memories WHERE project_id IN (?, '_todos') AND gone = 0").get(p.id) as { n: number }).n : undefined,
      settings: this.settings,
      dataDir: paths.root(),
      activity: this.activity,
      decisionsPending: p ? pendingDecisionCount(this.db, p.id) : 0,
      pending: this.pendingAll(),
      commentsToReview: p ? (this.db.prepare("SELECT COUNT(*) n FROM comments WHERE project_id = ? AND status IN ('esperando-revision', 'corregido')").get(p.id) as { n: number }).n : 0,
      accounts: this.accounts
    }
  }

  pendingAll(): DashboardState['pending'] {
    const out: DashboardState['pending'] = {}
    for (const x of this.projects) {
      try {
        const decisions = pendingDecisionCount(this.db, x.id)
        const comments = (this.db.prepare("SELECT COUNT(*) n FROM comments WHERE project_id = ? AND status IN ('esperando-revision', 'corregido')").get(x.id) as { n: number }).n
        const review = (this.tasks.get(x.id) ?? []).filter((t) => !t.change && (t.status === 'revision' || Boolean(t.waitingLook))).length
        if (decisions || comments || review) out[x.id] = { decisions, review, comments }
      } catch { /* next round */ }
    }
    return out
  }

  timeline(projectId: string, from: number, to: number) {
    const p = this.project(projectId)
    if (!p) return []
    const owners = sessionOwners(this.accounts)
    const limits: { account: AccountId; at: number; resetsAt: number; kind: string }[] = []
    for (const [account, list] of readLimits(owners, this.accounts)) for (const l of list) if (l.source === 'wake_log') limits.push({ account, at: l.at, resetsAt: l.resetsAt, kind: l.kind })
    return timeline({ db: this.db, project: p, accounts: this.accounts, heartbeats: this.heartbeats.get(p.id) ?? [], commits: this.commits.get(p.id) ?? [], limits, from, to })
  }

  sessionsFor(projectId: string) {
    const p = this.project(projectId)
    if (!p) return []
    const owners = sessionOwners(this.accounts)
    const out: { sessionId: string; copy: string; cwd: string; mtime: number; size: number; account?: AccountId; title?: string; model?: string; lastPrompt?: string; live: boolean }[] = []
    const liveIds = new Set<string>()
    for (const a of this.agents) for (const s of a.sessions) liveIds.add(s.sessionId)
    for (const c of p.copies) {
      for (const s of savedSessions(c.path, 25)) {
        const tail = s.size < 400 << 20 ? readTranscriptTail(s.file) : undefined
        out.push({ sessionId: s.sessionId, copy: c.label, cwd: c.path, mtime: s.mtime, size: s.size, account: owners.get(s.sessionId)?.account, title: tail?.title, model: tail?.model, lastPrompt: tail?.lastPrompt, live: liveIds.has(s.sessionId) })
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime)
  }

  /** Coalesces bursts of changes into one update for the interface. */
  push(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined
      this.emit('state')
    }, 120)
  }

  log(text: string): void {
    try {
      const line = `${new Date().toISOString()} ${text}\n`
      writeFileSync(paths.logFile(), line, { flag: 'a' })
    } catch { /* ignore */ }
  }
}

/**
 * EV115: the synchronous part of something the app runs by itself, timed: more than 80 ms holds every window, so it goes
 * to mission.log as «lento: <nombre> N ms (sola)», next to the window's own slow calls. Errors are logged, never thrown
 * out of a timer.
 */
export function timed(log: (s: string) => void, name: string, fn: () => unknown): void {
  const t0 = performance.now()
  try {
    const r = fn()
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch((e) => log(`${name}: ${(e as Error)?.message ?? e}`))
  } catch (e) {
    log(`${name}: ${(e as Error)?.message ?? e}`)
  } finally {
    const ms = performance.now() - t0
    if (ms > 80) log(`lento: ${name} ${Math.round(ms)} ms (sola)`)
  }
}

function findNode(): string | undefined {
  // macOS and Linux: node from the PATH (the login shell's, core/platform.ts) or the usual folders; else the app's own.
  if (process.platform !== 'win32') {
    if (!process.env.PMC_SIN_NODE) {
      const found = [...(process.env.PATH ?? '').split(':').filter(Boolean).map((d) => join(d, 'node')), '/opt/homebrew/bin/node', '/usr/local/bin/node'].find((c) => !c.startsWith(paths.binDir()) && existsSync(c))
      if (found) return found
    }
    try { return installNodeShim(process.execPath) } catch { return undefined }
  }
  const candidates = ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
  // PMC_SIN_NODE: a PC without Node.js, for scripts/primera-vez.ps1 -SinNada.
  if (!process.env.PMC_SIN_NODE) {
    try {
      const out = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      candidates.unshift(...out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
    } catch { /* not on PATH */ }
    const found = candidates.find((c) => c.toLowerCase().endsWith('.exe') && existsSync(c))
    if (found) return found
  }
  // EV126: no Node.js here (Claude Code's own installer does not bring it): the app's own program runs pmc.
  try { return installNodeShim(process.execPath) } catch { return undefined }
}

/** Runs pmc.mjs (or any script) with Node, or with the app's own program when this PC has no Node.js (EV126). */
export function nodeArgs(nodeExe: string, args: string[], env: NodeJS.ProcessEnv = process.env): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
  // A .cmd cannot be started without a shell (Node refuses it since 2024): its program directly, with its variable.
  if (/\.cmd$/i.test(nodeExe) || nodeExe === nodeShimPath()) return { file: process.execPath, args, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
  return { file: nodeExe, args, env }
}
