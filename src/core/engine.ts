import { t, t as tr } from './i18n'
// Puts the readers together: tasks imported from TASKS.md, the four agent cards, the project summary and the timeline.
// Every number here comes from a file, a command or the database; nothing is estimated.
import { taskChanges } from './changes'
import { taskTags } from './coord'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AccountConfig, AccountId, AgentCard, AgentState, Alert, Heartbeat, LimitHit, LiveSession, ProjectConfig, ProjectSummary, Task, TaskStatus, TimelineEvent, CopyStatus
} from './types'
import { addEvent, type DB } from './db'
import { parseTasks, stripMd, type ParsedTask } from './parse/tasks'
import { parseRelevo } from './parse/relevo'
import { newestDoc, projectForPath, readText, type Commit } from './projects'
import { buildUsage, readIdentity, readLimits } from './accounts'
import { minutesLeft } from './pace'
import { configDirOf, findTranscript, readHistory, readTranscriptTail, sessionOwners, toLiveSession, type AgentsJsonRow } from './sessions'
import { paths } from './paths'

// ---- tasks ----------------------------------------------------------------------------------------------------------

/** Day written next to "Hecho" in TASKS.md, e.g. "Hecho y visto (1-11)". Day precision, the year is assumed current. */
export function doneDate(text: string, now = Date.now()): number | undefined {
  const m = text.match(/hech[oa]s?[^()]{0,40}\((\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?/i)
  if (!m) return undefined
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date(now).getFullYear()
  const t = new Date(y, +m[2] - 1, +m[1], 12, 0).getTime()
  return t > now + 86400_000 ? new Date(y - 1, +m[2] - 1, +m[1], 12).getTime() : t
}

export interface TaskSyncResult {
  file?: string
  total: number
  changed: number
  added: number
}

export function syncTasks(db: DB, project: ProjectConfig, now = Date.now()): TaskSyncResult {
  const src = newestDoc(project, 'TASKS.md')
  if (!src) return { total: 0, changed: 0, added: 0 }
  const parsed = parseTasks(readText(src.file))
  const prev = new Map<string, { id: number; status: string; mark: string; title: string; gone: number }>()
  void 0
  for (const r of db.prepare("SELECT id, key, status, mark, title, gone FROM tasks WHERE project_id = ? AND source = 'TASKS.md'").all(project.id) as any[]) {
    prev.set(r.key, r)
  }
  const firstImport = prev.size === 0
  const ins = db.prepare(
    `INSERT INTO tasks(project_id, key, ext_id, title, detail, status, section, priority, owner, source, source_file, source_line, mark, done_at, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,'TASKS.md',?,?,?,?,?,?)`
  )
  const upd = db.prepare(
    'UPDATE tasks SET ext_id=?, title=?, detail=?, status=?, section=?, owner=?, source_file=?, source_line=?, mark=?, done_at=COALESCE(?, done_at), override=CASE WHEN ? THEN NULL ELSE override END, gone=0, updated_at=? WHERE id=?'
  )
  const seen = new Set<string>()
  let changed = 0, added = 0
  db.exec('BEGIN')
  try {
    for (const t of parsed) {
      seen.add(t.key)
      const p = prev.get(t.key)
      const done = t.mark === 'x' ? doneDate(t.detail + ' ' + t.title, now) : undefined
      if (!p) {
        ins.run(project.id, t.key, t.extId ?? null, t.title, t.detail, t.status, t.section, 2, t.owner ?? null, src.file, t.line, t.mark, done ?? null, now, now)
        added++
        if (!firstImport) {
          addEvent(db, { projectId: project.id, at: now, account: t.owner, kind: 'tarea-nueva', title: tr('Tarea nueva: {task}', { task: `${t.extId ? t.extId + ' · ' : ''}${t.title}` }), source: 'TASKS.md', ref: t.key, dedupe: `tn:${project.id}:${t.key}` })
        }
      } else {
        const statusChanged = p.mark !== t.mark
        upd.run(t.extId ?? null, t.title, t.detail, t.status, t.section, t.owner ?? null, src.file, t.line, t.mark, t.mark === 'x' && statusChanged ? (done ?? now) : null, statusChanged ? 1 : 0, statusChanged ? now : (db.prepare('SELECT updated_at u FROM tasks WHERE id=?').get(p.id) as any).u, p.id)
        if (statusChanged) {
          changed++
          const verb = t.mark === 'x' ? tr('marcada como hecha') : t.mark === '~' ? tr('empezada (a medias)') : tr('reabierta')
          addEvent(db, {
            projectId: project.id, at: now, account: t.owner, kind: t.mark === 'x' ? 'tarea-hecha' : 'tarea-cambio',
            title: `${t.extId ? t.extId + ' · ' : ''}${t.title}: ${verb}`, detail: tr('Según TASKS.md (lo dice el agente; no está verificado por ti).'),
            source: 'TASKS.md', ref: t.key, dedupe: `tc:${project.id}:${t.key}:${t.mark}:${Math.floor(now / 60000)}`
          })
        }
      }
    }
    const gone = db.prepare('UPDATE tasks SET gone = 1 WHERE id = ?')
    for (const [k, p] of prev) if (!seen.has(k) && !p.gone) gone.run(p.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { file: src.file, total: parsed.length, changed, added }
}

const WAITING_LOOK = /a falta de que lo vea|pendiente de que lo vea|falta que (?:el usuario )?lo vea/i

function rowToTask(r: any): Task {
  return {
    id: r.id, key: r.key, projectId: r.project_id, extId: r.ext_id ?? undefined, title: r.title, detail: r.detail, status: r.override ?? r.status, fileStatus: r.status, section: r.section,
    priority: r.priority, owner: r.owner ?? undefined, source: r.source, sourceFile: r.source_file ?? undefined, sourceLine: r.source_line ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at, mark: r.mark ?? undefined, verified: Boolean(r.verified),
    waitingLook: !r.verified && r.mark === 'x' && (r.override ?? r.status) === 'terminada' && WAITING_LOOK.test(`${r.title} ${r.detail}`)
  }
}

export function listTasks(db: DB, projectId: string): Task[] {
  const changes = taskChanges(db, projectId)
  // The last run of the checks for each task (rows come oldest first, so the last one wins).
  const checks = new Map<string, NonNullable<Task['checks']>>()
  try {
    for (const v of db.prepare("SELECT task_key, outcome, at, summary FROM verifications WHERE project_id = ? AND task_key IS NOT NULL AND outcome != 'aplazada' ORDER BY at, id").all(projectId) as any[])
      checks.set(v.task_key, { outcome: v.outcome, at: v.at, summary: v.summary })
  } catch { /* a database from before the checks */ }
  const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? AND gone = 0 ORDER BY source_line IS NULL, source_line').all(projectId) as any[]
  // What each task says about itself: what it waits for, and so what each one holds back.
  const open = new Set(rows.filter((r) => (r.override ?? r.status) !== 'terminada' && r.ext_id).map((r) => r.ext_id as string))
  const tags = new Map<string, ReturnType<typeof taskTags>>()
  const unblocks = new Map<string, string[]>()
  for (const r of rows) {
    if (!/[(](?:tras|after):|[[{]/.test(`${r.title} ${r.detail ?? ''}`)) continue
    const g = taskTags(`${r.title} ${r.detail ?? ''}`)
    tags.set(r.key, g)
    if ((r.override ?? r.status) !== 'terminada' && r.ext_id) for (const id of g.after) if (id !== r.ext_id) unblocks.set(id, [...(unblocks.get(id) ?? []), r.ext_id])
  }
  return rows.map((r) => {
    const t = rowToTask(r)
    const seen = checks.get(t.key) ?? (t.extId ? checks.get(t.extId) : undefined)
    if (seen) t.checks = seen
    const g = tags.get(t.key)
    if (g) {
      const waits = g.after.filter((id) => id !== t.extId && open.has(id))
      if (waits.length) t.waitsFor = waits
      if (g.model) t.model = g.model
      if (g.needs.length) t.needs = g.needs
    }
    if (t.extId && unblocks.has(t.extId) && t.status !== 'terminada') t.unblocks = unblocks.get(t.extId)
    const c = changes.get(t.key)
    if (c?.status === 'pedido') return { ...t, change: c, waitingLook: false }
    // Whatever its text says by now, what was changed at the user's request goes back to the user.
    if (c?.status === 'hecho' && !t.verified) return { ...t, changeDone: c, waitingLook: t.status === 'terminada' }
    return t
  })
}

export function setTaskStatus(db: DB, projectId: string, id: number, status: TaskStatus, verified?: boolean): void {
  const now = Date.now()
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(id, projectId) as any
  if (!t) throw new Error(tr('La tarea no existe'))
  db.prepare("UPDATE tasks SET override = CASE WHEN source = 'app' THEN NULL ELSE ? END, status = CASE WHEN source = 'app' THEN ? ELSE status END, verified = COALESCE(?, verified), updated_at = ? WHERE id = ?").run(status, status, verified == null ? null : verified ? 1 : 0, now, id)
  addEvent(db, {
    projectId, at: now, kind: verified ? 'tarea-verificada' : 'tarea-movida',
    title: verified ? tr('Has verificado {task}', { task: `${t.ext_id ? t.ext_id + ' · ' : ''}${t.title}` }) : tr('Has movido {task} a «{status}»', { task: `${t.ext_id ? t.ext_id + ' · ' : ''}${t.title}`, status: tr(STATUS_LABEL[status]) }),
    source: 'Mission Control', ref: t.key
  })
}

/** A task of the app's own (a new idea, a correction): it lives only in the database until an agent files it. */
export function addAppTask(db: DB, projectId: string, t: { title: string; detail?: string; status?: TaskStatus; owner?: AccountId }): Task {
  const now = Date.now()
  const key = 'app:' + now.toString(36) + Math.random().toString(36).slice(2, 6)
  db.prepare("INSERT INTO tasks(project_id, key, title, detail, status, section, priority, owner, source, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,'app',?,?)")
    .run(projectId, key, t.title, t.detail ?? '', t.status ?? 'idea', 'Desde Mission Control', 2, t.owner ?? null, now, now)
  addEvent(db, { projectId, at: now, account: t.owner, kind: t.status === 'idea' || !t.status ? 'idea' : 'tarea-nueva', title: `${t.status === 'idea' || !t.status ? tr('Idea nueva') : tr('Tarea nueva')}: ${t.title}`, source: 'Mission Control', ref: key })
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE key = ?').get(key))
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  idea: 'Ideas', pendiente: 'Pendiente', planificada: 'Planificada', 'en-desarrollo': 'En desarrollo', bloqueada: 'Bloqueada',
  'pendiente-integracion': 'Pendiente de integración', 'en-pruebas': 'En pruebas', revision: 'Pendiente de tu revisión', terminada: 'Terminada'
}

// ---- agents ---------------------------------------------------------------------------------------------------------

export interface LiveSessionFile {
  account: AccountId
  at: number
  sessionId: string
  sessionName?: string
  cwd?: string
  model?: string
  modelName?: string
  contextPct?: number | null
  costUsd?: number | null
}

/** EV115: a status line file is read again only when it changed (there are ~90, one per conversation of the week). */
const liveFileCache = new Map<string, { mtime: number; size: number; j: LiveSessionFile }>()

export function readLiveSessionFiles(maxAgeMs = 7 * 86400_000): Map<string, LiveSessionFile> {
  const out = new Map<string, LiveSessionFile>()
  const dir = paths.liveSessionsDir()
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return out }
  const now = Date.now()
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const f = join(dir, n)
    try {
      const st = statSync(f)
      // Older than the week by its date on disk: not opened at all.
      if (now - st.mtimeMs >= maxAgeMs) continue
      let c = liveFileCache.get(f)
      if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
        c = { mtime: st.mtimeMs, size: st.size, j: JSON.parse(readFileSync(f, 'utf8')) as LiveSessionFile }
        liveFileCache.set(f, c)
      }
      if (now - c.j.at < maxAgeMs) out.set(c.j.sessionId, c.j)
    } catch { /* being written */ }
  }
  return out
}

export function allHeartbeats(projects: ProjectConfig[]): { byProject: Map<string, Heartbeat[]>; enCurso: Map<string, string> } {
  const byProject = new Map<string, Heartbeat[]>()
  const enCurso = new Map<string, string>()
  for (const p of projects) {
    const list: Heartbeat[] = []
    for (const dir of p.docsDirs) {
      const f = join(dir, 'RELEVO.md')
      if (existsSync(f)) {
        try {
          const info = parseRelevo(readText(f), f)
          list.push(...info.heartbeats)
          if (info.enCurso && !enCurso.has(p.id)) enCurso.set(p.id, info.enCurso)
        } catch { /* unreadable */ }
      }
      // A hand-off file kept short moves its history to docs/archivo/RELEVO*.md: the timeline still has those heartbeats.
      let old: string[] = []
      try { old = readdirSync(join(dir, 'archivo')).filter((n) => /^RELEVO.*.md$/i.test(n)) } catch { /* no archive */ }
      for (const n of old) {
        try { list.push(...parseRelevo(readText(join(dir, 'archivo', n)), join(dir, 'archivo', n)).heartbeats) } catch { /* unreadable */ }
      }
    }
    const seen = new Set<string>()
    byProject.set(p.id, list.sort((a, b) => b.at - a.at).filter((h) => {
      const k = `${h.at}|${h.account}|${h.text.slice(0, 40)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }))
  }
  return { byProject, enCurso }
}

export interface AgentsInput {
  accounts: AccountConfig[]
  projects: ProjectConfig[]
  live: Map<AccountId, { rows?: AgentsJsonRow[]; at?: number; error?: string }>
  tasksByProject: Map<string, Task[]>
  /** «La he recargado», by account: the time the user said it. */
  recharged?: Record<string, number>
  heartbeats: Map<string, Heartbeat[]>
  now?: number
}

/**
 * EV115: where the last buildAgents spent its time, in ms by part (the app logs it when a rebuild is slow: 13-11 one took
 * 2365 ms and another 326 ms with nothing to say which part).
 */
export const lastBuildTimes = new Map<string, number>()

export function buildAgents(input: AgentsInput): AgentCard[] {
  lastBuildTimes.clear()
  let mark = performance.now()
  const lap = (part: string) => {
    const t = performance.now()
    lastBuildTimes.set(part, (lastBuildTimes.get(part) ?? 0) + t - mark)
    mark = t
  }
  const now = input.now ?? Date.now()
  const owners = sessionOwners(input.accounts)
  lap('historiales')
  const limits = readLimits(owners, input.accounts)
  lap('límites')
  const liveFiles = readLiveSessionFiles()
  lap('líneas de estado')
  const cards: AgentCard[] = []
  for (const acc of input.accounts) {
    const l = input.live.get(acc.id)
    // Limit messages its open conversations ended on, with the reset the API gave: covers every project, not only the
    // one with the wake hook.
    const talkLimits: LimitHit[] = []
    const sessions: LiveSession[] = (l?.rows ?? []).map(toLiveSession).map((s) => {
      const { project, copy } = projectForPath(input.projects, s.cwd)
      s.projectId = project?.id
      s.worktree = copy
      const f = findTranscript(s.sessionId, s.cwd, configDirOf(acc))
      const tail = f ? readTranscriptTail(f) : undefined
      if (tail) {
        s.model = tail.model
        s.lastActivityAt = tail.lastActivityAt
        s.title = tail.title ?? (s.name && !/^[0-9a-f]{8}$/.test(s.name) ? s.name : undefined)
        s.lastPrompt = tail.lastPrompt
        s.branch = tail.branch
        s.rateLimited = tail.rateLimited
        if (tail.noCredit) s.noCredit = true
        if (tail.limit) talkLimits.push(tail.limit)
      }
      const lf = liveFiles.get(s.sessionId)
      if (lf) {
        s.model = lf.model ?? s.model
        if (typeof lf.contextPct === 'number') s.contextPct = lf.contextPct
        if (typeof lf.costUsd === 'number') s.costUsd = lf.costUsd
        if (lf.sessionName) s.title = lf.sessionName
      }
      return s
    })
    sessions.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    lap(`conversaciones ${acc.id}`)
    const lastGood = sessions.filter((s) => !s.rateLimited).reduce<number | undefined>((m, s) => Math.max(m ?? 0, s.lastActivityAt ?? 0) || m, undefined)
    const usage = buildUsage(acc.id, [...(limits.get(acc.id) ?? []), ...talkLimits], lastGood, now, input.recharged?.[acc.id])
    if (usage.snapshot && now - usage.snapshot.capturedAt < 15 * 60_000) usage.minutesLeft = minutesLeft(usage.history, usage.snapshot, now)
    lap('uso')
    const identity = readIdentity(acc)
    const prompts = readHistory(acc)
    lap('identidad')
    const lastPromptAt = prompts.length ? prompts[prompts.length - 1].at : undefined

    let hb: Heartbeat | undefined
    for (const list of input.heartbeats.values()) for (const h of list) if (h.account === acc.id && (!hb || h.at > hb.at)) hb = h

    const assigned: AgentCard['assigned'] = []
    for (const [projectId, list] of input.tasksByProject)
      for (const t of list) if (t.owner === acc.id && t.status !== 'terminada') assigned.push({ extId: t.extId, title: t.title, status: t.status, projectId })

    let state: AgentState
    let reason: string
    const snap = usage.snapshot
    const exhausted =
      (snap?.fiveHour && snap.fiveHour.usedPct >= 100 && snap.fiveHour.resetsAt > now) || (snap?.sevenDay && snap.sevenDay.usedPct >= 100 && snap.sevenDay.resetsAt > now)
    // A session stuck on a limit message means "no usage" unless that limit is known to have reset already.
    // Or the account was recharged after it (the user's button, a coupon used, or the probe of EV120 seeing usage again).
    const rechargedAt = input.recharged?.[acc.id]
    const limitOver = Boolean(usage.lastLimit && (usage.lastLimit.resetsAt <= now || (rechargedAt && rechargedAt > usage.lastLimit.at)))
    const freshUsage = (_s: LiveSession) => limitOver
    const busy = sessions.filter((s) => s.status === 'busy')
    const waiting = sessions.filter((s) => s.status === 'waiting')
    if (usage.activeLimit) {
      state = 'sin-uso'
      reason = usage.activeLimit.kind === '5 horas' ? tr('Límite de 5 horas agotado') : usage.activeLimit.kind === 'semanal' ? tr('Límite semanal agotado') : tr('Límite  agotado')
    } else if (exhausted) {
      state = 'sin-uso'
      reason = tr('Uso al 100 % según la línea de estado')
    } else if (busy.length) {
      state = 'trabajando'
      reason = busy.length > 1 ? tr('{n} sesiones trabajando', { n: busy.length }) : tr('Trabajando')
    } else if (waiting.length) {
      state = 'esperando'
      const w = waiting[0].waitingFor ?? ''
      reason = /permission/i.test(w) ? tr('Espera tu permiso') : /question|input/i.test(w) ? tr('Espera tu respuesta') : tr('Esperando')
    } else if (sessions.some((s) => s.rateLimited && !freshUsage(s))) {
      state = 'sin-uso'
      // EV146: a key or Console account out of credit has no reset: it is back when it is recharged.
      reason = sessions.some((s) => s.noCredit && s.rateLimited) ? tr('Sin crédito: vuelve cuando lo recargues') : tr('Parado por límite de uso')
    } else if (sessions.some((s) => s.kind === 'background' && s.state === 'blocked')) {
      // "blocked" in `claude agents` means a background session that finished its turn and waits for a message.
      state = 'disponible'
      reason = tr('Terminó y espera instrucciones')
    } else if (sessions.length) {
      state = 'disponible'
      reason = sessions.length > 1 ? tr('{n} sesiones abiertas, en reposo', { n: sessions.length }) : tr('Sesión abierta, en reposo')
    } else if (l?.error) {
      state = 'desconectado'
      reason = tr('No se pudo consultar')
    } else {
      state = 'desconectado'
      reason = tr('Ninguna sesión abierta')
    }
    if (identity.emailMismatch) reason += tr(' · ¡otra cuenta iniciada en su carpeta!')

    const lastActivityAt = Math.max(sessions[0]?.lastActivityAt ?? 0, lastPromptAt ?? 0, hb?.at ?? 0) || undefined
    cards.push({
      id: acc.id, alias: acc.alias, color: acc.color, configDir: acc.configDir, identity, state, stateReason: reason, sessions, usage,
      heartbeat: hb, lastActivityAt, model: sessions.find((s) => s.model)?.model ?? snap?.model,
      projectId: sessions.find((s) => s.projectId)?.projectId, assigned, sessionsReadAt: l?.at, sessionsError: l?.error
    })
    lap('resto')
  }
  return cards
}

/** The parts of the last buildAgents worth naming (5 ms or more), slowest first: «conversaciones claude3 2210, uso 40». */
export function describeBuildTimes(min = 5): string {
  return [...lastBuildTimes].filter(([, ms]) => ms >= min).sort((a, b) => b[1] - a[1]).map(([k, ms]) => `${k} ${Math.round(ms)}`).join(', ')
}

// ---- project summary ------------------------------------------------------------------------------------------------

export function summarize(project: ProjectConfig, tasks: Task[], agents: AgentCard[], heartbeats: Heartbeat[], copies: CopyStatus[], statusLineInstalled: Record<string, boolean>): ProjectSummary {
  const now = Date.now()
  const top = tasks.filter((t) => true)
  const count = (f: (t: Task) => boolean) => top.filter(f).length
  const alerts: Alert[] = []
  for (const a of agents) {
    if (a.identity.emailMismatch) alerts.push({ level: 'critical', account: a.id, text: t('{id}: su carpeta tiene iniciada otra cuenta ({email})', { id: a.id, email: a.identity.email }) })
    if (a.state === 'esperando') alerts.push({ level: 'warn', account: a.id, text: `${a.id} ${a.stateReason.toLowerCase()}` })
    if (a.usage.activeLimit && a.assigned.length)
      alerts.push({ level: 'warn', account: a.id, text: t('{id} sin uso y con {length} tarea{v0} en espera', { id: a.id, length: a.assigned.length, v0: a.assigned.length > 1 ? 's' : '' }) })
    const s = a.usage.snapshot
    if (!a.usage.activeLimit && s?.sevenDay && s.sevenDay.usedPct >= 85 && s.sevenDay.resetsAt > now)
      alerts.push({ level: 'warn', account: a.id, text: t('{id} lleva el {v0} % de su uso semanal', { id: a.id, v0: Math.round(s.sevenDay.usedPct) }) })
  }
  const missing = agents.filter((a) => !statusLineInstalled[a.id]).map((a) => a.id)
  if (missing.length) alerts.push({ level: 'info', text: t('Sin lectura de consumo en {v0}: actívala en Ajustes', { v0: missing.join(', ') }) })
  for (const c of copies) {
    if (c.error) alerts.push({ level: 'info', text: t('{label}: no se pudo leer git ({error})', { label: c.label, error: c.error }) })
  }
  const lastActivityAt = Math.max(heartbeats[0]?.at ?? 0, ...agents.filter((a) => a.projectId === project.id).map((a) => a.lastActivityAt ?? 0), ...copies.map((c) => c.headAt ?? 0)) || undefined
  return {
    project,
    tasks: {
      total: top.length,
      done: count((t) => t.status === 'terminada'),
      doing: count((t) => t.status === 'en-desarrollo'),
      open: count((t) => t.status !== 'terminada'),
      verified: count((t) => t.verified),
      // EV113: finished and passed by its checks (pmc verifica), which is not the same as accepted by the user (verified).
      checked: count((t) => t.status === 'terminada' && t.checks?.outcome === 'bien'),
      review: count((t) => !t.change && (t.status === 'revision' || Boolean(t.waitingLook))),
      blocked: count((t) => t.status === 'bloqueada')
    },
    tasksSource: newestDoc(project, 'TASKS.md'),
    relevoSource: newestDoc(project, 'RELEVO.md'),
    heartbeats: heartbeats.slice(0, 20),
    lastActivityAt,
    alerts,
    copies
  }
}

// ---- timeline -------------------------------------------------------------------------------------------------------

export interface TimelineInput {
  db: DB
  project: ProjectConfig
  accounts: AccountConfig[]
  heartbeats: Heartbeat[]
  commits: Commit[]
  limits: { account: AccountId; at: number; resetsAt: number; kind: string }[]
  from: number
  to: number
}

export function timeline(input: TimelineInput): TimelineEvent[] {
  const { db, project, from, to } = input
  const out: TimelineEvent[] = []
  let n = -1
  for (const r of db.prepare('SELECT * FROM events WHERE (project_id = ? OR project_id IS NULL) AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 2000').all(project.id, from, to) as any[]) {
    out.push({ id: r.id, projectId: r.project_id, at: r.at, account: r.account ?? undefined, kind: r.kind, title: r.title, detail: r.detail ?? undefined, source: r.source, ref: r.ref ?? undefined })
  }
  for (const h of input.heartbeats) {
    if (h.at < from || h.at > to) continue
    out.push({ id: n--, at: h.at, account: h.account, kind: 'relevo', title: h.text.split(/(?<=[.!?])\s/)[0].slice(0, 220), detail: h.text, source: 'RELEVO.md', ref: h.file })
  }
  for (const c of input.commits) {
    if (c.at < from || c.at > to) continue
    out.push({ id: n--, at: c.at, kind: 'commit', title: c.subject, detail: `${c.hash}${c.branches ? ' · ' + c.branches : ''}`, source: 'Git', ref: c.hash })
  }
  for (const l of input.limits) {
    if (l.at < from || l.at > to) continue
    const back = new Date(l.resetsAt)
    out.push({ id: n--, at: l.at, account: l.account, kind: 'limite', title: t('{account} se quedó sin uso ({kind}); vuelve el {v0} a las {v1}', { account: l.account, kind: l.kind, v0: back.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }), v1: back.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }), source: 'wake.log' })
  }
  const roots = [project.root, ...project.copies.map((c) => c.path)].map((p) => p.toLowerCase())
  for (const acc of input.accounts) {
    for (const p of readHistory(acc)) {
      if (p.at < from || p.at > to || !p.project) continue
      if (!roots.includes(p.project.toLowerCase())) continue
      const text = p.text.trim()
      if (!text || text.startsWith('/') || text.length < 8) continue
      out.push({ id: n--, at: p.at, account: acc.id, kind: 'peticion', title: text.replace(/\s+/g, ' ').slice(0, 220), detail: text.slice(0, 3000), source: 'history.jsonl' })
    }
  }
  // New media, grouped per folder and half hour. Only what gets made while working: the game's own files in each copy
  // carry the date of the checkout, and a file in four copies is one new file.
  const groups = db
    .prepare(
      `SELECT category, folder, kind, COUNT(*) AS n, MAX(at) AS at, GROUP_CONCAT(id) AS ids FROM (
         SELECT a.id AS id, a.category AS category, COALESCE(a.folder, '') AS folder, a.kind AS kind, MAX(a.mtime) AS at
         FROM assets a WHERE a.project_id = ? AND a.gone = 0 AND a.mtime BETWEEN ? AND ? AND COALESCE(a.source, 'pruebas') IN ('pruebas', 'astra', 'docs', 'otros')
         GROUP BY a.name COLLATE NOCASE, a.size
       ) GROUP BY folder, kind, at / 1800000 ORDER BY at DESC LIMIT 600`
    )
    .all(project.id, from, to) as any[]
  const noun: Record<string, [string, string]> = { image: ['imagen', 'imágenes'], video: ['vídeo', 'vídeos'], model: ['modelo 3D', 'modelos 3D'], audio: ['audio', 'audios'] }
  for (const g of groups) {
    const [one, many] = noun[g.kind] ?? ['archivo', 'archivos']
    out.push({ id: n--, at: g.at, kind: 'media', title: tr('{what} en {folder}', { what: g.n === 1 ? tr('Nueva {noun}', { noun: tr(one) }) : tr('{n} {noun} nuevas', { n: g.n, noun: tr(many) }), folder: g.folder.replace(/\/$/, '') || tr('la raíz') }), detail: g.category, source: 'Archivos', ref: String(g.ids) })
  }
  // Tasks the agents marked as done with a date written next to it.
  for (const r of db.prepare("SELECT ext_id, title, done_at, owner FROM tasks WHERE project_id = ? AND mark = 'x' AND done_at BETWEEN ? AND ? AND key NOT IN (SELECT ref FROM events WHERE kind = 'tarea-hecha' AND ref IS NOT NULL)").all(project.id, from, to) as any[]) {
    out.push({ id: n--, at: r.done_at, account: r.owner ?? undefined, kind: 'tarea-hecha-fecha', title: `${r.ext_id ? r.ext_id + ' · ' : ''}${r.title}`, detail: t('Marcada como hecha en TASKS.md con esta fecha (sin hora exacta).'), source: 'TASKS.md' })
  }
  return out.sort((a, b) => b.at - a.at)
}

export function daySummary(events: TimelineEvent[], dayStart: number, tasks: Task[]): { done: number; commits: number; media: number; requests: number; limits: number; review: number } {
  const today = events.filter((e) => e.at >= dayStart)
  return {
    done: today.filter((e) => e.kind === 'tarea-hecha' || e.kind === 'tarea-hecha-fecha').length,
    commits: today.filter((e) => e.kind === 'commit').length,
    media: today.filter((e) => e.kind === 'media').reduce((s, e) => s + (Number(e.title.match(/^(\d+)/)?.[1]) || 1), 0),
    requests: today.filter((e) => e.kind === 'peticion').length,
    limits: today.filter((e) => e.kind === 'limite').length,
    review: tasks.filter((t) => !t.change && (t.status === 'revision' || t.waitingLook)).length
  }
}

export { stripMd }
export type { ParsedTask }
