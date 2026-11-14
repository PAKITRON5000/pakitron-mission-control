import { t } from '../core/i18n'
// The assistant's data (EV85): what each answer of core/assistant.ts is made from, read from the app itself, and the two
// things it does: passing a request on (through the same calls as «Nueva instrucción») and «Pregúntale a Claude», the
// only one that spends usage (Haiku, with the account that has the most week left, without hooks or CLAUDE.md).
import { diskLow } from '../core/disk'
import { weekSpent } from '../core/accounts'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Service } from './service'
import type { Wheel } from './wheel'
import type { AccountId } from '../core/types'
import {
  understand, answerHelp, answerWaiting, answerWho, answerUsage, answerPhotos, answerDid, answerTasks, answerWheel, planRequest, answerUnknown, sentText, replyAsText,
  type AgentInfo, type Reply, type SendPlan, type WaitingProject, type DidEvent, type TaskInfo
} from '../core/assistant'
import { listDecisions } from '../core/decisions'
import { queryAssets } from '../core/gallery'
import { listClaims } from '../core/coord'
import { guessKind } from '../core/review'
import { isSessionWorking } from '../core/working'
import { envFor, findClaude } from '../core/sessions'
import { addEvent } from '../core/db'
import { paths } from '../core/paths'

export interface AssistantDeps {
  service: Service
  wheel: () => Wheel | undefined
  /** The app's own calls (routeRequest, whoWillDo, addInstruction, startOn): the assistant does what the screens do. */
  call: (method: string, ...args: any[]) => any
}

/** Kinds of event that are not something a Claude did (what the user wrote, the routines, new tasks in TASKS.md). */
const NOT_DONE = new Set(['peticion', 'instruccion', 'recibida', 'decidida', 'comentario-estado', 'rutina', 'tarea-nueva', 'tarea-cambio', 'media'])

export function createAssistant(d: AssistantDeps) {
  const { service } = d

  function agents(): AgentInfo[] {
    const now = Date.now()
    return service.agents.map((a) => {
      const f = a.usage.snapshot?.fiveHour
      const w = a.usage.snapshot?.sevenDay
      const back = a.usage.activeLimit?.resetsAt
      const focus = service.activity[a.id]?.focus
      return {
        id: a.id, alias: a.alias, state: a.state, out: service.settings.accountStatus?.[a.id],
        windows: a.sessions.filter((x) => x.pid || isSessionWorking(x)).map((x) => ({ projectId: x.projectId, working: isSessionWorking(x) })),
        focus: focus ? { text: focus.text, at: focus.at } : undefined,
        lastAt: Math.max(a.lastActivityAt ?? 0, ...a.sessions.map((x) => x.lastActivityAt ?? 0)) || undefined,
        five: f ? { used: f.usedPct, resetsAt: f.resetsAt } : undefined,
        week: w ? { used: w.usedPct, resetsAt: w.resetsAt } : undefined,
        backAt: back && back > now ? back : undefined,
        minutesLeft: a.usage.minutesLeft
      }
    })
  }

  const projects = () => service.projects.map((p) => ({ id: p.id, name: p.name }))

  function tasksOf(projectId: string): TaskInfo[] {
    return (service.tasks.get(projectId) ?? []).map((t) => ({ id: t.id, extId: t.extId, title: t.title, detail: t.detail, status: t.status, mark: t.mark, section: t.section, priority: t.priority, projectId, checked: t.verified || t.checks?.outcome === 'bien' }))
  }

  function waiting(): Reply {
    const now = Date.now()
    const week = now - 7 * 86400_000
    const ps: WaitingProject[] = service.projects.map((p) => {
      const tasks = service.tasks.get(p.id) ?? []
      return {
        id: p.id, name: p.name,
        decisions: listDecisions(service.db, p.id, 'pendiente').map((x) => ({ id: x.id, title: x.title, askedBy: x.askedBy, at: x.createdAt, taskExtId: x.taskExtId })),
        review: tasks.filter((t) => !t.change && (t.status === 'revision' || Boolean(t.waitingLook))).map((t) => ({ id: t.id, extId: t.extId, title: t.title })),
        comments: (service.db.prepare("SELECT COUNT(*) n FROM comments WHERE project_id = ? AND status IN ('esperando-revision', 'corregido')").get(p.id) as { n: number }).n,
        unchecked: tasks.filter((t) => t.status === 'terminada' && !t.verified && !t.checks && t.updatedAt > week).length
      }
    })
    const hooks = service.state().hooks
    const missing = service.agents.filter((a) => !service.settings.accountStatus?.[a.id] && a.state !== 'baja' && a.state !== 'apartada' && hooks[a.id] === false).map((a) => a.id)
    return answerWaiting(ps, missing, now)
  }

  function did(account: string | undefined, range: { from: number; to: number; label: string }): Reply {
    const seen = new Set<number>()
    const events: DidEvent[] = []
    for (const p of service.projects) {
      for (const e of service.timeline(p.id, range.from, range.to)) {
        if (NOT_DONE.has(e.kind)) continue
        // Events with no project come once per project; heartbeats and commits (negative ids) are the project's own.
        if (e.id > 0) { if (seen.has(e.id)) continue; seen.add(e.id) }
        events.push({ at: e.at, account: e.account, kind: e.kind, title: e.title, projectId: e.projectId ?? p.id, ref: e.ref, detail: e.detail })
      }
    }
    const claims = (service.db.prepare("SELECT ref, account, at FROM events WHERE kind = 'reserva' AND ref IS NOT NULL AND account IS NOT NULL AND at > ?").all(range.from - 14 * 86400_000) as { ref: string; account: string; at: number }[])
    const titles: Record<string, string> = {}
    for (const r of service.db.prepare('SELECT project_id, ext_id, title FROM tasks WHERE gone = 0 AND ext_id IS NOT NULL').all() as { project_id: string; ext_id: string; title: string }[]) titles[`${r.project_id}:${r.ext_id}`] = r.title
    return answerDid({ account, range, events, claims, projects: projects(), now: Date.now(), titles })
  }

  function photos(topic: string, projectId: string | undefined, range?: { from: number; to: number }): Reply {
    const ids = projectId ? [projectId] : service.projects.map((p) => p.id)
    const look = (text: string) => {
      const found: { id: number; name: string; projectId: string; projectName: string; mtime: number }[] = []
      let total = 0
      for (const id of ids) {
        const r = queryAssets(service.db, { projectId: id, kind: 'image', text: text || undefined, from: range?.from, to: range?.to, limit: 12 })
        total += r.total
        for (const a of r.items) found.push({ id: a.id, name: a.name, projectId: id, projectName: service.project(id)?.name ?? id, mtime: a.mtime })
      }
      return { found: found.sort((a, b) => b.mtime - a.mtime).slice(0, 12), total }
    }
    let r = look(topic)
    // Every word has to be in the name or the folder: with nothing, the longest word alone.
    if (!r.found.length && topic.includes(' ')) r = look(topic.split(' ').sort((a, b) => b.length - a.length)[0])
    return answerPhotos(topic, r.found, r.total, projectId ?? service.activeProjectId)
  }

  function request(text: string, projectId: string, named?: string, projectWhy?: string): Reply {
    const p = service.project(projectId)
    if (!p) return answerUnknown()
    const chain = service.settings.relayChains?.[projectId]
    const holder = chain?.on ? chain.holder : undefined
    const pick = d.call('whoWillDo', projectId) as { id: string; why: string } | undefined
    return planRequest({ text, kind: guessKind(text).kind, project: { id: p.id, name: p.name }, projectWhy, named, holder, pick, agents: agents(), now: Date.now() })
  }

  /** The answer to what the user wrote, from the app's own data. `projectId`: the project on screen. */
  async function ask(text: string, projectId: string): Promise<Reply> {
    const now = Date.now()
    const u = understand(text, { projects: projects(), accounts: service.agents.map((a) => ({ id: a.id, alias: a.alias, name: service.accounts.find((x) => x.id === a.id)?.name })) }, now)
    const pid = u.projectId ?? projectId
    const project = service.project(pid) ?? service.projects[0]
    switch (u.intent) {
      case 'ayuda': return answerHelp()
      case 'gracias': return { intent: 'gracias', text: t('¡A mandar! Aquí estoy para lo que necesites.'), chips: ['¿Qué me espera?', '¿Quién trabaja?'] }
      case 'espera': return waiting()
      case 'quien': return answerWho(agents(), projects(), u.account, now)
      case 'uso': return answerUsage(agents(), u.account, now)
      case 'fotos': return photos(u.topic ?? '', u.projectId, u.range)
      case 'hizo': return did(u.account, u.range ?? { from: now - 12 * 3600_000, to: now, label: t('las últimas 12 horas') })
      case 'tareas': {
        const all = u.taskId ? service.projects.flatMap((p) => tasksOf(p.id)) : undefined
        const claims = service.projects.flatMap((p) => listClaims(service.db, p.id).filter((c) => !c.abandoned).map((c) => ({ key: c.taskKey, account: c.account })))
        return answerTasks({ taskId: u.taskId, project: { id: project.id, name: project.name }, tasks: tasksOf(project.id), allTasks: all, projects: projects(), claims, agenda: service.settings.relayChains?.[project.id]?.until?.section })
      }
      case 'rueda': {
        const v = d.wheel()?.view(project.id)
        return answerWheel({ id: project.id, name: project.name }, v?.chain, v?.members ?? [], now)
      }
      case 'pedido': {
        // The project its words point to, when they do not name one (EV46, the same as «Nueva instrucción»).
        let why: string | undefined
        let target = u.projectId
        if (!target) { const g = d.call('routeRequest', text) as { id: string; why: string } | undefined; if (g && g.id !== projectId) { target = g.id; why = g.why } }
        return request(text, target ?? projectId, u.account, why)
      }
      case 'recargas': {
        // EV96: what each window showed at its limit, and what the app will do (the same as Ajustes › Recargas regaladas).
        const v = (d.call('recharges') ?? {}) as Record<string, { record?: { available: boolean; kinds?: string[]; useBy?: string; usedAt?: number }; decision: { action: string; why: string } }>
        const rows = Object.entries(v).filter(([, x]) => x.record).map(([id, x]) => ({ title: `Claude ${id.slice(6)}: ${x.record!.available ? `tiene recarga${x.record!.kinds?.length ? ' (' + x.record!.kinds.join(', ') + ')' : ''}${x.record!.useBy ? ', hasta ' + x.record!.useBy : ''}` : x.record!.usedAt ? 'ya la usó' : 'sin recarga ahora'}`, sub: x.record!.available ? (x.decision.action === 'usar' ? t('Es el momento: se usa ya') : t('Ahora no: {why}', { why: x.decision.why })) : undefined, account: id }))
        return { intent: 'recargas', text: rows.length ? t('Lo que sé de las recargas regaladas (se ven en la ventana de cada cuenta al llegar a su límite):') : t('Aún no he visto ninguna recarga: se ven en la ventana de cada cuenta cuando llega a su límite. En Ajustes › Cuentas › Recargas puedes revisarlas sin usarlas.'), rows, more: { label: t('Abrir Recargas regaladas'), go: { route: 'ajustes', projectId } } }
      }
      case 'disco': {
        // EV100: free space where each project lives, and where to clean.
        const disks = (await Promise.resolve(d.call('diskFree')).catch(() => [])) as { drive: string; free: number; total: number; projects: string[] }[]
        const rows = disks.map((x) => ({ title: t('{drive} {v0} % libre ({v1} GB de {v2} GB)', { drive: x.drive, v0: Math.round((x.free / x.total) * 100), v1: Math.round(x.free / (1 << 30)), v2: Math.round(x.total / (1 << 30)) }), sub: x.projects.map((p) => service.project(p)?.name ?? p).join(', '), color: diskLow(x.free, x.total) ? 'var(--red)' : 'var(--green)' }))
        const low = disks.some((x) => diskLow(x.free, x.total))
        return { intent: 'disco', text: low ? t('Queda poco disco donde viven tus proyectos. En Ajustes › Proyecto › Limpieza ves qué sobra (a la papelera) y qué es dudoso (se aparta), con vuelta atrás.') : t('Hay espacio de sobra.'), rows, more: { label: t('Abrir Limpieza'), go: { route: 'ajustes', projectId } } }
      }
      case 'carga': {
        // EV112: who loads the PC now, with the Claude behind each process (read by the app every two minutes).
        const l = (await Promise.resolve(d.call('machineLoad')).catch(() => undefined)) as { loaded: boolean; text: string; top: { name: string; account?: string; doing: string; cpuPct: number; ramMb: number }[] } | undefined
        if (!l) return { intent: 'carga', text: t('Aún no he leído la carga del PC (la leo cada dos minutos): pregúntamelo otra vez en un momento.') }
        const rows = l.top.map((p) => ({ title: `${p.account === 'claude' ? 'Un Claude' : p.account ? `Claude ${p.account.slice(6)}` : 'El PC'}: ${p.name}`, sub: t('{v0}{v1} % del procesador · {v2}', { v0: p.doing === p.name ? '' : p.doing + ' · ', v1: String(p.cpuPct).replace('.', ','), v2: p.ramMb >= 1024 ? `${(p.ramMb / 1024).toFixed(1).replace('.', ',')} GB` : `${p.ramMb} MB` }), color: p.cpuPct >= 10 || p.ramMb >= 2048 ? 'var(--orange)' : 'var(--green)' }))
        return { intent: 'carga', text: `${l.loaded ? 'El PC va cargado.' : 'El PC va bien ahora mismo.'} ${l.text}`, rows }
      }
      default: return answerUnknown()
    }
  }

  /** «Enviar»: saved like «Nueva instrucción» and, when the plan says so, written in its window or opened (the dispatcher decides). */
  async function send(plan: SendPlan): Promise<Reply> {
    if (!service.project(plan.projectId)) throw new Error(t('Proyecto desconocido'))
    await d.call('addInstruction', { projectId: plan.projectId, kind: plan.kind, body: plan.body, target: plan.target })
    let started: { action: string; why: string } | undefined
    if (plan.start && plan.target) {
      try { started = await d.call('startOn', plan.projectId, plan.target) } catch (e) { started = { action: 'nada', why: (e as Error).message } }
    }
    return { intent: 'pedido', text: sentText(plan, started), chips: ['¿Qué me espera?', '¿Quién trabaja?'] }
  }

  /**
   * «Pregúntale a Claude» (spends usage): Haiku, with the account in use that has the most week left, given what the app
   * knows as its only source. --safe-mode: no hooks (the app would see a session start and hand it the startup package),
   * no CLAUDE.md, no tools; nothing is saved.
   */
  async function askClaude(text: string, projectId: string): Promise<Reply> {
    const now = Date.now()
    const pick = agents().filter((a) => !a.out && a.state !== 'sin-uso' && a.state !== 'apartada' && a.state !== 'baja')
      .filter((a) => service.agents.find((x) => x.id === a.id)?.identity.hasLogin)
      // EV146: an account paying per use (a key, Console, a cloud) costs money for each question: only when there is no other.
      .sort((a, b) => Number(Boolean(service.agents.find((x) => x.id === a.id)?.identity.plan?.paysPerUse)) - Number(Boolean(service.agents.find((x) => x.id === b.id)?.identity.plan?.paysPerUse))
        || (b.week && b.week.resetsAt > now ? 100 - b.week.used : 50) - (a.week && a.week.resetsAt > now ? 100 - a.week.used : 50))[0]
    if (!pick) return { intent: 'nose', text: t('Ahora no hay ninguna cuenta con uso para preguntárselo.') }
    const acc = service.accounts.find((a) => a.id === pick.id)!
    const p = service.project(projectId) ?? service.projects[0]
    const v = d.wheel()?.view(p.id)
    const facts = [
      `Hoy es ${new Date(now).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Proyecto en pantalla: ${p.name}. Proyectos: ${service.projects.map((x) => x.name).join(', ')}.`,
      'Lo que espera al usuario:', replyAsText(waiting()),
      'Los Claude:', replyAsText(answerWho(agents(), projects(), undefined, now)),
      'Uso:', replyAsText(answerUsage(agents(), undefined, now)),
      'Rueda:', replyAsText(answerWheel({ id: p.id, name: p.name }, v?.chain, v?.members ?? [], now)),
      'Últimas 12 horas:', replyAsText(did(undefined, { from: now - 12 * 3600_000, to: now, label: t('las últimas 12 horas') })),
      `Tareas de ${p.name}:`, replyAsText(answerTasks({ project: { id: p.id, name: p.name }, tasks: tasksOf(p.id), projects: projects(), claims: [], agenda: v?.chain?.until?.section }))
    ].join('\n')
    const prompt = `Eres el asistente de Mission Control, la app con la que el usuario coordina varias cuentas de Claude Code («Claude 1», «Claude 3»…) que trabajan en sus proyectos. Contesta en español sencillo, para alguien que no programa, en 2 a 5 frases, usando solo estos datos; si no están, dilo claramente y no te lo inventes.\n\nDatos de la app:\n${facts}\n\nPregunta del usuario: ${text}`
    const cwd = join(paths.root(), 'asistente')
    mkdirSync(cwd, { recursive: true })
    const out = await new Promise<string>((resolve, reject) => {
      const child = execFile(findClaude(), ['-p', '--safe-mode', '--model', 'haiku', '--tools', '', '--no-session-persistence'], { cwd, env: envFor(acc), windowsHide: true, timeout: 120_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim().split('\n')[0] || t('no contestó')))
        else resolve(String(stdout).trim())
      })
      child.stdin?.end(prompt)
    })
    addEvent(service.db, { projectId: p.id, at: Date.now(), account: pick.id as AccountId, kind: 'asistente', title: t('El asistente le ha preguntado a Claude {v0} (Haiku): «{v1}»', { v0: pick.id.slice(6), v1: text.slice(0, 120) }), source: 'Mission Control' })
    return { intent: 'nose', text: out || t('No ha contestado nada.'), by: `Claude ${pick.id.slice(6)} con Haiku · ha gastado un poco de su uso`, chips: ['¿Qué me espera?', '¿Quién trabaja?'] }
  }

  /**
   * EV66, «lo que hicieron mientras no estabas»: from when the user was last seen, per account (what it finished, its
   * commits, what it asked, its limits, how much of its week it spent), the new pictures and the questions still open.
   */
  function away(from: number) {
    const now = Date.now()
    const range = { from, to: now, label: t('mientras no estabas') }
    const accounts = service.agents.filter((a) => !service.settings.accountStatus?.[a.id]).map((a) => {
      const r = did(a.id, range)
      const h = a.usage.history.filter((x) => x.at >= from && x.week != null)
      const spent = weekSpent(h)
      return { id: a.id, text: r.text, rows: (r.rows ?? []).slice(0, 4), quiet: /^No veo nada/.test(r.text), spentWeek: spent }
    }).filter((x) => !x.quiet || (x.spentWeek ?? 0) > 0)
    const photos = service.projects.flatMap((p) => queryAssets(service.db, { projectId: p.id, kind: 'image', from, limit: 8 }).items.map((x) => ({ id: x.id, name: x.name, projectId: p.id, mtime: x.mtime })))
      .sort((a, b) => b.mtime - a.mtime).slice(0, 10)
    const asked = service.projects.reduce((n, p) => n + listDecisions(service.db, p.id, 'pendiente').length, 0)
    return { from, to: now, accounts, photos, asked }
  }

  return { ask, send, askClaude, away }
}

export type Assistant = ReturnType<typeof createAssistant>
