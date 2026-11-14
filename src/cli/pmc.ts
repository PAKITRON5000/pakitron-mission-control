// pmc: the small command Claude Code runs for Mission Control, with the app open or closed.
//   pmc statusline <account>   statusLine command: saves the account's 5-hour/weekly usage and prints the status line.
//   pmc hook <account>         hook command (any event): appends the event to the spool the app reads.
//   pmc version
// It must never break a session: every failure is swallowed and the status line still prints.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { paths } from '../core/paths'
import { accountFromConfigDir, configuredAccounts, readLogins } from '../core/accounts'
import { noLimitsText, planOf } from '../core/logins'
import { appendActivity, describeHook, guardProtected, guardRules, setFocus } from '../core/live'
import { guardUnverified } from '../core/verify'
import type { AccountId } from '../core/types'
import { installStatusLine, uninstallStatusLine, statusLineState } from '../core/integrations'
import { turnFor, waitTurnText, wheelProjectOf, type TurnAnswer, type TurnFile } from '../core/chain'

/** The relay wheels' turn, as the app wrote it (turns.json). Old when the app has been closed a while: then nobody is held. */
function readTurn(account: string, cwd?: string): TurnAnswer {
  try {
    if (!cwd) return { inWheel: false }
    const file = JSON.parse(readFileSync(join(paths.root(), 'turns.json'), 'utf8')) as TurnFile
    if (Date.now() - file.at > 15 * 60_000) return { inWheel: false }
    return turnFor(file, account as AccountId, cwd)
  } catch { return { inWheel: false } }
}

const VERSION = '0.32.49'

function readStdin(): string {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
function when(ms: number): string {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return ms - Date.now() < 20 * 3600_000 ? hm : `${DAYS[d.getDay()]} ${hm}`
}

function pct(n: number): string {
  return `${Math.round(n)}%`
}

function color(n: number, s: string): string {
  const c = n >= 90 ? '31' : n >= 75 ? '33' : '2'
  return `\x1b[${c}m${s}\x1b[0m`
}

function statusline(accountArg?: string): void {
  const raw = readStdin()
  let data: any = {}
  try { data = JSON.parse(raw) } catch { /* print what we can */ }
  const account = (accountArg && /^claude\d{1,2}$/.test(accountArg) ? accountArg : accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR)) as string
  const now = Date.now()
  const rl = data?.rate_limits
  const five = rl?.five_hour
  const week = rl?.seven_day
  const spend = rl?.spend_limit
  try {
    mkdirSync(paths.liveSessionsDir(), { recursive: true })
    if (data?.session_id) {
      atomicWrite(
        join(paths.liveSessionsDir(), `${String(data.session_id).replace(/[^\w-]/g, '')}.json`),
        JSON.stringify({
          account,
          at: now,
          sessionId: data.session_id,
          sessionName: data.session_name,
          cwd: data.workspace?.current_dir ?? data.cwd,
          projectDir: data.workspace?.project_dir,
          model: data.model?.id,
          modelName: data.model?.display_name,
          contextPct: data.context_window?.used_percentage ?? null,
          costUsd: data.cost?.total_cost_usd ?? null,
          effort: data.effort?.level,
          version: data.version
        })
      )
    }
    if (five || week || spend) {
      const snap: any = { account, capturedAt: now, source: 'statusline', sessionId: data.session_id, model: data.model?.id }
      if (five && typeof five.used_percentage === 'number') snap.fiveHour = { usedPct: five.used_percentage, resetsAt: five.resets_at * 1000 }
      if (week && typeof week.used_percentage === 'number') snap.sevenDay = { usedPct: week.used_percentage, resetsAt: week.resets_at * 1000 }
      if (spend && typeof spend.used_percentage === 'number')
        snap.spend = { usedPct: spend.used_percentage, resetsAt: spend.resets_at * 1000, usedUsd: spend.used_usd, limitUsd: spend.limit_usd }
      const file = paths.usageFile(account)
      let prev: any
      try { prev = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first */ }
      atomicWrite(file, JSON.stringify(snap))
      const changed =
        !prev ||
        Math.round(prev.fiveHour?.usedPct ?? -1) !== Math.round(snap.fiveHour?.usedPct ?? -1) ||
        Math.round(prev.sevenDay?.usedPct ?? -1) !== Math.round(snap.sevenDay?.usedPct ?? -1) ||
        prev.fiveHour?.resetsAt !== snap.fiveHour?.resetsAt
      if (changed) {
        appendFileSync(
          paths.usageHistory(account),
          JSON.stringify({ at: now, five: snap.fiveHour?.usedPct, week: snap.sevenDay?.usedPct, fiveResets: snap.fiveHour?.resetsAt, weekResets: snap.sevenDay?.resetsAt }) + '\n'
        )
      }
    }
  } catch { /* never break the status line */ }

  // A statusLine the account had before Mission Control keeps running, chained after ours.
  let chained = ''
  try {
    const chainPath = join(paths.root(), 'statusline-chain.json')
    if (existsSync(chainPath)) {
      const prev = JSON.parse(readFileSync(chainPath, 'utf8'))[account]
      if (prev) chained = execSync(prev, { input: raw, timeout: 2500, encoding: 'utf8', windowsHide: true }).trimEnd()
    }
  } catch { /* the old one failed: ours still prints */ }

  const parts: string[] = [`\x1b[1m${account}\x1b[0m`]
  if (data?.model?.display_name) parts.push(data.model.display_name)
  const ctx = data?.context_window?.used_percentage
  if (typeof ctx === 'number') parts.push(`\x1b[2mcontexto\x1b[0m ${pct(ctx)}`)
  if (five?.used_percentage != null) parts.push(`5 h ${color(five.used_percentage, pct(five.used_percentage))} \x1b[2m↻ ${when(five.resets_at * 1000)}\x1b[0m`)
  if (week?.used_percentage != null) parts.push(`semana ${color(week.used_percentage, pct(week.used_percentage))} \x1b[2m↻ ${when(week.resets_at * 1000)}\x1b[0m`)
  if (!five && !week && !spend) {
    // EV146: Team, Enterprise, a key or a cloud never get `rate_limits`: said for what it is (cost when paying per use).
    let text = 'uso: aún sin datos'
    try { text = noLimitsText(planOf(readLogins()[account]), typeof data?.cost?.total_cost_usd === 'number' ? data.cost.total_cost_usd : undefined) } catch { /* the default */ }
    parts.push(`\x1b[2m${text}\x1b[0m`)
  }
  if (spend?.used_percentage != null) parts.push(`gasto ${pct(spend.used_percentage)}`)
  process.stdout.write((chained ? chained + '\n' : '') + parts.join(' \x1b[2m·\x1b[0m ') + '\n')
}

async function hook(accountArg?: string): Promise<void> {
  const raw = readStdin()
  try {
    const data = JSON.parse(raw)
    const account = accountArg && /^claude\d{1,2}$/.test(accountArg) ? accountArg : accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR)
    // EV52: with Mission Control's hooks both in the account and in the project, the same event comes twice, in two
    // processes at once: the first one to mark it does the work, the other one nothing. Any failure here: do the work.
    try {
      const { firstForEvent, hookEventKey, cleanEventMarks } = await import('../core/hookonce')
      const dir = join(paths.root(), 'usage', 'hooks-vistos')
      if (!firstForEvent(dir, hookEventKey(data, Date.now(), raw))) return
      if (Math.random() < 0.01) cleanEventMarks(dir)
    } catch { /* never lose an event for this */ }
    // What it is doing, for Mission Control's live view (a line in a file; no usage spent).
    try {
      const act = describeHook(data)
      if (act) appendActivity(account, act)
    } catch { /* never block */ }
    // Before (PreToolUse) or right after (PostToolUse) a tool: if another account took over this one's work, say it first.
    if (data.hook_event_name === 'PreToolUse' || data.hook_event_name === 'PostToolUse') {
      const { takeNotice } = await import('../core/coord')
      const notice = data.cwd ? takeNotice(account as AccountId, data.cwd) : undefined
      if (notice) {
        process.stdout.write(JSON.stringify(data.hook_event_name === 'PreToolUse'
          ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: notice } }
          : { decision: 'block', reason: notice }))
      } else if (data.hook_event_name === 'PreToolUse') {
        // Relay wheel: out of its turn an account does not touch the project (saving its hand-off with pmc is allowed).
        const cmd = String(data.tool_input?.command ?? '')
        // By the window's folder, and also by what it touches: a window opened in another project's folder that edits a
        // wheel's files, or names its folder in an order, is held to that wheel's turn (13-11).
        let t = readTurn(account, data.cwd)
        if (!t.inWheel) {
          const target = String(data.tool_input?.file_path ?? data.tool_input?.notebook_path ?? '')
          if (target) t = readTurn(account, target)
          if (!t.inWheel && cmd) {
            try {
              const f = JSON.parse(readFileSync(join(paths.root(), 'turns.json'), 'utf8')) as TurnFile
              const low = cmd.replace(/\//g, '\\').toLowerCase()
              const root = f.projects.flatMap((p) => p.roots).find((r) => r.length > 3 && low.includes(r.toLowerCase()))
              if (root) t = readTurn(account, root)
            } catch { /* no wheels */ }
          }
        }
        if (t.inWheel && !t.mine && t.holder && !/^\s*(?:&\s*)?pmc(?:\.cmd)?\s/i.test(cmd)) {
          process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: waitTurnText(account as AccountId, t.holder, t.project) } }))
          process.exit(0)
        }
        // A file the user left a note on is never overwritten or deleted.
        // EV139: and a task is not marked done in TASKS.md while its checks fail or were never run.
        const guard = guardProtected(data) ?? guardRules(data) ?? (() => { try { return guardUnverified(data) } catch { return undefined } })()
        if (guard) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: guard } }))
      }
      if (data.hook_event_name === 'PreToolUse') process.exit(0)
      if (!notice && data.cwd) {
        const { db, coord, projectOf } = await openShared()
        try {
          const project = projectOf(data.cwd)
          let text = project ? coord.deliverPending(db, project, account as AccountId) : ''
          // Near the end of its usage: close the block and write the hand-off now (said once per window and threshold).
          try {
            const { takePaceWarning } = await import('../core/pace')
            let auto = false
            try { auto = Boolean(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as any)?.value ?? '{}').autoRelay) } catch { /* off */ }
            const warn = takePaceWarning(account as AccountId, auto)
            if (warn) text = text ? `${warn}\n${text}` : warn
          } catch { /* never block */ }
          // EV93: this conversation's context is getting full (once at 60 % and once at 80 %).
          try {
            const { takeContextWarning } = await import('../core/contextwarn')
            const warn = takeContextWarning(data.session_id)
            if (warn) text = text ? `${warn}\n${text}` : warn
          } catch { /* never block */ }
          // Another account wrote this same file a moment ago.
          try {
            const file = data.tool_input?.file_path ?? data.tool_input?.notebook_path
            const shared = typeof file === 'string' ? coord.sharedFileWarning(db, account as AccountId, file, data.session_id, project?.id) : undefined
            if (shared) text = text ? `${text}\n${shared}` : shared
          } catch { /* never block */ }
          if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }))
        } finally {
          db.close()
        }
      }
    }
    const ev: any = {
      at: Date.now(),
      account,
      event: data.hook_event_name,
      sessionId: data.session_id,
      cwd: data.cwd,
      transcript: data.transcript_path,
      source: data.source ?? data.trigger ?? data.reason ?? data.matcher,
      tool: data.tool_name,
      file: data.tool_input?.file_path ?? data.tool_input?.notebook_path,
      error: data.error,
      message: typeof data.last_assistant_message === 'string' ? data.last_assistant_message.slice(0, 1200) : data.message,
      model: data.model
    }
    mkdirSync(paths.spoolDir(), { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    appendFileSync(join(paths.spoolDir(), `${day}.jsonl`), JSON.stringify(ev) + '\n')
    if (ev.event === 'SessionStart' || ev.event === 'Stop' || ev.event === 'PreCompact') await coordinate(ev.event, account as any, data.cwd, data)
  } catch { /* never block Claude */ }
  process.exit(0)
}

/** pmc gasto [días]: what each task of this project cost lately, from its claim to «hecha» (EV43). */
async function costCmd(args: string[]): Promise<void> {
  const say = (s: string) => process.stdout.write(s + '\n')
  const days = Math.max(1, Math.min(30, Number(args[0]) || 7))
  const since = Date.now() - days * 86400_000
  const { db, projectOf } = await openShared()
  try {
    const project = projectOf(process.cwd())
    if (!project) { say('Esta carpeta no pertenece a ningún proyecto de Mission Control.'); return }
    const { taskCosts, costByModel } = await import('../core/taskcost')
    const { readUsageHistory } = await import('../core/accounts')
    const { taskTags } = await import('../core/coord')
    const claims = db.prepare("SELECT at, account, title FROM events WHERE project_id = ? AND kind = 'reserva' AND at > ? AND account IS NOT NULL").all(project.id, since - 3 * 86400_000) as { at: number; account: string; title: string }[]
    const dones = db.prepare("SELECT at, title FROM events WHERE project_id = ? AND kind = 'tarea-hecha' AND at > ?").all(project.id, since) as { at: number; title: string }[]
    const history: Record<string, any[]> = {}
    for (const a of new Set(claims.map((c) => c.account))) history[a] = readUsageHistory(a as any, since - 3 * 86400_000)
    const models: Record<string, string | undefined> = {}
    for (const t of db.prepare("SELECT ext_id, title, COALESCE(detail, '') AS d FROM tasks WHERE project_id = ? AND ext_id IS NOT NULL").all(project.id) as { ext_id: string; title: string; d: string }[]) models[t.ext_id] = taskTags(`${t.title} ${t.d}`).model
    const costs = taskCosts(claims, dones, history, models)
    if (!costs.length) { say(`En ${project.name}, ningún caso en ${days} días (hace falta reservar con pmc claim y marcarla hecha).`); return }
    say(`Lo que costó cada tarea en ${project.name} (${days} días; puntos de la semana de la cuenta que la reservó, estimado):`)
    for (const c of [...costs].sort((a, b) => b.points - a.points).slice(0, 15)) say(`- ${c.task} · ${c.account} · ${c.points} puntos en ${c.minutes} min${c.model ? ` · [${c.model}]` : ''}`)
    say(`Media por modelo: ${costByModel(costs).map((m) => `${m.model} ${m.avgPoints} (${m.tasks})`).join(' · ')}`)
  } finally { db.close() }
}

/** pmc confianza [carpeta…]: marks the project folders (or those) as trusted in every account (EV103), as the app does. */
async function trustCmd(args: string[]): Promise<void> {
  const say = (s: string) => process.stdout.write(s + '\n')
  const { projectFolders, trustEverywhere } = await import('../core/trust')
  let folders = args.filter((a) => !a.startsWith('--'))
  if (!folders.length) {
    const { db } = await openShared()
    const { loadProjects } = await import('../core/projects')
    folders = projectFolders(loadProjects(db))
    db.close()
  }
  for (const r of trustEverywhere(configuredAccounts(), folders)) say(`${r.account}: ${r.added.length ? 'ahora confía en ' + r.added.join(', ') : r.skipped ?? 'ya confiaba en todas'}`)
}

/** pmc perfil [carpeta]: what Mission Control understands of a project. pmc preparar [carpeta] [--sin-agentes]: creates what it lacks. */
async function profileCmd(cmd: string, args: string[]): Promise<void> {
  const { detectProfile, prepareProject } = await import('../core/profile')
  const noAgents = args.includes('--sin-agentes')
  const root = args.find((a) => !a.startsWith('--')) ?? process.cwd()
  const p = detectProfile(root)
  // A work copy («rachas») is its project: the card and the texts say the project's name, not the folder's (13-11).
  try { const { projectOf, db } = await openShared(); const known = projectOf(root); if (known) p.name = known.name; db.close() } catch { /* the folder's name */ }
  const say = (s: string) => process.stdout.write(s + '\n')
  if (cmd === 'preparar') {
    const made = prepareProject(p, { agents: !noAgents, refreshAgents: true })
    say(made.length ? `Creado en ${p.name}: ${made.join(', ')}.` : `${p.name} ya tenía todo: no se ha creado nada.`)
    return
  }
  say(`${p.name}: ${p.summary}.`)
  say(`Galería (${p.mediaDirs.length} carpetas): ${p.mediaDirs.map((d) => d.slice(p.root.length + 1) || '(raíz)').join(', ') || 'ninguna'}`)
  say(`Comprobaciones: ${p.checks.map((c) => `${c.nombre} (${c.orden})`).join('; ') || 'ninguna detectada'}${p.docs.pmcJson ? ' · ya tiene pmc.json' : ''}`)
  say(`Recursos que no se comparten: ${p.heavy.join(', ') || 'ninguno'}`)
  const d = p.docs
  const missing = [!d.tasks && 'docs/TASKS.md', !d.relevo && 'docs/RELEVO.md', !d.state && 'docs/STATE.md', !d.decisions && 'docs/DECISIONS.md', !d.cadaSesion && '«Cada sesión» en CLAUDE.md', !d.pmcJson && p.checks.length && 'pmc.json', !d.skill && 'la skill .claude/skills/mission-control'].filter(Boolean)
  say(`Coordinación: ${missing.length ? 'falta ' + missing.join(', ') : 'completa'}`)
  const lacking = p.agents.filter((a) => !d.agents.includes(a.name)).map((a) => `${a.name} (${a.model})`)
  say(`Subagentes: ${d.agents.length ? 'tiene ' + d.agents.join(', ') : 'ninguno'}${lacking.length ? '; le convienen ' + lacking.join(', ') : ''}`)
  say(`Skills instaladas que le sirven: ${p.skills.join(', ') || 'ninguna'}`)
  if (missing.length || lacking.length) say('Para crear lo que falta (sin tocar lo que ya hay): pmc preparar')
}

/**
 * pmc puede-arrancar <cuenta> <proyecto>: run by a scheduled start before it opens anything. Exit 0 only if the dispatcher
 * says to open (core/dispatch.ts); otherwise it says why and exits 1, and the start does nothing.
 */
async function canStart(account?: string, projectId?: string): Promise<void> {
  const say = (s: string) => process.stdout.write(s + '\n')
  try {
    if (!account || !projectId) { say('Uso: pmc puede-arrancar <cuenta> <proyecto>'); process.exit(2) }
    const { decideLaunch, workingMap } = await import('../core/dispatch')
    const { listAgents, toLiveSession } = await import('../core/sessions')
    const { isSessionWorking } = await import('../core/working')
    const { db, projectOf } = await openShared()
    let status: Record<string, string | undefined> = {}
    let max = 1
    try { const ui = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as any)?.value ?? '{}'); status = ui.accountStatus ?? {}; max = Math.max(1, Number(ui.maxFronts) || 1) } catch { /* defaults */ }
    const acc = configuredAccounts().find((a) => a.id === account)
    if (!acc) { say(`No conozco la cuenta ${account}.`); process.exit(1) }
    const rows = await listAgents(acc)
    const windows = rows.map(toLiveSession).filter((x) => x.pid || isSessionWorking(x)).map((x) => ({
      account: account as AccountId, sessionId: x.sessionId, pid: x.kind === 'background' ? undefined : x.pid, projectId: projectOf(x.cwd)?.id, working: isSessionWorking(x)
    }))
    // The other accounts, from the summary the app keeps (who is working where).
    try {
      const team = JSON.parse(readFileSync(join(paths.root(), 'team.json'), 'utf8'))
      if (Date.now() - team.at < 30 * 60_000) for (const t of team.team ?? []) if (t.id !== account && t.state === 'trabajando' && t.projectId) windows.push({ account: t.id, sessionId: t.id, pid: undefined, projectId: t.projectId, working: true })
    } catch { /* app closed: only this account is known */ }
    db.close()
    // A relay wheel on this project decides by itself who works: a start out of turn opens nothing.
    try {
      const tf = JSON.parse(readFileSync(join(paths.root(), 'turns.json'), 'utf8')) as TurnFile
      const p = tf.projects.find((x) => x.id === projectId)
      const t = p ? readTurn(account, p.roots[0]) : undefined
      if (t?.inWheel && !t.mine && t.holder) { say(`Mission Control: este arranque no abre nada: en la rueda de relevos de ${t.project} tiene el turno Claude ${t.holder.slice(6)}.`); process.exit(1) }
    } catch { /* no wheel known */ }
    const d = decideLaunch({ account: account as AccountId, projectId, reason: 'arranque' }, { windows, status, workingOn: workingMap(windows), maxPerProject: max, lastOpened: {}, now: Date.now() })
    if (d.action === 'abrir') process.exit(0)
    say(`Mission Control: este arranque programado no abre nada. ${d.why}.`)
    appendActivity(account, { at: Date.now(), event: 'arranque', text: `Arranque programado sin abrir: ${d.why}` })
    process.exit(1)
  } catch (e) {
    // If the check itself fails, the start goes ahead as before rather than losing the work.
    say(`Mission Control: no se pudo comprobar (${(e as Error).message}); arranca igualmente.`)
    process.exit(0)
  }
}

/**
 * pmc turno [cuenta] [--cwd carpeta]: whose turn it is in the relay wheel of the project of that folder. Exit 0 when this
 * account may work there (its turn, or no wheel), 1 when it must wait. The wake hook of a project asks before waking.
 */
function turnCmd(args: string[]): void {
  const i = args.indexOf('--cwd')
  const cwd = i >= 0 ? args.splice(i, 2)[1] : process.cwd()
  const account = args.find((a) => /^claude\d{1,2}$/.test(a)) ?? accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR)
  const t = readTurn(account, cwd)
  if (!t.inWheel) { process.stdout.write(`${account}: esta carpeta no tiene una rueda de relevos encendida con esta cuenta; puede trabajar.\n`); process.exit(0) }
  const order = t.members.map((m) => 'Claude ' + m.slice(6)).join(' → ')
  if (t.mine) { process.stdout.write(`${account}: tiene el turno en ${t.project} (${order}).\n`); process.exit(0) }
  process.stdout.write(`${account}: espera su turno en ${t.project}; lo tiene Claude ${t.holder?.slice(6)} (${order}).\n`)
  process.exit(1)
}

/**
 * pmc skills-es: the skills (installed and suggested) still without a short description in Spanish, with their original
 * one. pmc skills-es <nombre> "texto": saves it; Mission Control › Skills shows it instead of the English one.
 */
/** The skills (installed and suggested) without their short description in Spanish yet, with the original one. */
async function skillsWithoutEs(projects: { id: string; root: string; copies: { path: string }[] }[], es?: Record<string, string>): Promise<Map<string, string>> {
  let known: Record<string, string> = es ?? {}
  if (!es) { try { known = JSON.parse(readFileSync(join(paths.root(), 'skills-es.json'), 'utf8')) } catch { /* none yet */ } }
  const { scanSkills } = await import('../core/skills')
  const { homedir } = await import('node:os')
  const accounts = configuredAccounts().map((a) => ({ id: a.id, configDir: a.configDir || join(homedir(), '.claude') }))
  const installed = scanSkills({ accounts, projects: projects.map((p) => ({ id: p.id, roots: [p.root, ...p.copies.map((c) => c.path)] })) })
  let cache: Record<string, { found: { skill: string; description?: string }[] }> = {}
  try { cache = JSON.parse(readFileSync(join(paths.root(), 'skills-search.json'), 'utf8')) } catch { /* no search yet */ }
  const todo = new Map<string, string>()
  for (const s of installed) { const n = s.name.replace(/^.*:/, ''); if (s.description && !known[n]) todo.set(n, s.description) }
  for (const c of Object.values(cache)) for (const f of c.found ?? []) if (f.description && !known[f.skill]) todo.set(f.skill, f.description)
  return todo
}

async function skillsEsCmd(args: string[]): Promise<void> {
  const say = (s: string) => process.stdout.write(s + '\n')
  const file = join(paths.root(), 'skills-es.json')
  let es: Record<string, string> = {}
  try { es = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first one */ }
  if (args.length >= 2) {
    es[args[0].replace(/^.*:/, '')] = args.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    atomicWrite(file, JSON.stringify(es, null, 1))
    say(`Guardada la descripción de ${args[0]}.`)
    return
  }
  const { db } = await openShared()
  const { loadProjects } = await import('../core/projects')
  const projects = loadProjects(db)
  db.close()
  const todo = await skillsWithoutEs(projects, es)
  if (!todo.size) { say('Todas las skills tienen ya su descripción en español.'); return }
  say(`Skills sin descripción en español (${todo.size}):`)
  for (const [n, d] of [...todo].slice(0, 80)) say(`- ${n}: ${d.slice(0, 220)}`)
  say('Para cada una, una frase en español sencilla, para alguien que no programa (qué hace y cuándo sirve, 160 caracteres como mucho): pmc skills-es <nombre> "texto".')
}

/**
 * EV145: `pmc llevar-skills <proyecto> <skill>…` takes skills of the accounts to the one project that uses them (they stop
 * weighing on every other project's sessions); `pmc devolver-skills <skill>…` puts them back. Only when the user asked.
 */
async function moveSkillsCmd(cmd: string, args: string[]): Promise<void> {
  const say = (...l: string[]) => process.stdout.write(l.join('\n') + '\n')
  const { takeSkillToProject, returnSkill, gitExcludeOf } = await import('../core/skillmove')
  const { homedir } = await import('node:os')
  if (cmd === 'devolver-skills') {
    if (!args.length) { say('Uso: pmc devolver-skills <skill> [<skill>…]'); process.exitCode = 2; return }
    for (const name of args) { try { const m = returnSkill(name); say(`Devuelta a las cuentas: ${name} (quitada de ${m.placed.length} copias de ${m.projectId})`) } catch (e) { say(`${name}: ${(e as Error).message}`); process.exitCode = 1 } }
    return
  }
  const [which, ...names] = args
  if (!which || !names.length) { say('Uso: pmc llevar-skills <proyecto> <skill> [<skill>…]'); process.exitCode = 2; return }
  const { db } = await openShared()
  const { loadProjects } = await import('../core/projects')
  const low = which.toLowerCase()
  const project = loadProjects(db).find((p) => p.id.toLowerCase() === low || p.name.toLowerCase() === low)
  if (!project) { say(`No hay ningún proyecto «${which}» en Mission Control.`); process.exitCode = 2; return }
  let accounts: { configDir?: string }[] = []
  try { accounts = JSON.parse(readFileSync(join(paths.root(), 'accounts.json'), 'utf8')) } catch { /* only the default one */ }
  const skillDirs = [...new Set([...accounts.map((a) => a.configDir || join(homedir(), '.claude')), join(homedir(), '.claude')].map((d) => join(d, 'skills')))]
  const copies = [project.root, ...project.copies.map((c) => c.path)]
  for (const name of names) {
    try {
      const m = takeSkillToProject({ name, projectId: project.id, accountSkillDirs: skillDirs, copies, gitExclude: gitExcludeOf(project.root) })
      say(`Llevada a ${project.name}: ${name} (en ${m.placed.length} copias; apartada en ${m.aside.length} carpeta${m.aside.length === 1 ? '' : 's'} de cuentas)`)
    } catch (e) { say(`${name}: ${(e as Error).message}`); process.exitCode = 1 }
  }
}

/** pmc recuerda "texto" [--regla|--preferencia|--dato]: saves something the project must not forget (Mission Control › Memoria). */
async function rememberCmd(args: string[]): Promise<void> {
  const say = (s: string) => process.stdout.write(s + '\n')
  const kind = args.includes('--regla') ? 'regla' : args.includes('--preferencia') ? 'preferencia' : 'dato'
  const text = args.filter((a) => !a.startsWith('--')).join(' ').trim()
  if (!text) { say('Uso: pmc recuerda "lo que no se debe olvidar" [--regla|--preferencia|--dato] [--todos]'); process.exitCode = 2; return }
  const { db, projectOf } = await openShared()
  try {
    const project = projectOf(process.cwd())
    if (!project) { say('Esta carpeta no pertenece a ningún proyecto de Mission Control.'); process.exitCode = 2; return }
    const { addMemory, listMemories } = await import('../core/memory')
    const { conflictsOf } = await import('../core/contradict')
    const clashes = conflictsOf(text, listMemories(db, project.id))
    // EV24: --todos keeps it for every project (the accounts, speaking Spanish…), given to every session of every project.
    const all = args.includes('--todos')
    const { ALL_PROJECTS } = await import('../core/memory')
    const m = addMemory(db, { projectId: all ? ALL_PROJECTS : project.id, kind: kind as any, text, source: accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR) })
    say(`Guardado en la memoria ${all ? 'de todos los proyectos' : 'de ' + project.name} (${m.kind}): lo leerán todas las sesiones al empezar y tras compactar.`)
    // 14-11: a long one was kept cut without a word; now it is said, so it is written shorter.
    if (text.replace(/\s+/g, ' ').trim().length > m.text.length) say(`Ojo: era demasiado largo y se ha guardado recortado («…${m.text.slice(-60)}»). Escríbelo en menos de 400 caracteres: lo leen todas las sesiones al empezar.`)
    // EV92: a memory that says the opposite of another one: the newer goes in at the start; the user decides which holds.
    if (clashes.length) say(`Ojo: parece decir lo contrario de ${clashes.map((c) => `«${c.text}»`).join(' y ')}. Al empezar las sesiones solo irá la nueva. Si no lo pidió así el usuario, pregúntale cuál vale con pmc decide.`)
  } finally { db.close() }
}

/** EV102: the course of the project of this folder, for the review (core/course.ts). */
async function courseCmd(): Promise<void> {
  const { db, projectOf } = await openShared()
  try {
    const project = projectOf(process.cwd())
    if (!project) { process.stdout.write('Esta carpeta no pertenece a ningún proyecto de Mission Control.\n'); process.exitCode = 2; return }
    const { listDecisions } = await import('../core/decisions')
    const { listMemories } = await import('../core/memory')
    const { courseText } = await import('../core/course')
    const decisions = listDecisions(db, project.id).map((d) => ({ title: d.title, choice: d.options.find((o) => o.id === d.choice)?.label ?? d.choice, note: d.note, status: d.status, at: d.decidedAt ?? d.updatedAt }))
    const notes = (db.prepare("SELECT body, status, created_at AS at FROM comments WHERE project_id = ? ORDER BY created_at DESC LIMIT 15").all(project.id) as { body: string; status: string; at: number }[])
    const discarded = [
      ...listDecisions(db, project.id).filter((d) => d.status === 'descartada').map((d) => `${d.title} (pregunta descartada)`),
      ...(db.prepare("SELECT COALESCE(ext_id, '') AS id, title FROM tasks WHERE project_id = ? AND gone = 1 ORDER BY updated_at DESC LIMIT 10").all(project.id) as { id: string; title: string }[]).map((t) => `${t.id ? t.id + ' · ' : ''}${t.title} (tarea quitada de TASKS)`)
    ]
    process.stdout.write(courseText({ project: project.name, decisions, memories: listMemories(db, project.id), notes, discarded }) + '\n')
    try { writeFileSync(join(paths.root(), `rumbo-${project.id}.txt`), String(Date.now())) } catch { /* next time */ }
  } finally { db.close() }
}
/** Opens the shared database only when needed (SessionStart, Stop, claim): the status line never pays for it. */
async function openShared() {
  process.removeAllListeners('warning')
  process.on('warning', () => {})
  const { openDb } = await import('../core/db')
  const { loadProjects, projectForPath } = await import('../core/projects')
  const coord = await import('../core/coord')
  const db = openDb()
  // EV164: what the Claudes are told goes in the app's language (Ajustes › Idioma; none chosen: the system's, as the app).
  const { getSetting } = await import('../core/db')
  const { pickLang, setLang } = await import('../core/i18n')
  setLang(pickLang(getSetting<{ lang?: string }>(db, 'ui', {}).lang, Intl.DateTimeFormat().resolvedOptions().locale))
  return { db, coord, projectOf: (cwd: string) => projectForPath(loadProjects(db), cwd).project }
}

async function coordinate(event: string, account: AccountId, cwd?: string, data?: any): Promise<void> {
  const { db, coord, projectOf } = await openShared()
  try {
    // EV76: what the summary must keep when the conversation is compacted (Claude Code adds this to its instructions).
    if (event === 'PreCompact') {
      const project = cwd ? projectOf(cwd) : undefined
      if (!project) return
      const { compactInstructions } = await import('../core/compact')
      const { listMemories } = await import('../core/memory')
      const { liveRelevo } = await import('../core/brief')
      const task = db.prepare('SELECT ext_id AS id, title FROM tasks WHERE project_id = ? AND key = ?')
      const claims = coord.listClaims(db, project.id).filter((c) => c.account === account).map((c) => {
        const t = task.get(project.id, c.taskKey) as { id?: string; title?: string } | undefined
        return { id: t?.id ?? c.taskKey, title: t?.title, note: c.note }
      })
      const rules = listMemories(db, project.id).filter((m) => m.kind === 'regla').map((m) => m.text)
      let enCurso: string | undefined
      try { enCurso = liveRelevo(readFileSync(join(project.root, 'docs', 'RELEVO.md'), 'utf8')).enCurso } catch { /* no handoff */ }
      process.stdout.write(compactInstructions({ project: project.name, claims, rules, enCurso }))
      return
    }
    if (event === 'Stop') {
      coord.renewClaims(db, account)
      // EV154: a note typed into its window and answered without using any tool was read too.
      try {
        const project = cwd ? projectOf(cwd) : undefined
        if (project) (await import('../core/notes')).confirmTyped(db, project.id, account)
      } catch { /* never block */ }
      // Autonomous mode: while there is work for it here, the session is told to go on instead of ending its turn.
      try {
        let on = false
        let offIn: string[] = []
        try {
          const ui = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as any)?.value ?? '{}')
          on = Boolean(ui.autonomous)
          offIn = Array.isArray(ui.autonomyOff) ? ui.autonomyOff : []
        } catch { /* off */ }
        // Out of its turn in a relay wheel: it is meant to stop and wait, never told to go on. And an account that belongs
        // to a wheel on another project is not kept going here (the wheel moved on, 13-11: its place is over there).
        // But whoever HOLDS a wheel's turn is kept going on that wheel's project, wherever its window was opened (13-11: the
        // holder of Mission Control's wheel, in a window opened in the game project's folder, was let stop).
        const turn = readTurn(account, cwd)
        let wheelProject: string | undefined
        if (turn.inWheel && !turn.mine) on = false
        if (!turn.inWheel) {
          try {
            const f = JSON.parse(readFileSync(join(paths.root(), 'turns.json'), 'utf8')) as TurnFile
            if (Date.now() - f.at < 15 * 60_000) {
              const held = f.projects.find((p) => (p.holder === account || p.outgoing === account) && p.phase !== 'espera')
              if (held) { on = true; wheelProject = held.id } else if (wheelProjectOf(f, account as AccountId)) on = false
            }
          } catch { /* no wheels */ }
        }
        // EV159: opened for one task only: it stops when it is done, autonomous mode or wheel or not.
        try { const { onlyTaskOf } = await import('../core/onlytask'); if (onlyTaskOf(account)) on = false } catch { /* as before */ }
        // EV146: never kept going on an account that pays per use (no limit would cut it: it would spend until its credit ends).
        try { const { autonomyFor } = await import('../core/autonomy'); if (on && !autonomyFor(planOf(readLogins()[account]))) on = false } catch { /* as before */ }
        const { loadProjects } = await import('../core/projects')
        const project = !on ? undefined : wheelProject ? loadProjects(db).find((p) => p.id === wheelProject) : cwd ? projectOf(cwd) : undefined
        // EV28: a project the user took out of autonomous mode lets its sessions end their turn.
        if (project && data?.session_id && !offIn.includes(project.id)) {
          const { keepGoing, readBlocks, noteBlock, lastUserPrompt } = await import('../core/autonomy')
          const blocks = readBlocks(data.session_id)
          // The holder of a wheel with an agenda goes on with the agenda's section first (13-11: it was offered old tasks).
          let section: string | undefined
          try { const f = JSON.parse(readFileSync(join(paths.root(), 'turns.json'), 'utf8')) as TurnFile; section = f.projects.find((p) => p.id === project.id && p.holder === account)?.section?.toLowerCase() } catch { /* no wheels */ }
          const pool = coord.nextTasks(db, project.id, account, 40)
          const inSection = section ? new Set((db.prepare('SELECT key FROM tasks WHERE project_id = ? AND gone = 0 AND lower(section) LIKE ?').all(project.id, `%${section}%`) as { key: string }[]).map((r) => r.key)) : undefined
          const agenda = inSection ? pool.filter((t) => inSection.has(t.key)) : []
          const next = (agenda.length ? agenda : pool).slice(0, 4).map((t) => `${t.extId ?? ''} ${t.title.slice(0, 90)}`.trim())
          // EV121: with nothing left here, where it could go on (not for an account kept for one project, nor into a
          // project kept for another account, or out of autonomous mode; `readOnly` is only about the app writing there).
          let elsewhere: { project: string; root: string; next: string[] }[] = []
          if (!next.length) {
            try {
              const ui = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as any)?.value ?? '{}')
              const reserves = (Array.isArray(ui.reserves) ? ui.reserves : []) as { account: string; projectId: string; on: boolean }[]
              if (!reserves.some((r) => r.on && r.account === account)) {
                elsewhere = loadProjects(db)
                  .filter((p) => p.id !== project.id && !offIn.includes(p.id) &&!reserves.some((r) => r.on && r.projectId === p.id))
                  .map((p) => ({ project: p.name, root: p.root, next: coord.nextTasks(db, p.id, account, 3).map((t) => `${t.extId ?? ''} ${t.title.slice(0, 70)}`.trim()) }))
                  .filter((p) => p.next.length)
              }
            } catch { /* nowhere else */ }
          }
          const outgoing = turn.inWheel && Boolean(turn.outgoing)
          const reason = keepGoing({ autonomous: on, next, lastPrompt: lastUserPrompt(data.transcript_path), blocks, project: project.name, elsewhere, outgoing })
          if (reason) { noteBlock(data.session_id, blocks); process.stdout.write(JSON.stringify({ decision: 'block', reason })) }
        }
      } catch { /* never block Claude by mistake */ }
      return
    }
    const project = cwd ? projectOf(cwd) : undefined
    if (!project) return
    let text = coord.sessionContext(db, project, account)
    const t = readTurn(account, cwd)
    if (t.inWheel && t.holder) {
      const line = t.mine
        ? `Mission Control · rueda de relevos de ${t.project} (${t.members.map((m) => 'Claude ' + m.slice(6)).join(' → ')}): tienes el turno. Trabaja hasta quedarte sin uso; entonces seguirá la siguiente de la rueda con lo que dejes en el relevo.`
        : waitTurnText(account, t.holder, t.project)
      text = text ? `${line}\n${text}` : line
    }
    // EV81: skills still in English only, for the one who works here now (the user reads Skills in Spanish).
    if (!t.inWheel || t.mine) {
      try {
        const { loadProjects } = await import('../core/projects')
        const n = (await skillsWithoutEs(loadProjects(db))).size
        if (n) text = `${text ? text + '\n' : ''}Hay ${n} skill${n === 1 ? '' : 's'} sin explicar en español: al cerrar un bloque, ${'pmc'} skills-es y escribe una frase sencilla por cada una (pmc skills-es <nombre> "texto").`
      } catch { /* the package goes without it */ }
    }
    // EV64: what the user asked and nobody wrote down, for whoever works here (the app writes requests.json every 10 min).
    if (!t.inWheel || t.mine) {
      try {
        const req = (JSON.parse(readFileSync(join(paths.root(), 'requests.json'), 'utf8')).projects?.[project.id] ?? []) as { text: string }[]
        if (req.length) text = `${text ? text + '\n' : ''}El usuario pidió y nadie lo apuntó (Memoria › Lo que has pedido): ${req.slice(0, 3).map((r) => `«${r.text}»`).join('; ')}${req.length > 3 ? ` y ${req.length - 3} más` : ''}. Al cerrar un bloque, apunta en TASKS lo que siga pendiente; lo que ya esté hecho (aquí o en otra carpeta), ciérralo con pmc pedido-hecho "un trozo de su texto".`
      } catch { /* no list yet */ }
    }
    // EV102: once a week per project, the one who works here reviews the project's course (pmc rumbo writes the date).
    if (!t.inWheel || t.mine) {
      try {
        const mark = join(paths.root(), `rumbo-${project.id}.txt`)
        let last = 0
        try { last = Number(readFileSync(mark, 'utf8')) || 0 } catch { /* never */ }
        if (Date.now() - last > 7 * 86400_000) text = `${text ? text + '\n' : ''}Hace más de una semana sin repasar el rumbo de ${project.name}: al cerrar un bloque, pmc rumbo y sigue sus pasos (quitar solo lo que el usuario dijo que ya no quiere; lo dudoso, pregúntalo).`
      } catch { /* the package goes without it */ }
    }
    // EV109: the project's card. Missing: the one who works here makes it; with gaps: fills them; whole: one pointer.
    if (!t.inWheel || t.mine) {
      try {
        const card = join(cwd!, 'docs', 'PROYECTO.md')
        const body = existsSync(card) ? readFileSync(card, 'utf8') : ''
        const line = !body
          ? `${project.name} no tiene ficha (docs/PROYECTO.md: qué es, dónde está cada cosa, cómo se comprueba y cómo trabajarlo): créala con pmc preparar y complétala leyendo el proyecto al cerrar tu primer bloque.`
          : body.includes('(por completar)')
            ? `La ficha de ${project.name} (docs/PROYECTO.md) tiene huecos «(por completar)»: al cerrar tu primer bloque, rellénalos leyendo el proyecto (10 min como mucho).`
            : `Si no conoces ${project.name}, su ficha es docs/PROYECTO.md (una página).`
        text = `${text ? text + '\n' : ''}${line}`
      } catch { /* the package goes without it */ }
    }
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }))
  } finally {
    db.close()
  }
}

/** pmc claim <ID> [nota] · pmc release <ID> · pmc claims — for the agents, from the project folder. */
async function claims(cmd: string, args: string[]): Promise<void> {
  const say = (...l: string[]) => process.stdout.write(l.join('\n') + '\n')
  const accIdx = args.indexOf('--cuenta')
  const account = (accIdx >= 0 ? args.splice(accIdx, 2)[1] : accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR)) as AccountId
  const { db, coord, projectOf } = await openShared()
  try {
    const project = projectOf(process.cwd())
    if (!project) { say('Esta carpeta no pertenece a ningún proyecto de Mission Control.'); process.exitCode = 2; return }
    if (cmd === 'claims') {
      const list = coord.listClaims(db, project.id)
      if (!list.length) say('Ninguna tarea reservada.')
      for (const c of list) say(`${c.taskKey}\t${c.account}\t${c.abandoned ? 'CADUCADA (abandonada)' : 'hasta ' + new Date(c.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${c.note ? '\t' + c.note : ''}`)
      return
    }
    if (cmd === 'relevo') {
      const from = args[0] as AccountId
      if (!/^claude\d{1,2}$/.test(from ?? '') || from === account) { say('Uso: pmc relevo <claudeN> (la cuenta que no puede seguir)'); process.exitCode = 2; return }
      const { readText } = await import('../core/projects')
      const { parseRelevo } = await import('../core/parse/relevo')
      const { execFileSync } = await import('node:child_process')
      const { existsSync: ex } = await import('node:fs')
      const enCurso: string[] = []
      let heartbeat: { at: number; text: string } | undefined
      for (const d of project.docsDirs) {
        const f = join(d, 'RELEVO.md')
        if (!ex(f)) continue
        const text = readText(f)
        for (const line of text.split(/\r?\n/)) if (/^\*\*(?:En curso|In progress)/i.test(line) && line.includes(from)) enCurso.push(line.replace(/\*\*/g, '').slice(0, 500))
        for (const h of parseRelevo(text, f).heartbeats) if (h.account === from && (!heartbeat || h.at > heartbeat.at)) heartbeat = { at: h.at, text: h.text }
      }
      const copies = project.copies.map((c) => {
        let dirty = 0
        try { dirty = execFileSync('git', ['--no-optional-locks', '-C', c.path, 'status', '--porcelain'], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).split(/\r?\n/).filter(Boolean).length } catch { /* not git */ }
        return { label: c.label, branch: c.branch, dirty, path: c.path }
      })
      let fromState: string | undefined, backAt: number | undefined
      try {
        const t = JSON.parse(readFileSync(join(paths.root(), 'team.json'), 'utf8')).team.find((x: any) => x.id === from)
        fromState = t?.state === 'sin-uso' ? 'sin uso' : t?.state
        backAt = t?.backAt
      } catch { /* app not running */ }
      say(coord.takeOver(db, { project, from, to: account, enCurso: [...new Set(enCurso)], heartbeat, copies, fromState, backAt }))
      return
    }
    if (cmd === 'plan') {
      // pmc plan: how many accounts are worth running at once on this project now, and on what (read only).
      const { planFronts } = await import('../core/plan')
      const res = await import('../core/resources')
      const held = new Set(coord.listClaims(db, project.id).filter((c) => !c.abandoned).map((c) => c.taskKey))
      const tasks = (db.prepare("SELECT key, ext_id, title, detail, section, priority, COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND gone = 0 AND COALESCE(override, status) IN ('pendiente', 'planificada', 'en-desarrollo') ORDER BY priority, st != 'en-desarrollo', source_line IS NULL, source_line").all(project.id) as any[])
        .filter((r) => !held.has(r.key))
      const open = new Set(tasks.map((r) => r.ext_id).filter(Boolean))
      const free = tasks.filter((r) => !coord.taskTags(`${r.title} ${r.detail ?? ''}`).after.some((id) => id !== r.ext_id && open.has(id)))
        .map((r) => ({ key: r.key, extId: r.ext_id ?? undefined, title: r.title, detail: r.detail, section: r.section, priority: r.priority, status: r.st }))
      let team: any = { team: [], order: [] }
      try { team = JSON.parse(readFileSync(join(paths.root(), 'team.json'), 'utf8')) } catch { /* app not running */ }
      let ui: any = {}
      try { ui = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as any)?.value ?? '{}') } catch { /* defaults */ }
      const place = (id: string) => { const n = (team.order ?? []).indexOf(id); return n < 0 ? 1e6 : n }
      const accounts = (team.team as any[]).filter((t) => !t.status && t.state !== 'sin-uso' && t.state !== 'desconectado' && (t.weekFree == null || t.weekFree >= 5))
        .sort((a, b) => place(a.id) - place(b.id)).map((t) => ({ id: t.id, weekFree: t.weekFree, hasFable: !(ui.noFable ?? []).includes(t.id) }))
      const b = res.detectBusy()
      const busy = [...res.heldResources(db).map((h) => h.name), ...(b.playing || (b.userApps.length && !res.fullPowerOn(db)) ? ['unity', 'gpu', 'build'] : [])]
      const plan = planFronts({ tasks: free, accounts, freeCopies: project.copies.map((c) => c.label), busy, max: Number(ui.maxFronts) || 3 })
      for (const f of plan.fronts) say(`${f.account}\t${f.task}\ten ${f.copy}${f.model ? `\t[${f.model}]` : ''}${f.needs.length ? `\tnecesita ${f.needs.join(', ')}` : ''}`)
      say(`${plan.fronts.length ? 'Reparto propuesto' : 'Sin reparto'}: ${plan.why}.${plan.queue.length ? ` En cola de relevo: ${plan.queue.join(', ')}.` : ''}`)
      return
    }
    if (cmd === 'verifica') {
      const v = await import('../core/verify')
      const solo = args.indexOf('--solo')
      const only = solo >= 0 ? args.splice(solo, 2)[1] : undefined
      // --ligeras: only the checks that need no shared resource (the routine after each commit, EV44).
      const li = args.indexOf('--ligeras')
      const light = li >= 0 ? Boolean(args.splice(li, 1)) : false
      const root = v.copyRootFor(project, process.cwd())
      let checks: import('../core/verify').Check[] | undefined
      try { checks = v.readChecks(root) } catch (e) { say(`pmc.json no se puede leer: ${(e as Error).message}`); process.exitCode = 2; return }
      if (light && checks) checks = checks.filter((c) => !c.recurso && !c.pesada)
      if (!checks?.length) { say(`Este proyecto no ha declarado comprobaciones (falta "verifica" en ${join(root, 'pmc.json')}). Ejemplo: { "verifica": [ { "nombre": "pruebas", "orden": "npm test" } ] }. Sin ellas, di en la entrega qué has comprobado tú y cómo.`); process.exitCode = 2; return }
      const key = args[0] ? coord.taskKeyFor(db, project.id, args[0]).key : undefined
      if (args[0]) {
        const { acceptanceOf } = await import('../core/acceptance')
        const { taskText } = await import('../core/brief')
        const c = acceptanceOf(taskText(db, project, args[0], Date.now(), { all: true }) ?? undefined)
        if (c) say(`Criterio de la tarea (compruébalo además de estas pruebas): ${c}.`)
      }
      const res = v.runVerification(db, project, root, account, key, checks, { only })
      say(v.verificationReport(res, key ? v.failStreak(db, project.id, key) : res.outcome === 'falla' ? 1 : 0))
      if (res.outcome === 'falla') process.exitCode = 1
      return
    }
    if (cmd === 'recurso' || cmd === 'recursos') {
      const res = await import('../core/resources')
      const free = args.indexOf('--soltar')
      if (free >= 0) args.splice(free, 1)
      const name = cmd === 'recurso' ? args[0] : undefined
      if (cmd === 'recurso' && !name) { say('Uso: pmc recurso <unity|gpu|build|…> ["para qué"] · pmc recurso <nombre> --soltar · pmc recursos'); process.exitCode = 2; return }
      if (name && free >= 0) { say(res.freeResource(db, name, account) ? `Suelto: ${name}.` : `No tenías cogido ${name}.`); return }
      const busy = res.detectBusy()
      if (name) {
        const r = res.holdResource(db, name, account, args.slice(1).join(' ') || undefined)
        if (!r.ok) { say(`${name} lo tiene ${r.holder.account}${r.holder.note ? ` (${r.holder.note})` : ''} hasta las ${new Date(r.holder.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}. Sigue con algo que no lo necesite.`); process.exitCode = 1 }
        else say(`Tuyo: ${name}. Suéltalo al acabar con pmc recurso ${name} --soltar (si no, caduca solo).`)
      }
      say(res.resourcesText(db, account, busy) || 'Nada ocupado: ni programas del usuario, ni Unity, ni la gráfica.')
      // EV112: who loads the machine now, with the Claude behind each process; before a heavy job, a warning if it is full.
      const load = res.machineLoad()
      if (load) {
        say(res.loadText(load))
        if (name && free < 0 && (load.cpuPct >= 75 || load.freeMb / load.totalMb < 0.15)) say('El PC ya va cargado: si lo tuyo es pesado, espera a que acabe lo de arriba o haz antes algo ligero (y dilo en el relevo).')
      }
      return
    }
    if (cmd === 'parte' || cmd === 'tarea') {
      const { briefText, taskText } = await import('../core/brief')
      if (cmd === 'parte') {
        const res = await import('../core/resources')
        const busy = res.resourcesText(db, account, res.detectBusy())
        // 12-11: with the Stop hook in the background, autonomous mode never kept a session going. Said where it reads.
        const { hooksState } = await import('../core/integrations')
        const acc = configuredAccounts().find((a) => a.id === account)
        const stale = acc && hooksState(acc).outdated
        say(briefText(db, project, account) + (busy ? `
RECURSOS: ${busy}` : '') + (stale ? `
AVISO: tu coordinación con Mission Control está desactualizada (el modo autónomo no te frena al acabar una respuesta). Díselo al usuario una vez: en Inicio › Para ti, «Actualiza la coordinación». Mientras, no termines el turno por tu cuenta: guarda y sigue.` : ''))
        return
      }
      // --todo: with every note of every account (by default only the newest, to spare context).
      const all = args.includes('--todo')
      const tid = args.find((a) => !a.startsWith('--'))
      if (!tid) { say('Uso: pmc tarea <ID> [--todo]'); process.exitCode = 2; return }
      const text = taskText(db, project, tid, Date.now(), { all })
      say(text ?? `No hay ninguna tarea «${tid}» en ${project.name}.`)
      // EV78: what «done» means for this task, said apart so it is checked before closing it.
      if (text) { const { acceptanceLine } = await import('../core/acceptance'); say(acceptanceLine(text)) }
      return
    }
    if (cmd === 'next') {
      const list = coord.nextTasks(db, project.id, account)
      if (!list.length) { const { IDLE_IDEA } = await import('../core/brief'); say(`No queda ninguna tarea libre en docs/TASKS.md (las que esperan al usuario o un hecho real no cuentan). ${IDLE_IDEA}`); return }
      const P = ['URGENTE', 'alta', '', 'baja']
      for (const t of list) say(`${t.extId ?? t.key}\t${t.title}${P[t.priority] ? `\t[${P[t.priority]}]` : ''}${t.change ? `\t(el usuario pide este cambio al revisarla: ${t.change})` : ''}${t.assignedFrom ? `\t(encargo del usuario: era de ${t.assignedFrom})` : ''}${t.status === 'en-desarrollo' ? '\t(a medias)' : ''}${t.mine ? '\t(reservada por ti)' : ''}${t.model ? `\t[basta con ${t.model}]` : ''}`)
      say('Reserva la primera que puedas hacer con pmc claim <ID>.')
      return
    }
    if (cmd === 'decide') {
      const { addDecision, parseMediaArg, jargonIn, recentOnTask, alreadyAskedText } = await import('../core/decisions')
      const { resolve } = await import('node:path')
      // EV147: --otra (no value) lets through a different question on a task that already has a recent one.
      const otherAt = args.indexOf('--otra')
      if (otherAt >= 0) args.splice(otherAt, 1)
      // --clara takes no value: before, «--clara» at the end went into the title, and before another flag it ate it.
      const clearAt = args.indexOf('--clara')
      if (clearAt >= 0) args.splice(clearAt, 1)
      const flags: Record<string, string[]> = {}
      const free: string[] = []
      for (let i = 0; i < args.length; i++) {
        const m = args[i].match(/^--(\w+)$/)
        if (m && i + 1 < args.length) (flags[m[1]] ??= []).push(args[++i])
        else free.push(args[i])
      }
      const title = (flags.titulo?.[0] ?? free.join(' ')).trim()
      if (!title) { say('Uso: pmc decide "título" --pregunta "…" --opcion "A: detalle" --foto "ruta::qué se ve" --audio "ruta::qué es::para qué momento" --video "ruta::…" [--contexto "…"] [--tarea ID] [--prioridad urgente|alta|normal|baja] [--clave <id>] [--otra]'); process.exitCode = 2; return }
      const prio = { urgente: 0, alta: 1, normal: 2, baja: 3 }[(flags.prioridad?.[0] ?? 'normal').toLowerCase() as 'normal'] ?? 2
      // 13-11, #140: «no entiendo bien la pregunta». A question with words he does not know is sent back to be rewritten.
      const jargon = clearAt >= 0 || flags.clara ? [] : jargonIn(title, flags.pregunta?.join(' '), flags.contexto?.join(' '), ...(flags.opcion ?? []))
      if (jargon.length) {
        say(`No guardada: la pregunta lleva palabras que el usuario no conoce (${jargon.join(', ')}). El 13-11 contestó a una así «no entiendo muy bien esto… quiero que todo sea lo más automático e intuitivo posible». Escríbela con lo que él verá o notará (qué cambia para él, en español sencillo, sin nombres de archivos ni de código) y vuelve a lanzarla. Antes piensa si hace falta preguntar: si una opción es claramente mejor y se puede deshacer, hazla y cuéntaselo. Si la palabra es de verdad imprescindible, añade --clara.`)
        process.exitCode = 2
        return
      }
      // EV147: the same task asked about in the last 12 h (13-11: #147 asked again what #145 had been answered).
      const prev = otherAt < 0 ? recentOnTask(db, project.id, flags.tarea?.[0]) : undefined
      if (prev) { say(alreadyAskedText(prev)); process.exitCode = 2; return }
      const d = addDecision(db, {
        projectId: project.id, title, question: flags.pregunta?.join(' '), context: flags.contexto?.join(' '),
        options: flags.opcion ?? [],
        images: [...(flags.foto ?? []), ...(flags.video ?? []), ...(flags.audio ?? []), ...(flags.archivo ?? [])].map((f) => { const m = parseMediaArg(f); return { ...m, path: resolve(process.cwd(), m.path) } }),
        askedBy: account, taskExtId: flags.tarea?.[0], priority: prio, dedupe: flags.clave?.[0],
        defaultChoice: flags.defecto?.[0], waitHours: flags.espera?.[0] ? Number(String(flags.espera[0]).replace(',', '.')) : undefined
      })
      if (d.defaultChoice && d.waitUntil) say(`Si el usuario no contesta antes de las ${new Date(d.waitUntil).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}, se tomará «${d.options.find((o) => o.id === d.defaultChoice)?.label}» y te llegará como respuesta.`)
      else if (d.options.length) say('Sin opción por defecto: si el usuario no está, la pregunta esperará. La próxima vez añade --defecto "A" [--espera 12] (horas).')
      const asked = (flags.foto?.length ?? 0) + (flags.video?.length ?? 0) + (flags.audio?.length ?? 0) + (flags.archivo?.length ?? 0)
      const lost = asked - d.images.length
      const n = (k: string) => d.images.filter((m) => m.kind === k).length
      const what = [n('image') && `${n('image')} foto${n('image') > 1 ? 's' : ''}`, n('audio') && `${n('audio')} sonido${n('audio') > 1 ? 's' : ''}`, n('video') && `${n('video')} vídeo${n('video') > 1 ? 's' : ''}`].filter(Boolean).join(', ')
      say(`Pregunta guardada (#${d.id}) en Mission Control › Decidir${what ? ` con ${what}` : ' SIN NADA QUE VER NI OÍR: si preguntas por algo concreto, añade fotos (--foto) o sonidos (--audio)'}${lost > 0 ? ` (${lost} no se encontraron)` : ''}. No esperes: sigue con otra tarea; la respuesta del usuario te llegará sola.`)
      return
    }
    if (cmd === 'entrega' || cmd === 'trabajo') {
      const { parseMediaArg } = await import('../core/decisions')
      const { resolve } = await import('node:path')
      // --clara (no value): a word the user does not know is really needed in what he reads.
      const clearAt = args.indexOf('--clara')
      const clear = clearAt >= 0
      if (clear) args.splice(clearAt, 1)
      const flags: Record<string, string[]> = {}
      const free: string[] = []
      for (let i = 0; i < args.length; i++) {
        const m = args[i].match(/^--(\w+)$/)
        if (m && i + 1 < args.length) (flags[m[1]] ??= []).push(args[++i])
        else free.push(args[i])
      }
      if (cmd === 'trabajo') {
        const { addJob } = await import('../core/jobs')
        const title = free.join(' ').trim()
        if (!title) { say('Uso: pmc trabajo "título" --log ruta --salida ruta [--pid N]'); process.exitCode = 2; return }
        const full = (x?: string) => (x ? resolve(process.cwd(), x) : undefined)
        addJob({ title, projectId: project.id, account, log: full(flags.log?.[0]), output: full(flags.salida?.[0]), pid: flags.pid?.[0] ? Number(flags.pid[0]) : undefined })
        say(`Mission Control enseña «${title}» en Inicio: cuánto queda, y si se corta.`)
        return
      }
      const { setTaskCard } = await import('../core/cards')
      const id = free[0]
      if (!id) { say('Uso: pmc entrega <ID> --que "qué es, en una frase sin tecnicismos" --mirar "qué tiene que mirar" --foto "ruta::qué se ve" --audio "ruta::qué es" --video "ruta::qué se ve" [--clara]'); process.exitCode = 2; return }
      // EV122: what the user reads in Revisar, in his words, checked before it is saved (14-11: saved with «API», then redone).
      if (!clear) {
        try {
          const { jargonIn } = await import('../core/decisions')
          const jargon = jargonIn(flags.que?.join(' '), flags.mirar?.join(' '))
          if (jargon.length) { say(`No guardada: lo que el usuario leerá en Revisar lleva palabras que no conoce (${jargon.join(', ')}). Escribe --que y --mirar en español sencillo (qué ha cambiado para él y qué tiene que mirar o probar) y vuelve a lanzarla; si la palabra es imprescindible, añade --clara.`); process.exitCode = 2; return }
        } catch { /* a reminder only */ }
      }
      const files = [...(flags.foto ?? []), ...(flags.video ?? []), ...(flags.audio ?? [])].map((f) => { const m = parseMediaArg(f); return { ...m, path: resolve(process.cwd(), m.path) } })
      const c = setTaskCard(db, { projectId: project.id, extId: id, simple: flags.que?.join(' '), ask: flags.mirar?.join(' '), files, account })
      const lost = files.length - c.media.length
      // EV117: a delivery leaves a line in the history (Cronología) and can be counted, with or without something to see.
      try {
        const { addEvent } = await import('../core/db')
        addEvent(db, { projectId: project.id, at: Date.now(), account, kind: 'entrega', title: `Entrega de ${id}${flags.que?.length ? `: ${flags.que.join(' ').slice(0, 140)}` : ''}`, detail: c.media.length ? `${c.media.length} archivo${c.media.length === 1 ? '' : 's'} para ver u oír` : 'sin nada que ver ni oír', source: 'pmc entrega', ref: id })
      } catch { /* the card is saved anyway */ }
      const { finishChange } = await import('../core/changes')
      const closed = finishChange(db, project.id, id)
      {
        const v = await import('../core/verify')
        const root = v.copyRootFor(project, process.cwd())
        let declared = false
        try { declared = Boolean(v.readChecks(root)?.length) } catch { /* said by pmc verifica */ }
        const last = v.lastVerification(db, project.id, coord.taskKeyFor(db, project.id, id).key)
        if (declared && (!last || last.outcome !== 'bien')) say(last ? `AVISO: ${v.verificationLine(last)} El usuario lo verá así en la tarea.` : `AVISO: ${id} se entrega sin verificar. Pasa antes pmc verifica ${id}; si ahora no se puede, dilo en el relevo.`)
      }
      say(`Ficha de ${id} guardada: ${c.media.length} archivo${c.media.length === 1 ? '' : 's'}${files.length && lost > 0 ? ` (${lost} no se encontraron)` : ''}.${c.media.length ? '' : ' SIN NADA QUE VER NI OÍR: si se ve o se oye, añade --foto o --audio.'}${closed ? ' Los cambios que pidió el usuario quedan hechos: vuelve a «Para revisar».' : ''}`)
      return
    }
    if (cmd === 'corregido') {
      // A note the user left on an image is done: it goes back to him in Revisar, to approve or reopen (12-11).
      const n = Number(args[0])
      const flags: Record<string, string[]> = {}
      const free: string[] = []
      for (let i = 1; i < args.length; i++) { const m = args[i].match(/^--(\w+)$/); if (m && i + 1 < args.length) (flags[m[1]] ??= []).push(args[++i]); else free.push(args[i]) }
      if (!Number.isInteger(n) || n <= 0) { say('Uso: pmc corregido <n.º de la nota> "qué has cambiado" [--foto "ruta::qué se ve"]'); process.exitCode = 2; return }
      const c = db.prepare('SELECT id, body, status FROM comments WHERE id = ?').get(n) as { id: number; body: string; status: string } | undefined
      if (!c) { say(`No hay ninguna nota n.º ${n}.`); process.exitCode = 2; return }
      const { setCommentStatus } = await import('../core/review')
      const what = free.join(' ').trim() || 'Corregido'
      const fotos = (flags.foto ?? []).map((f) => f.split('::')[0]).join(', ')
      setCommentStatus(db, n, 'esperando-revision', `${account}: ${what}${fotos ? ` (mira ${fotos})` : ''}`)
      say(`Nota n.º ${n} («${c.body.slice(0, 80)}») vuelve al usuario en Revisar para que la apruebe.`)
      return
    }
    if (cmd === 'respuestas') {
      // What the user answered or sent to this account and it never got (12-11: claude6 had 18 since the 7th, in a window
      // opened before its hooks; claude3 asked from another project's folder). This project's first, then the others'.
      const { loadProjects } = await import('../core/projects')
      const all = loadProjects(db)
      const ordered = [project, ...all.filter((p) => p.id !== project.id)]
      const out: string[] = []
      for (const p of ordered) {
        const text = coord.deliverPending(db, p, account)
        if (text) out.push(p.id === project.id ? text : `En ${p.name} (otro proyecto; trabájalo desde su carpeta, ${p.root}):\n${text}`)
      }
      say(out.length ? out.join('\n\n') : 'No tienes nada pendiente del usuario.')
      return
    }
    if (cmd === 'guarda') {
      // EV41: heartbeat, commit of what this account wrote, reservations kept alive for whoever takes over.
      const { heartbeatLine, withHeartbeat, porcelainPaths, pickFiles, archiveRelevo, parseGuarda, futureHours } = await import('../core/checkpoint')
      const g = parseGuarda(args)
      const text = g.text
      if (!text) { say('Uso: pmc guarda "qué has hecho y qué queda" [--probado "qué y cómo"] [--siguiente "el paso concreto"] [--no-rehacer "lo que ya está y no hay que repetir"] [--sin-commit]'); process.exitCode = 2; return }
      const { copyRootFor } = await import('../core/verify')
      const { execFileSync } = await import('node:child_process')
      const root = copyRootFor(project, process.cwd())
      const relevo = join(root, 'docs', 'RELEVO.md')
      const done: string[] = []
      const d = new Date()
      const archiveName = `RELEVO-hasta-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`
      // EV77: the same five things in every handoff; branch and last commit are read here, not typed.
      let branch: string | undefined, commit: string | undefined
      try {
        const { execFileSync: run } = await import('node:child_process')
        branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
        commit = run('git', ['log', '-1', '--format=%h %s'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().slice(0, 90)
      } catch { /* not a git copy */ }
      if (existsSync(relevo)) {
        let md = withHeartbeat(readFileSync(relevo, 'utf8'), heartbeatLine(d, account, text, { branch, commit, tested: g.tested, next: g.next, dontRedo: g.dontRedo }))
        done.push('latido escrito en docs/RELEVO.md')
        // EV40: past 16 KB, the history goes to docs/archivo/ (appended when that day's file already exists).
        const arch = archiveRelevo(md, d.getTime(), archiveName)
        if (arch) {
          const dir = join(root, 'docs', 'archivo')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, archiveName)
          const before = Buffer.byteLength(md)
          appendFileSync(file, `${existsSync(file) ? '\n\n' : `# RELEVO.md: lo sacado de la nota viva (${archiveName.slice(13, -3)})\n\n`}${arch.archived}`)
          md = arch.keep
          done.push(`relevo aligerado de ${Math.round(before / 1024)} a ${Math.round(Buffer.byteLength(md) / 1024)} KB (lo antiguo, en docs/archivo/${archiveName})`)
        }
        writeFileSync(relevo, md)
        // 14-11: «En curso» stale for an hour while the heartbeat moved on: said here.
        try {
          const { enCursoLine, staleEnCurso } = await import('../core/checkpoint')
          const markFile = join(paths.root(), 'encurso', `${project.id}-${account}.json`)
          let prev: any
          try { prev = JSON.parse(readFileSync(markFile, 'utf8')) } catch { /* first save */ }
          const r = staleEnCurso(enCursoLine(md), account, prev, d.getTime())
          if (r.mark) { mkdirSync(join(paths.root(), 'encurso'), { recursive: true }); writeFileSync(markFile, JSON.stringify(r.mark)) }
          if (r.reminder) done.push(`OJO: ${r.reminder}`)
        } catch { /* a reminder only */ }
      } else done.push('SIN docs/RELEVO.md: créalo con «En curso» y «Último latido»')
      const kept = coord.renewClaims(db, account)
      if (kept) done.push(`${kept} reserva${kept === 1 ? '' : 's'} renovada${kept === 1 ? '' : 's'} para quien te releve`)
      let left: string[] = []
      if (!g.noCommit && existsSync(join(root, '.git'))) {
        const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
        try {
          const changed = porcelainPaths(git('status', '--porcelain=v1', '-z', '--untracked-files=normal'))
          // EV113: hours written ahead of the clock in the documents (a Claude's habit): said, so they get fixed.
          try {
            // New documents too: git diff does not show untracked files (13-11: a new research note said 13:50 at 13:45).
            const fresh = git('ls-files', '--others', '--exclude-standard', '--', 'docs').split(/\r?\n/).filter((p) => /\.md$/i.test(p))
            const added = fresh.map((p) => { try { return readFileSync(join(root, p), 'utf8').split(/\r?\n/).map((l) => '+' + l).join('\n') } catch { return '' } }).join('\n')
            const ahead = futureHours(git('diff', '-U0', '--', 'docs') + '\n' + added)
            if (ahead.length) done.push(`OJO: en docs/ hay horas de hoy que aún no han llegado (${ahead.slice(0, 4).join(', ')}; son las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}): pon la hora real (la de date o la del commit)`)
          } catch { /* a reminder only */ }
          // Files written through Claude in this copy: this account's in the last 12 hours; the others' only in the last two,
          // the ones working here at the same time (12-11: claude6's writes from 05:00 made a lone session look shared at 11:47).
          const rel = (p: string) => { const a = p.replace(/\\/g, '/'), r = root.replace(/\\/g, '/').replace(/\/$/, '') + '/'; return a.toLowerCase().startsWith(r.toLowerCase()) ? a.slice(r.length) : undefined }
          const now = Date.now()
          const rows = db.prepare("SELECT account, detail, MAX(at) AS at FROM events WHERE kind = 'archivo' AND at > ? AND account IS NOT NULL AND detail IS NOT NULL GROUP BY account, detail").all(now - 12 * 3600_000) as { account: string; detail: string; at: number }[]
          const mine: string[] = [], others: string[] = []
          let othersLast: number | undefined
          for (const r of rows) {
            const p = rel(r.detail)
            if (!p) continue
            if (r.account === account) mine.push(p)
            else if (r.at > now - 2 * 3600_000) { others.push(p); othersLast = Math.max(othersLast ?? 0, r.at) }
          }
          // EV143: when each changed file was last written, to take what this session changed by an order after the others.
          const mtime = (p: string) => { try { return statSync(join(root, p)).mtimeMs } catch { return undefined } }
          // EV42: leaving in a wheel's overlap? Then the files the new holder also touched are hers to save.
          let leaving = false
          try { leaving = (JSON.parse(readFileSync(join(paths.root(), 'turns.json'), 'utf8')) as TurnFile).projects.some((x) => x.outgoing === account && x.id === project.id) } catch { /* no wheels */ }
          const pick = pickFiles({ changed, mine: [...mine, 'docs/RELEVO.md', `docs/archivo/${archiveName}`, 'docs/archivo/'], others, leaving, othersLast, mtime })
          left = pick.left
          if (pick.commit.length) {
            git('add', '-A', '--', ...pick.commit)
            git('commit', '-q', '-m', `Punto de control (${account}): ${text.slice(0, 200)}`)
            done.push(`commit de ${pick.commit.length} cambio${pick.commit.length === 1 ? '' : 's'} (${git('log', '-1', '--format=%h').trim()})`)
          } else done.push('nada que guardar en git')
          // What the session had already added itself went into the commit too: only what is still changed is «left»
          // (13-11: a package.json it had added was said to be «sin guardar» right after being saved).
          try {
            const still = new Set(git('status', '--porcelain', '--untracked-files=all').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()!))
            left = left.filter((f) => still.has(f))
          } catch { /* keep what pickFiles said */ }
        } catch (e) {
          done.push(`EL COMMIT NO SE HIZO: ${String((e as any)?.stderr || (e as Error).message).trim().slice(0, 300)}`)
        }
      }
      say(`Guardado: ${done.join('; ')}.`)
      const missing = [!g.tested && '--probado "qué probaste y cómo"', !g.next && '--siguiente "el paso concreto"', !g.dontRedo && '--no-rehacer "lo que ya está"'].filter(Boolean)
      if (missing.length) say(`Para que quien te releve no adivine, la próxima vez añade: ${missing.join(' ')}.`)
      if (left.length) say(`Sin guardar porque los escribió otra cuenta o un programa mientras otra trabajaba aquí (míralos; si son tuyos, git add y commit): ${left.slice(0, 15).join(', ')}${left.length > 15 ? ` y ${left.length - 15} más` : ''}.`)
      return
    }
    const id = args[0]
    if (!id) { say(`Uso: pmc ${cmd} <ID de TASKS.md>`); process.exitCode = 2; return }
    const { key, title } = coord.taskKeyFor(db, project.id, id)
    if (cmd === 'claim') {
      const r = coord.claimTask(db, project.id, key, account, { note: args.slice(1).join(' ') || undefined })
      if (r.ok) {
        say(`${r.renewed ? 'Renovada' : 'Reservada'}: ${id}${title ? ' · ' + title : ''} para ${account} hasta las ${new Date(r.claim.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`)
        // EV101: the model the task says is enough. A session cannot change its own model, but it can hand the work to a
        // subagent with that model (Agent tool, model: "sonnet"), which spends less of the account's usage.
        if (!r.renewed) {
          try {
            const { listTasks } = await import('../core/engine')
            const m = (listTasks(db, project.id).find((x) => x.key === key)?.model ?? '').toLowerCase()
            const tag = /\b(fable|opus)\b/.test(m) ? undefined : m.match(/\b(sonnet|haiku)\b/)?.[1]
            if (tag) say(`Esta tarea basta con ${tag === 'haiku' ? 'Haiku' : 'Sonnet'}: si es de hacer más que de pensar, encárgasela a un subagente con model: "${tag}" (gasta menos de tu uso) y revisa tú lo que entregue.`)
          } catch { /* advice only */ }
        }
      }
      else { say(`NO: ${id} la tiene ${r.holder.account} desde las ${new Date(r.holder.claimedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} (hasta las ${new Date(r.holder.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}). Elige otra o habla con esa cuenta.`); process.exitCode = 1 }
    } else {
      say(coord.releaseTask(db, project.id, key, account) ? `Liberada: ${id}.` : `${id} no estaba reservada por ${account}.`)
      // EV113 («da por hecho sin probar»: 77 de 104 tareas cerradas sin pmc verifica el 13-11): closing one with no
      // passing check gets a reminder; it still closes (some have nothing to run, and that is said, not hidden).
      try {
        const { listTasks } = await import('../core/engine')
        const t = listTasks(db, project.id).find((x) => x.key === key || x.extId === id)
        if (t && t.status === 'terminada' && t.checks?.outcome !== 'bien') say(`Ojo: ${id} está marcada como hecha y no tiene un pmc verifica que haya pasado. Pásalo (pmc verifica ${id}); si no hay nada que comprobar, dilo en su línea de TASKS.`)
      } catch { /* a reminder only */ }
    }
  } finally {
    db.close()
  }
}

function manage(cmd: string, arg?: string): void {
  const acc = configuredAccounts().find((a) => a.id === arg)
  const say = (...lines: string[]) => process.stdout.write(lines.join('\n') + '\n')
  if (!acc) { say(`Cuenta desconocida: usa ${configuredAccounts().map((a) => a.id).join(', ')}`); process.exit(1) }
  const self = join(paths.binDir(), 'pmc.mjs')
  if (cmd === 'install-statusline') {
    if (!existsSync(self)) { say(`Falta ${self}: abre Mission Control una vez para instalarlo`); process.exit(1) }
    const r = installStatusLine(acc, process.execPath, self)
    say(`Instalada en ${acc.id}. Copia previa: ${r.backup ?? '(no había settings.json)'}`, `Orden: ${r.command}`)
  } else if (cmd === 'uninstall-statusline') {
    const r = uninstallStatusLine(acc)
    if (!r.backup) say(`${acc.id} no tenía la línea de Mission Control`)
    else say(`Quitada de ${acc.id}. Copia previa: ${r.backup}`, ...(r.restored ? [`Restaurada la anterior: ${r.restored}`] : []))
  } else say(JSON.stringify(statusLineState(acc), null, 2))
}

const [cmd, arg] = process.argv.slice(2)
// 13-11: `pmc decide --help` saved a question titled «--help» in Decidir (#146), and `pmc ahora --help` would have shown
// «--help» as the account's work. Asking for help never writes anything: it says what the command takes.
const USAGE: Record<string, string> = {
  decide: 'pmc decide "título" --pregunta "…" --opcion "A: detalle" --opcion "B: detalle" [--foto "ruta::qué se ve"] [--audio "ruta::qué es::para qué momento"] [--video "ruta::…"] [--contexto "…"] [--defecto "A"] [--espera horas] [--tarea ID] [--prioridad urgente|alta|normal|baja] [--clave <id>] [--otra] [--clara]',
  entrega: 'pmc entrega <ID> --que "qué es, en una frase sin tecnicismos" --mirar "qué tiene que mirar" --foto "ruta::qué se ve" [--audio "ruta::qué es"] [--video "ruta::qué se ve"] [--clara]',
  trabajo: 'pmc trabajo "título" --log ruta --salida ruta [--pid N]',
  guarda: 'pmc guarda "qué has hecho y qué queda" [--probado "qué y cómo"] [--siguiente "el paso concreto"] [--no-rehacer "lo que ya está"] [--sin-commit]',
  ahora: 'pmc ahora "en qué estás trabajando, en una frase para el usuario"',
  recuerda: 'pmc recuerda "lo que no se debe olvidar" [--regla|--preferencia|--dato] [--todos]',
  relevo: 'pmc relevo <claudeN> (la cuenta que no puede seguir)',
  recurso: 'pmc recurso <unity|gpu|build|…> ["para qué"] · pmc recurso <nombre> --soltar · pmc recursos',
  tarea: 'pmc tarea <ID> [--todo]', claim: 'pmc claim <ID de TASKS.md>', release: 'pmc release <ID de TASKS.md>',
  verifica: 'pmc verifica [ID] [--solo nombre]', corregido: 'pmc corregido <n.º de la nota> "qué has cambiado" [--foto "ruta::qué se ve"]',
  desechable: 'pmc desechable <ruta> "por qué"', conservar: 'pmc conservar <ruta> "por qué"',
  'llevar-skills': 'pmc llevar-skills <proyecto> <skill> [<skill>…] (solo si el usuario lo pidió)', 'devolver-skills': 'pmc devolver-skills <skill> [<skill>…]',
  'pedido-hecho': 'pmc pedido-hecho "un trozo del texto de la petición (8 letras o más)"'
}
const GENERAL_USAGE = 'pmc ' + VERSION + ': parte | tarea <ID> [--todo] | recurso <nombre> ["para qué"|--soltar] | recursos | plan | perfil | preparar | confianza [carpeta] | gasto [días] | verifica [ID] [--solo nombre] | claim <ID> | release <ID> | claims | next | relevo <cuenta> | decide "título" --pregunta … --opcion … --foto … | entrega <ID> --que … --mirar … --foto … | trabajo "título" --log … --salida … | guarda "qué queda" | respuestas | corregido <n.º> "qué" | ahora "en qué estás" | statusline | hook | version\n'
if (process.argv.slice(3).some((a) => /^(--help|-h|--ayuda|\/\?)$/i.test(a))) process.stdout.write(USAGE[cmd] ? `Uso: ${USAGE[cmd]}\n` : GENERAL_USAGE)
else if (cmd === 'statusline') statusline(arg)
else if (cmd === 'install-statusline' || cmd === 'uninstall-statusline' || cmd === 'statusline-state') manage(cmd, arg)
else if (cmd === 'hook') void hook(arg)
else if (cmd === 'claim' || cmd === 'release' || cmd === 'claims' || cmd === 'relevo' || cmd === 'next' || cmd === 'parte' || cmd === 'tarea' || cmd === 'recurso' || cmd === 'recursos' || cmd === 'verifica' || cmd === 'plan' || cmd === 'decide' || cmd === 'entrega' || cmd === 'trabajo' || cmd === 'guarda' || cmd === 'respuestas' || cmd === 'corregido') void claims(cmd, process.argv.slice(3))
else if (cmd === 'ahora') {
  // pmc ahora "Preparando la pantalla de decisiones": what the user sees as this account's current work. No database.
  const args = process.argv.slice(3)
  const i = args.indexOf('--cuenta')
  const acc = i >= 0 ? args.splice(i, 2)[1] : accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR)
  const text = setFocus(acc, args.join(' '), process.env.CLAUDE_CODE_SESSION_ID)
  process.stdout.write(text ? `Mission Control enseña: «${text}».\n` : 'Uso: pmc ahora "en qué estás trabajando, en una frase para el usuario"\n')
}
else if (cmd === 'perfil' || cmd === 'preparar') void profileCmd(cmd, process.argv.slice(3))
else if (cmd === 'confianza') void trustCmd(process.argv.slice(3))
else if (cmd === 'gasto') void costCmd(process.argv.slice(3))
else if (cmd === 'puede-arrancar') void canStart(process.argv[3], process.argv[4])
else if (cmd === 'turno') turnCmd(process.argv.slice(3))
else if (cmd === 'skills-es') void skillsEsCmd(process.argv.slice(3))
else if (cmd === 'llevar-skills' || cmd === 'devolver-skills') void moveSkillsCmd(cmd, process.argv.slice(3))
else if (cmd === 'recuerda') void rememberCmd(process.argv.slice(3))
else if (cmd === 'rumbo') void courseCmd()
else if (cmd === 'desechable' || cmd === 'conservar') {
  // EV100: a note for the cleaning, while working: «this render was a test» / «keep it, the final cut uses it».
  const args = process.argv.slice(3)
  if (!args[0]) process.stdout.write(`Uso: pmc ${cmd} <ruta> "por qué"\n`)
  else void import('../core/cleanmarks').then(({ addMark }) => { const full = addMark(args[0], cmd, args.slice(1).join(' '), accountFromConfigDir(process.env.CLAUDE_CONFIG_DIR)); process.stdout.write(cmd === 'desechable' ? `Apuntado como desechable: ${full}. La limpieza lo apartará (no lo borra) y se vigilará.\n` : `Apuntado para conservar: ${full}. La limpieza no lo tocará.\n`) })
}
else if (cmd === 'pedido-hecho') {
  // A request the app shows as never written down but that was done somewhere it cannot read (another app's own docs,
  // like D:\Video App): closed by a piece of its text, as the «Ya está» of Memoria › Lo que has pedido does.
  const piece = process.argv.slice(3).join(' ').trim()
  void (async () => {
    if (piece.length < 8) { process.stdout.write('Uso: pmc pedido-hecho "un trozo del texto de la petición (8 letras o más)"\n'); return }
    const { db } = await openShared()
    const { getSetting, setSetting } = await import('../core/db')
    const { requestHash } = await import('../core/requests')
    const flat = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ')
    let file: { projects?: Record<string, { text: string; hash?: string }[]> } = {}
    try { file = JSON.parse(readFileSync(join(paths.root(), 'requests.json'), 'utf8')) } catch { /* not written yet */ }
    const hits = Object.values(file.projects ?? {}).flat().filter((r) => flat(r.text).includes(flat(piece)))
    if (!hits.length) { process.stdout.write('No hay ninguna petición sin apuntar con ese texto (la lista se escribe cada 10 minutos).\n'); return }
    const ui = getSetting<Record<string, unknown>>(db, 'ui', {})
    const closed = new Set([...((ui.requestsClosed as string[] | undefined) ?? []), ...hits.map((r) => r.hash ?? requestHash(r.text))])
    setSetting(db, 'ui', { ...ui, requestsClosed: [...closed].slice(-500) })
    process.stdout.write(`Cerrada${hits.length > 1 ? `s ${hits.length}` : ''}: ${hits.map((r) => `«${r.text.slice(0, 70)}…»`).join('; ')}\n`)
  })()
}
else if (cmd === 'version') process.stdout.write(VERSION + '\n')
else process.stdout.write(GENERAL_USAGE)
