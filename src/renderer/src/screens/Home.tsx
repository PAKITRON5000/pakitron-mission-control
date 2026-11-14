import { t, tn } from '../../../core/i18n'
import { motion } from 'motion/react'
import { ChevronRight, CheckCircle2, Gauge, MessageSquareText, ListChecks, Hourglass, CircleAlert, Hand, GitCommitHorizontal, Images, MessageCircle, Send, Gavel, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore, useAsync, type Route } from '../lib/store'
import { api, thumbUrl, type AgentCard, type Asset, type Comment, type Instruction, type TimelineEvent, type Decision } from '../lib/api'
import { Ring, SPRING, STATE_META, accName } from '../components/ui'
import { ClaudeRing, UsageBars } from '../components/ClaudeRing'
import { ago, clock, plural, whenFull } from '../lib/format'
import { isSessionWorking } from '../../../core/working'
import { diskLow, diskWords } from '../../../core/disk'
import { MissionMap } from '../components/MissionMap'
import { AwayCard } from '../components/AwayCard'
import { ForecastLine } from '../components/ForecastLine'
import { FirstSteps } from '../components/FirstSteps'
import { ImproveButton } from '../components/ImproveProject'

const fade = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...SPRING, delay: 0.03 * i } })

function names(list: AgentCard[]): string {
  const n = list.map((a) => `${accName(a.id)}`)
  return n.length <= 1 ? n.join('') : t('{v0} y {v1}', { v0: n.slice(0, -1).join(', '), v1: n[n.length - 1] })
}

/** One sentence that answers "how are things?" before any number. */
function headline(agents: AgentCard[], now: number): string {
  const working = agents.filter((a) => a.state === 'trabajando')
  const waiting = agents.filter((a) => a.state === 'esperando')
  const out = agents.filter((a) => a.state === 'sin-uso')
  const parts: string[] = []
  if (working.length) parts.push(working.length > 1 ? t('{names} están trabajando', { names: names(working) }) : t('{names} está trabajando', { names: names(working) }))
  if (waiting.length) parts.push(`${names(waiting)} ${waiting.length > 1 ? 'te esperan' : 'te espera'}`)
  if (out.length) {
    // Each one with its own return time, soonest first: "Claude 2 vuelve hoy a las 17:10; Claude 4, el viernes…"
    const sorted = [...out].sort((x, y) => (x.usage.activeLimit?.resetsAt ?? Infinity) - (y.usage.activeLimit?.resetsAt ?? Infinity))
    parts.push(sorted.map((a, i) => {
      const reset = a.usage.activeLimit?.resetsAt
      const when = reset ? whenFull(reset, now) : t('tras su reinicio')
      return i === 0 ? t('{v0} vuelve {when}', { v0: accName(a.id), when: when }) : `${accName(a.id)}, ${when}`
    }).join('; '))
  }
  if (!parts.length) return t('Ningún Claude está trabajando ahora mismo.')
  const s = parts.join('. ') + '.'
  return s[0].toUpperCase() + s.slice(1)
}

function ClaudeTile({ a, i }: { a: AgentCard; i: number }) {
  const { now, setAgentOpen, state } = useStore()
  // The session at work, else one with a window in the project on screen; a background record with no process is not
  // where the account is (12-11: claude3, at work in Mission Control, showed «rachas» from a record of 1-11).
  const real = a.sessions.filter((x) => x.pid || isSessionWorking(x))
  const s = real.find((x) => isSessionWorking(x)) ?? real.find((x) => x.projectId === state?.activeProjectId) ?? real[0] ?? a.sessions[0]
  const task = a.assigned.find((t) => t.status === 'en-desarrollo') ?? a.assigned[0]
  const live = state?.activity?.[a.id]?.now
  const said = state?.activity?.[a.id]?.focus
  const active = a.state === 'trabajando' || a.state === 'esperando'
  const fresh = live && now - live.at < 20 * 60_000
  const doing = (active && said && now - said.at < 8 * 3600_000 ? said.text : undefined) ?? s?.title ?? task?.title ?? (fresh ? live.text : undefined)
  const m = STATE_META[a.state]
  return (
    <motion.button {...fade(i)} whileTap={{ scale: 0.985 }} onClick={() => setAgentOpen(a.id)} className="card p-5 text-left border-0 flex flex-col gap-4 min-w-0 group" aria-label={`${accName(a.id)}: ${m.label}`}>
      <div className="flex items-center gap-4">
        <ClaudeRing a={a} now={now} />
        <div className="min-w-0 flex-1">
          <div className="t-title">{accName(a.id)}</div>
          <div className="t-head mt-0.5" style={{ color: m.color }}>{m.label}</div>
        </div>
        <ChevronRight size={18} className="c4 flex-none opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <UsageBars a={a} now={now} compact />
      <div className="min-h-[44px]">
        {a.state === 'sin-uso' && a.usage.activeLimit ? (
          <div className="t-body c2">{t('Vuelve {v0}', { v0: whenFull(a.usage.activeLimit.resetsAt, now) })}{a.assigned.length ? <> · <b className="c1" style={{ color: 'var(--label)' }}>{tn(a.assigned.length, '{n} tarea espera', '{n} tareas esperan')}</b></> : null}</div>
        ) : doing ? (
          <>
            <div className="t-body clamp-2" style={{ fontWeight: 560 }}>{doing}</div>
            <div className="t-small c3 mt-0.5 truncate">{fresh ? `${s?.title ? s.title.slice(0, 60) + ' · ' : ''}${ago(live.at, now)}` : s ? `${s.worktree ?? ''}${s.worktree ? ' · ' : ''}${ago(s.lastActivityAt ?? a.lastActivityAt, now)}` : ago(a.lastActivityAt, now)}</div>
          </>
        ) : (
          <div className="t-body c3">{a.stateReason}{a.lastActivityAt ? ` · ${ago(a.lastActivityAt, now)}` : ''}</div>
        )}
      </div>
    </motion.button>
  )
}

function Row({ icon, color, title, sub, onClick, tone }: { icon: ReactNode; color: string; title: ReactNode; sub?: ReactNode; onClick?: () => void; tone?: string }) {
  return (
    <button className="row" onClick={onClick}>
      <span className="icon-sq icon-sq-lg" style={{ background: color, color: color === 'var(--yellow)' ? '#3a2a00' : 'white' }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="t-body block truncate" style={{ fontWeight: 560, color: tone }}>{title}</span>
        {sub && <span className="t-small c3 block truncate">{sub}</span>}
      </span>
      <ChevronRight size={16} className="c4 flex-none" />
    </button>
  )
}

interface WeekMetrics { done: number; approved: number; changes: number; checksOk: number; checksFail: number; limits: number; handoffs: number; handoffMinutes?: number; weekPoints: number }

/** One figure of the week with the week before beside it: better or worse is said by the colour, not by an adjective. */
function Figure({ label, value, before, sub, lowerIsBetter }: { label: string; value: number | string; before?: number | string; sub?: string; lowerIsBetter?: boolean }) {
  const a = typeof value === 'number' ? value : NaN, b = typeof before === 'number' ? before : NaN
  const better = Number.isFinite(a) && Number.isFinite(b) && a !== b ? (lowerIsBetter ? a < b : a > b) : undefined
  return (
    <div className="rounded-xl p-3 min-w-0" style={{ background: 'var(--fill)' }}>
      <div className="t-small c3 truncate">{label}</div>
      <div className="flex items-baseline gap-2"><span className="t-title num">{value}</span>{before != null && <span className="t-small num" style={{ color: better == null ? 'var(--c3, gray)' : better ? 'var(--green)' : 'var(--orange)' }}>{t('antes {before}', { before: before })}</span>}</div>
      {sub && <div className="t-small c3">{sub}</div>}
    </div>
  )
}

function Highlight({ icon, color, label, value, sub, onClick, i }: { icon: ReactNode; color: string; label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; i: number }) {
  return (
    <motion.button {...fade(i)} whileTap={{ scale: 0.98 }} className="card p-4 text-left border-0 flex flex-col gap-3 min-w-0" onClick={onClick}>
      <div className="flex items-center gap-2 t-small" style={{ color, fontWeight: 620 }}>{icon}{label}</div>
      <div className="t-big num">{value}</div>
      {sub && <div className="t-small c3 -mt-1 truncate">{sub}</div>}
    </motion.button>
  )
}

/** Commit subjects start with task ids ("C1a/C1c: ..."): keep the words, show the ids apart. */
function humanize(e: TimelineEvent): { ids?: string; text: string } {
  const m = e.title.match(/^([A-Z][A-Za-z0-9]{0,6}(?:[/,] ?[A-Z][A-Za-z0-9]{0,6})*):\s+(.*)$/)
  const text = m ? m[2] : e.title
  return { ids: m?.[1], text: text[0]?.toUpperCase() + text.slice(1) }
}

export function Home() {
  const { state, now, go, jump, setViewer, setAgentOpen, toast } = useStore()
  const s = state?.summary
  const p = s?.project
  const pid = p?.id
  const jobs = useAsync(() => api<{ id: string; title: string; state: string; output?: string; done?: number; total?: number; leftSec?: number }[]>('jobs', pid), [pid, state?.now])
  const recent = useAsync(() => (pid ? api<TimelineEvent[]>('timeline', pid, now - 48 * 3600_000, now) : Promise.resolve([])), [pid, state?.refreshedAt?.docs, state?.refreshedAt?.git])
  const latest = useAsync(() => (pid ? api<{ items: Asset[] }>('assets', { projectId: pid, limit: 5, kind: 'image' }) : Promise.resolve({ items: [] })), [pid, state?.refreshedAt?.media])
  const comments = useAsync(() => (pid ? api<Comment[]>('comments', pid) : Promise.resolve([])), [pid, state?.now])
  const health = useAsync(() => api<{ tools: { name: string; ok: boolean; detail: string; fix?: string; needed: boolean }[] }>('health'), [Math.floor(now / 600_000)])
  const ins = useAsync(() => (pid ? api<Instruction[]>('instructions', pid) : Promise.resolve([])), [pid, state?.now])
  const week = useAsync(() => (pid ? api<{ now: WeekMetrics; before: WeekMetrics }>('metrics', pid) : Promise.resolve(undefined)), [pid, state?.refreshedAt?.docs])
  const stale = useAsync(() => api<{ account: string; sessionId: string; working: boolean }[]>('staleWindows'), [state?.refreshedAt?.agents, Math.floor(now / 60_000)])
  // EV98: sign-ins that end soon (`claude auth status`, read by the app every 6 h).
  // EV100: little disk left where a project lives.
  const disks = useAsync(() => api<{ drive: string; free: number; total: number; projects: string[] }[]>('diskFree'), [Math.floor(now / 600_000)])
  // EV112: who loads the PC, read by the app every two minutes; shown only when it is loaded.
  const load = useAsync(() => api<{ loaded: boolean; text: string; top: { account?: string }[] } | undefined>('machineLoad'), [Math.floor(now / 120_000)])
  const logins = useAsync(() => api<Record<string, { level: 'caducada' | 'pronto'; text: string; days?: number }>>('logins'), [Math.floor(now / 600_000), state?.refreshedAt?.agents])
  const unread = useAsync(() => api<{ account: string; projectId: string; project: string; n: number; since: number; window: boolean }[]>('unread'), [state?.now])
  const allTasks = useAsync(() => (state?.activeProjectId ? api<{ status: string; checks?: unknown; waitingLook?: boolean; updatedAt: number }[]>('tasks', state.activeProjectId) : Promise.resolve([])), [state?.activeProjectId, state?.refreshedAt?.docs])
  const reqs = useAsync(() => (state?.activeProjectId ? api<{ status: string }[]>('requests', state.activeProjectId, 3) : Promise.resolve([])), [state?.activeProjectId, state?.refreshedAt?.docs])
  const projects = useAsync(() => api<{ id: string; name: string; color?: string; active: boolean; missing?: boolean; level: 'bien' | 'aviso' | 'mal'; parts: string[] }[]>('projectsHealth'), [state?.refreshedAt?.git, state?.refreshedAt?.docs, Math.floor(now / 120_000)])
  // The questions themselves, in every project that has any (13-11: «decidir también debería salir resaltado en inicio»).
  const askingIn = Object.entries(state?.pending ?? {}).filter(([, x]) => x.decisions > 0).map(([id]) => id)
  const asks = useAsync(() => Promise.all(askingIn.map((id) => api<Decision[]>('decisions', id).then((ds) => ds.filter((d) => d.status === 'pendiente')))).then((x) => x.flat().sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)), [askingIn.join(','), JSON.stringify(state?.pending ?? {})])
  if (!state) return <div className="content-inner"><div className="skeleton h-10 w-72 rounded-xl mb-8" /><div className="grid gap-4 grid-cols-2 min-[1500px]:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}</div></div>
  // EV68: the first start, with nothing yet, is the four steps (accounts → the app sees them → project → wheel).
  if (!s || !p) return <div className="content-inner max-w-[980px]"><h1 className="t-display mb-2">{t('Bienvenido a Mission Control')}</h1><div className="t-head c2 mb-6" style={{ fontWeight: 450 }}>{t('Coordina tus cuentas de Claude Code en tus proyectos: quién trabaja dónde, quién sigue cuando una se queda sin uso y qué te espera a ti.')}</div><FirstSteps /></div>
  const day = state.day
  const agents = state.agents

  // "Para ti": only what needs the user, most urgent first.
  const todo: ReactNode[] = []
  // What only the user can do, with one click (13-11, the user: «esas cosas de pulsarlas, hay que destacarlas más»): in a
  // banner of its own above the map, not one more row in «Para ti».
  const press: ReactNode[] = []
  // EV60: how the Claudes are (out with tasks stopped, waiting, spending without progress…): under the map, not mixed with
  // what is the user's.
  const crew: ReactNode[] = []
  for (const j of jobs.data ?? []) {
    const left = j.leftSec != null ? t(', quedan {v0}', { v0: j.leftSec < 3600 ? `${Math.max(1, Math.round(j.leftSec / 60))} min` : `${(j.leftSec / 3600).toFixed(1).replace('.', ',')} h` }) : ''
    if (j.state === 'cortado') todo.push(<Row key={'job' + j.id} icon={<CircleAlert size={17} />} color="var(--red)" title={t('Se cortó: {title}', { title: j.title })} sub={t('Se quedó{v0} y no ha salido nada. Pulsa para quitar el aviso', { v0: j.done != null ? t(' en {done} de {total}', { done: j.done, total: j.total }) : t(' a medias') })} onClick={() => void api('dismissJob', j.id).then(jobs.reload)} />)
    else if (j.state === 'terminado') todo.push(<Row key={'job' + j.id} icon={<CheckCircle2 size={17} />} color="var(--green)" title={t('Ya está: {title}', { title: j.title })} sub={t('Pulsa para abrirlo')} onClick={() => { void api('openPath', j.output); void api('dismissJob', j.id).then(jobs.reload); toast(t('Abriendo…')) }} />)
    else todo.push(<Row key={'job' + j.id} icon={<Hourglass size={17} />} color="var(--blue)" title={t('En marcha: {title}', { title: j.title })} sub={j.done != null ? t('Va por {done} de {total}{left}. No apagues el PC', { done: j.done, total: j.total, left: left }) : t('No apagues el PC hasta que acabe')} />)
  }
  // The questions go in their own banner, above everything, each one by name and from every project (13-11).
  const ask: ReactNode[] = (asks.data ?? []).slice(0, 5).map((d) => {
    const proj = state.projects.find((x) => x.id === d.projectId)
    const by = d.askedBy ? t('{v0} pregunta', { v0: accName(d.askedBy) }) : t('Pregunta')
    const def = d.defaultChoice && d.waitUntil ? t(' · si no contestas, {v0} se toma «{v1}»', { v0: whenFull(d.waitUntil, now), v1: d.options?.find((o) => o.id === d.defaultChoice)?.label ?? d.defaultChoice }) : ''
    return <Row key={'ask' + d.id} icon={<Gavel size={17} />} color={proj && proj.id !== p.id ? proj.color : 'var(--red)'} title={d.title}
      sub={`${by}${proj && proj.id !== p.id ? t(' en {name}', { name: proj.name }) : ''} · ${ago(d.createdAt, now)}${def}`}
      onClick={async () => { if (d.projectId !== state.activeProjectId) await api('setActiveProject', d.projectId); jump('decisiones', { kind: 'decision', id: d.id }) }} />
  })
  const askTotal = Object.values(state.pending ?? {}).reduce((n, x) => n + x.decisions, 0)
  // The other projects too (13-11): a question there is as much the user's as one here. One row per project, in its colour.
  for (const other of state.projects.filter((x) => x.id !== p.id)) {
    const x = state.pending?.[other.id]
    if (!x || !(x.review || x.comments)) continue
    const what = [x.review && tn(x.review, '{n} tarea para revisar', '{n} tareas para revisar'), x.comments && tn(x.comments, '{n} corrección', '{n} correcciones')].filter(Boolean).join(' · ')
    const route = x.review ? 'tareas' : 'revisiones'
    todo.unshift(<Row key={'pp' + other.id} icon={<Gavel size={17} />} color={other.color} title={t('En {name}: {what}', { name: other.name, what: what })} sub={t('Es otro proyecto: pulsa para ir allí')} onClick={() => void api('setActiveProject', other.id).then(() => go(route))} />)
  }
  // EV65: done lately with nothing to prove it.
  const unchecked = (allTasks.data ?? []).filter((t) => t.status === 'terminada' && !t.waitingLook && !t.checks && now - t.updatedAt < 7 * 86400_000).length
  if (unchecked) todo.push(<Row key="unchk" icon={<CircleAlert size={17} />} color="var(--yellow)" title={tn(unchecked, '{n} tarea hecha sin comprobar', '{n} tareas hechas sin comprobar')} sub={t('Marcadas como hechas esta semana sin pruebas ni fotos: quien tenga el turno las comprobará; en Tareas llevan la marca amarilla')} onClick={() => go('tareas')} />)
  // EV64: what the user asked these days and nobody wrote down.
  const unnoted = (reqs.data ?? []).filter((r) => r.status === 'sin-apuntar').length
  if (unnoted) todo.unshift(<Row key="req" icon={<Send size={16} />} color="var(--orange)" title={tn(unnoted, '{n} petición tuya sin apuntar', '{n} peticiones tuyas sin apuntar')} sub={t('Se lo dijiste a un Claude y no hay tarea, recuerdo ni decisión que lo recoja: míralas en Memoria')} onClick={() => go('memoria')} />)
  for (const a of agents.filter((x) => x.identity.emailMismatch))
    crew.push(<Row key={'mm' + a.id} icon={<CircleAlert size={17} />} color="var(--red)" title={t('La carpeta de {v0} tiene otra cuenta', { v0: accName(a.id) })} sub={a.identity.email} onClick={() => setAgentOpen(a.id)} />)
  for (const a of agents.filter((x) => x.state === 'esperando'))
    crew.push(<Row key={'w' + a.id} icon={<Hand size={17} />} color="var(--orange)" title={`${accName(a.id)} ${a.stateReason.toLowerCase()}`} sub={a.sessions.find((x) => x.status === 'waiting')?.title} onClick={() => setAgentOpen(a.id)} />)
  for (const c of (health.data?.tools ?? []).filter((x) => !x.ok && x.needed))
    todo.push(<Row key={'hl' + c.name} icon={<CircleAlert size={17} />} color="var(--red)" title={t('Falta {name}: {detail}', { name: c.name, detail: c.detail })} sub={c.fix} onClick={() => go('ajustes', 'comprobacion')} />)
  // An account spending with nothing to show for it (the last half hour): one line, to go and look.
  const stalled = new Map<string, TimelineEvent>()
  for (const e of recent.data ?? []) if (e.kind === 'aviso' && e.account && now - e.at < 45 * 60_000 && /sin escribir ni reservar/.test(e.title)) stalled.set(e.account, e)
  for (const [id, e] of stalled) crew.push(<Row key={'st' + id} icon={<CircleAlert size={17} />} color="var(--orange)" title={t('{v0} gasta sin avanzar', { v0: accName(id) })} sub={e.title} onClick={() => setAgentOpen(id as any)} />)
  // EV80: the one holding a wheel's turn, with usage and nothing done for 20 minutes: a hung window, to go and look.
  for (const [pid, ch] of Object.entries(state.settings.relayChains ?? {})) {
    if (!ch?.on || !ch.holder || ch.phase === 'espera') continue
    const a = agents.find((x) => x.id === ch.holder)
    if (!a || a.state === 'sin-uso' || a.state === 'apartada' || a.state === 'baja') continue
    const last = Math.max(a.lastActivityAt ?? 0, state.activity?.[a.id]?.now?.at ?? 0)
    if (last && now - last > 20 * 60_000) crew.unshift(<Row key={'hung' + a.id} icon={<Hourglass size={17} />} color="var(--orange)" title={t('{v0} tiene el turno en {v1} y lleva {v2} min sin hacer nada', { v0: accName(a.id), v1: state.projects.find((x) => x.id === pid)?.name ?? pid, v2: Math.round((now - last) / 60_000) })} sub={t('Puede que su ventana esté colgada o esperando algo: pulsa para ver su ficha (desde ahí puedes escribirle o cerrarla)')} onClick={() => setAgentOpen(a.id)} />)
  }
  if (load.data?.loaded) { const acc = load.data.top.find((x) => x.account && x.account !== 'claude')?.account; todo.unshift(<Row key="load" icon={<Gauge size={17} />} color="var(--orange)" title={t('El PC va cargado')} sub={load.data.text} onClick={() => acc ? setAgentOpen(acc as any) : go('agentes')} />) }
  for (const d of disks.data ?? []) { if (diskLow(d.free, d.total)) todo.unshift(<Row key={'disk' + d.drive} icon={<CircleAlert size={17} />} color="var(--red)" title={t('Queda poco disco en {drive} ({v0})', { drive: d.drive, v0: diskWords(d.free, d.total) })} sub={t('Mira Ajustes › Proyecto › Limpieza: lo que sobra va a la papelera y lo dudoso se aparta, con vuelta atrás')} onClick={() => { if (d.projects[0] && d.projects[0] !== state.activeProjectId) void api('setActiveProject', d.projects[0]); go('ajustes', 'proyecto') }} />) }
  const toReview = (comments.data ?? []).filter((c) => c.status === 'esperando-revision' || c.status === 'corregido').length
  if (toReview) todo.push(<Row key="rev" icon={<MessageSquareText size={17} />} color="var(--yellow)" title={tn(toReview, '{n} corrección para revisar', '{n} correcciones para revisar')} onClick={() => go('revisiones')} />)
  // EV167: skills the app found alone on skills.sh for this kind of project; installing them stays the user's click.
  if (state.skills?.suggested && p) todo.push(<Row key="skills" icon={<Sparkles size={17} />} color="var(--pink)" title={tn(state.skills.suggested, '{n} skill recomendada para {name}', '{n} skills recomendadas para {name}', { name: p.name })} sub={t('Buscadas solas para lo que es el proyecto. Lee qué hace cada una y decides tú si instalarla.')} onClick={() => go('skills')} />)
  if (s.tasks.review) todo.push(<Row key="tr" icon={<ListChecks size={17} />} color="var(--orange)" title={tn(s.tasks.review, '{n} tarea espera tu visto bueno', '{n} tareas esperan tu visto bueno')} onClick={() => go('decisiones')} />)
  for (const a of agents.filter((x) => x.state === 'sin-uso' && x.assigned.length))
    crew.push(<Row key={'o' + a.id} icon={<Hourglass size={17} />} color="var(--red)" title={t('{v0} sin uso: {v1}', { v0: accName(a.id), v1: tn(a.assigned.length, '{n} tarea parada', '{n} tareas paradas') })} sub={a.usage.activeLimit ? t('Vuelve {v0}', { v0: whenFull(a.usage.activeLimit.resetsAt, now) }) : undefined} onClick={() => setAgentOpen(a.id)} />)
  // Answers and messages an account has not read (12-11: claude6 had 18 since the 7th): one click writes it in its window.
  // Windows opened before their coordination was updated stop at the end of every answer (12-11): the idle ones are
  // reopened on the same conversation with one click; the ones at work are left alone.
  // One out of usage is reopened by the app itself when it comes back or takes the turn (main/wheel.ts): nothing to press
  // (13-11, the user: «¿tengo que quitarlo cada vez que uno termine?»).
  const staleList = (stale.data ?? []).filter((w) => state.settings.autonomous && agents.find((a) => a.id === w.account)?.state !== 'sin-uso')
  if (staleList.length) {
    const idle = staleList.filter((w) => !w.working)
    // Only something to press goes up top: the windows at work cannot be reopened yet.
    ;(idle.length ? press : crew).unshift(<Row key="stale" icon={<Hourglass size={17} />} color="var(--red)" title={t('{v0} con la coordinación vieja y {v1} al acabar cada respuesta', { v0: tn(staleList.length, '{n} ventana sigue', '{n} ventanas siguen'), v1: staleList.length === 1 ? t('para') : t('paran') })}
      sub={`${[...new Set(staleList.map((w) => `${accName(w.account)}`))].join(', ')}. ${idle.length ? t('Pulsa para reabrir {v0} en su misma conversación', { v0: idle.length === 1 ? t('la que está quieta') : t('las {length} que están quietas', { length: idle.length }) }) : t('Están trabajando: se podrán reabrir cuando acaben su paso')}`}
      onClick={idle.length ? async () => { let n = 0; for (const w of idle) { try { await api('reopenWindow', w.account, w.sessionId); n++ } catch { /* at work now */ } } toast(t('{n} {v0}: siguen donde estaban', { n: n, v0: n === 1 ? t('ventana reabierta') : t('ventanas reabiertas') })); stale.reload() } : undefined} />)
  }
  // One row per account, whatever the projects (pmc respuestas gives it all of them at once).
  const byAccount = new Map<string, NonNullable<typeof unread.data>>()
  for (const u of unread.data ?? []) byAccount.set(u.account, [...(byAccount.get(u.account) ?? []), u])
  for (const [account, list] of byAccount) {
    const n = list.reduce((s, u) => s + u.n, 0)
    const days = Math.floor((now - Math.min(...list.map((u) => u.since))) / 86400_000)
    const where = list.length === 1 ? t('En {project}', { project: list[0].project }) : list.map((u) => t('{n} en {project}', { n: u.n, project: u.project })).join(', ')
    const first = list.find((u) => u.window) ?? list[0]
    todo.push(<Row key={'ur' + account} icon={<Send size={16} />} color="var(--orange)" title={t('{v0} no ha leído {v1}', { v0: accName(account), v1: tn(n, '{n} mensaje tuyo', '{n} mensajes tuyos') })}
      sub={t('{where}; {v0} (respuestas a sus preguntas y encargos). {v1}', { where: where, v0: days >= 1 ? t('el más viejo, de hace {days} {v0}', { days: days, v0: days === 1 ? t('día') : t('días') }) : t('de hoy'), v1: first.window ? t('Pulsa para escribirle en su ventana que los lea') : t('Los leerá al abrir su próxima sesión') })}
      onClick={first.window ? () => void api<{ typed: boolean }>('nudgeUnread', account, first.projectId).then((r) => { toast(r.typed ? t('Se lo he escrito a {v0} en su ventana', { v0: accName(account) }) : t('No tiene ventana abierta')); unread.reload() }, (e) => toast((e as Error).message)) : undefined} />)
  }
  const undelivered = (ins.data ?? []).filter((i) => i.status === 'guardada' && i.kind !== 'nota' && !i.target).length
  if (undelivered) todo.push(<Row key="und" icon={<Send size={16} />} color="var(--blue)" title={tn(undelivered, '{n} instrucción sin entregar', '{n} instrucciones sin entregar')} sub={t('Guardadas aquí; ningún agente las ha visto')} onClick={() => go('revisiones')} />)
  const noUsage = agents.filter((a) => !state.statusLine[a.id]?.ours)
  const oldHooks = agents.filter((a) => state.hooks?.[a.id] && state.hooksOutdated?.[a.id])
  // 12-11: until 0.16.26 the Stop hook ran in the background and its «do not stop» was never read: no account kept going in
  // autonomous mode. One click brings every account up to date (with a copy of its settings).
  if (oldHooks.length) press.unshift(<Row key="hko" icon={<Send size={16} />} color="var(--red)" title={t('Actualiza la coordinación de {v0}', { v0: names(oldHooks) })} sub={t('Sin esto el modo autónomo no funciona: los Claude paran al acabar cada respuesta aunque quede trabajo. Un clic, con copia de su configuración; cada Claude lo nota al abrir su próxima ventana')} onClick={async () => { let n = 0; for (const a of oldHooks) { try { await api('hooksInstall', a.id); n++ } catch { /* shown in Ajustes */ } } toast(t('Coordinación actualizada en {n} {v0}: vale para las ventanas que se abran a partir de ahora', { n: n, v0: n === 1 ? t('cuenta') : t('cuentas') })) }} />)
  // Without the hooks the app is blind to an account: it does not see it start, stop or write, and may open windows it does
  // not need (12-11: claude5 and claude6 had none). One click turns them on for every account in use that lacks them.
  const noHooks = agents.filter((a) => !state.hooks?.[a.id] && a.state !== 'apartada' && a.state !== 'baja')
  if (noHooks.length) press.push(<Row key="hk" icon={<Send size={16} />} color="var(--red)" title={t('Mission Control no ve lo que hace {v0}', { v0: names(noHooks) })} sub={t('Sin la coordinación no sabe cuándo empieza, para o escribe, y puede abrir ventanas de más. Pulsa aquí para activarla (un clic, con copia de su configuración)')} onClick={async () => { for (const a of noHooks) { try { await api('hooksInstall', a.id) } catch { /* shown in Ajustes */ } } go('ajustes', 'cuentas') }} />)
  for (const [id, w] of Object.entries(logins.data ?? {})) press.unshift(<Row key={'login' + id} icon={<CircleAlert size={17} />} color={w.level === 'caducada' ? 'var(--red)' : 'var(--orange)'} title={t('Entra otra vez con {v0}: {text}', { v0: accName(id), text: w.text })}
    sub={t('Pulsa y se abre su ventana: escribe /login y sigue los pasos (un minuto). Mejor ahora que de noche con la rueda en marcha')} onClick={() => { const pr = state.projects.find((x) => x.id === state.activeProjectId); if (pr) void api('openSession', id, pr.root).then(() => toast(t('Escribe /login en la ventana que se ha abierto')), (e) => toast((e as Error).message)) }} />)
  if (noUsage.length) press.push(<Row key="sl" icon={<Gauge size={17} />} color="var(--blue)" title={t('Activa la lectura de consumo')} sub={t('Falta en {v0}: un clic en Ajustes', { v0: names(noUsage) })} onClick={() => go('ajustes', 'cuentas')} />)

  const imgs = latest.data?.items ?? []
  const changes = (recent.data ?? []).filter((e) => e.kind === 'commit' || e.kind === 'relevo' || e.kind === 'peticion' || e.kind.startsWith('tarea-hecha')).slice(0, 6)
  const pct = s.tasks.total ? Math.round((s.tasks.done / s.tasks.total) * 100) : 0

  return (
    <div className="content-inner">
      <motion.header {...fade(0)} className="flex items-center gap-6 mb-8">
        <div className="min-w-0 flex-1">
          <h1 className="t-hero">{p.name}</h1>
          <p className="t-head c2 mt-2" style={{ fontWeight: 450 }}>{headline(agents, now)}</p>
          <div className="mt-3"><ImproveButton projectId={p.id} name={p.name} /></div>
        </div>
        <button className="flex items-center gap-3 border-0 bg-transparent p-0 text-left flex-none" onClick={() => go('tareas')} aria-label={t('Progreso de tareas')}>
          <Ring value={s.tasks.done} total={s.tasks.total} size={64} stroke={8} color="var(--green)"><span className="t-small num" style={{ fontWeight: 700 }}>{pct}%</span></Ring>
          <span className="hidden min-[700px]:block">
            <span className="t-head block">{t('{done} de {total} hechas', { done: s.tasks.done, total: s.tasks.total })}</span>
            <span className="t-small c3 block" title={t('Comprobadas: pasaron sus pruebas (pmc verifica). Aceptadas: las diste tú por buenas en Tareas.')}>{t('{open} por terminar · {v0} comprobadas{v1}', { open: s.tasks.open, v0: s.tasks.checked ?? 0, v1: s.tasks.verified ? t(' · {verified} aceptadas por ti', { verified: s.tasks.verified }) : '' })}</span>
          </span>
        </button>
      </motion.header>

      {/* EV68: while a first step is missing (and not hidden), it goes first: nothing else works well without it. */}
      <FirstSteps />
      {/* EV66: what the Claudes did while the user was away, first thing when they come back. */}
      <AwayCard />
      <section className="mb-9">
        {/* EV84: the live map (Decidir #127) instead of a row of tiles: who works where, who waits, who rests, in one look.
            Accounts the user does not use («De baja», «No usar») take one quiet line below (EV18, 12-11). */}
        {ask.length > 0 && (
          <motion.div {...fade(1)} className="press ask mb-5">
            <div className="press-head">
              <span className="press-icon"><Gavel size={18} /></span>
              <span className="min-w-0 flex-1"><b className="t-head block">{askTotal > 1 ? t('Te preguntan ({n})', { n: askTotal }) : t('Te preguntan')}</b><span className="t-small c2 block">{t('Hay un Claude esperando tu respuesta: contesta en Decidir y le llega al momento')}</span></span>
              {askTotal > ask.length && <button className="btn btn-sm flex-none" onClick={() => go('decisiones')}>{t('Ver todas')}</button>}
            </div>
            <div className="press-rows">{ask}</div>
          </motion.div>
        )}
        {press.length > 0 && (
          <motion.div {...fade(1)} className="press mb-5">
            <div className="press-head">
              <span className="press-icon"><Hand size={18} /></span>
              <span className="min-w-0"><b className="t-head block">{press.length > 1 ? t('Te toca pulsar ({n})', { n: press.length }) : t('Te toca pulsar')}</b><span className="t-small c2 block">{t('Solo tú puedes hacerlo, y es un clic cada uno: sin esto los Claude no funcionan del todo')}</span></span>
            </div>
            <div className="press-rows">{press}</div>
          </motion.div>
        )}
        {todo.length > 0 && (
          <motion.div {...fade(2)} className="mb-6">
            <h2 className="section-title">{t('Para ti')} <span className="t-small c3" style={{ fontWeight: 450 }}>{t('· en todos tus proyectos')}</span></h2>
            <div className="group">{todo}</div>
          </motion.div>
        )}
        {!ask.length && !press.length && !todo.length && (
          <motion.div {...fade(2)} className="t-head mb-5 flex items-center gap-2" style={{ color: 'var(--green)' }}><CheckCircle2 size={18} /> {t('Nada te espera ahora: todo en marcha.')}</motion.div>
        )}
        <motion.div {...fade(3)}><MissionMap /></motion.div>
        {/* EV67: the wheel's forecast, under the map. */}
        <div className="mt-3"><ForecastLine projectId={Object.entries(state.settings.relayChains ?? {}).find(([, x]) => x?.on && x.order.length)?.[0]} /></div>
        {crew.length > 0 && <motion.div {...fade(3)} className="group mt-4">{crew}</motion.div>}
        {agents.some((a) => a.state === 'baja' || a.state === 'apartada') && (
          <div className="t-small c3 mt-3 flex items-center gap-2 flex-wrap">
            {t('Sin usar:')}
            {agents.filter((a) => a.state === 'baja' || a.state === 'apartada').map((a) => (
              <button key={a.id} className="chip" onClick={() => setAgentOpen(a.id)} title={t('Ver su ficha (ahí se cambia)')}>{accName(a.id)} · {a.state === 'baja' ? t('de baja') : (() => { const r = (state.settings.reserves ?? []).find((x) => x.on && x.account === a.id); return r ? t('de reserva para {v0}', { v0: state.projects.find((p) => p.id === r.projectId)?.name ?? r.projectId }) : t('no usar') })()}</button>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-x-8 gap-y-9 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col gap-9 min-w-0">
          {(projects.data?.length ?? 0) > 1 && (
            <section>
              <h2 className="section-title">{t('Tus proyectos')} <span className="t-small c3" style={{ fontWeight: 450 }}>{t('· pulsa uno para verlo aquí')}</span></h2>
              <motion.div {...fade(5)} className="group">
                {projects.data!.map((x) => {
                  const color = x.level === 'mal' ? 'var(--red)' : x.level === 'aviso' ? 'var(--orange)' : 'var(--green)'
                  return (
                    <button key={x.id} className="row" disabled={x.active && !x.missing} style={x.active && !x.missing ? { opacity: 1, cursor: 'default' } : undefined}
                      onClick={() => (x.missing ? void api<unknown>('relocateProject', x.id).then((r) => { if (r) { toast(t('{name} vuelve a estar localizado', { name: x.name })); projects.reload() } }, (e) => toast((e as Error).message)) : void api('setActiveProject', x.id).then(() => toast(t('Viendo {name}', { name: x.name }))))}
                      title={x.level === 'mal' ? t('Algo falla: míralo antes de seguir') : x.level === 'aviso' ? t('Hay algo que mirar') : t('Todo en orden')}>
                      <span className="flex-none rounded-full" style={{ width: 10, height: 10, background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` }} />
                      <span className="min-w-0 flex-1">
                        <span className="t-body block" style={{ fontWeight: 600 }}>{x.name}{x.active ? <span className="t-small c3" style={{ fontWeight: 450 }}> {t('· el que ves')}</span> : null}</span>
                        <span className="t-small c3 block clamp-2">{x.parts.join(' · ')}</span>
                      </span>
                    </button>
                  )
                })}
              </motion.div>
            </section>
          )}
          {week.data && (() => {
            const m = week.data.now, b = week.data.before
            const per = (x: WeekMetrics) => (x.done ? Math.round((x.weekPoints / x.done) * 10) / 10 : undefined)
            const rework = (x: WeekMetrics) => (x.done ? Math.round((x.changes / x.done) * 100) : undefined)
            return (
              <section>
                <h2 className="section-title">{t('Cómo vamos')} <span className="t-small c3" style={{ fontWeight: 450 }}>{t('· últimos 7 días frente a los 7 anteriores')}</span></h2>
                <div className="grid grid-cols-2 min-[640px]:grid-cols-3 gap-3">
                  <Figure label={t('Tareas entregadas')} value={m.done} before={b.done} sub={t('{approved} aprobadas por ti', { approved: m.approved })} />
                  <Figure label={t('Con pruebas pasadas')} value={m.checksOk} before={b.checksOk} sub={m.checksFail ? t('{checksFail} veces fallaron', { checksFail: m.checksFail }) : t('comprobaciones del proyecto')} />
                  <Figure label={t('Cambios que pediste')} value={m.changes} before={b.changes} sub={rework(m) != null ? t('{v0} por cada 100 entregas', { v0: rework(m) }) : undefined} lowerIsBetter />
                  <Figure label={t('Uso por tarea')} value={per(m) != null ? `${String(per(m)).replace('.', ',')} pts` : '—'} before={per(b) != null ? `${String(per(b)).replace('.', ',')} pts` : undefined} sub={t('{weekPoints} puntos de semana, todas las cuentas y proyectos', { weekPoints: m.weekPoints })} />
                  <Figure label={t('Paradas por límite')} value={m.limits} before={b.limits} sub={t('{handoffs} tareas pasaron de cuenta', { handoffs: m.handoffs })} lowerIsBetter />
                  <Figure label={t('Hasta que otra sigue')} value={m.handoffMinutes != null ? `${m.handoffMinutes} min` : '—'} before={b.handoffMinutes != null ? `${b.handoffMinutes} min` : undefined} sub={t('tras un límite (mediana)')} />
                </div>
              </section>
            )
          })()}
          {day && (
            <section>
              <h2 className="section-title">{t('Hoy')} <button className="more" onClick={() => go('cronologia')}>{t('Cronología')}</button></h2>
              <div className="grid grid-cols-2 gap-3">
                <Highlight i={5} icon={<CheckCircle2 size={15} />} color="var(--green)" label={t('Tareas hechas')} value={day.done} sub={t('según los agentes')} onClick={() => go('cronologia')} />
                <Highlight i={6} icon={<GitCommitHorizontal size={15} />} color="var(--orange)" label={t('Cambios guardados')} value={day.commits} sub={t('commits en git')} onClick={() => go('integracion')} />
                <Highlight i={7} icon={<Images size={15} />} color="var(--pink)" label={t('Imágenes y vídeos')} value={day.media} sub="nuevos" onClick={() => go('galeria')} />
                <Highlight i={8} icon={<MessageCircle size={15} />} color="var(--blue)" label={t('Tus peticiones')} value={day.requests} sub={t('a los Claude')} onClick={() => go('cronologia')} />
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-9 min-w-0">
          <section>
            <h2 className="section-title">{t('Recién creado')} <button className="more" onClick={() => go('galeria')}>{t('Galería')}</button></h2>
            {imgs.length ? (
              <motion.div {...fade(5)} className="grid gap-2 grid-cols-4 grid-rows-2" style={{ aspectRatio: '2 / 1' }}>
                {imgs.slice(0, 5).map((a, i) => (
                  <button key={a.id} className={`tile p-0 border-0 ${i === 0 ? 'col-span-2 row-span-2' : ''}`} onClick={() => setViewer(a.id, imgs.slice(0, 5).map((x) => x.id))} title={a.name} style={{ borderRadius: i === 0 ? 16 : 12 }}>
                    <img src={thumbUrl(a.id, i === 0 ? 900 : 360)} alt={a.name} loading="lazy" />
                  </button>
                ))}
              </motion.div>
            ) : <div className="group"><div className="row c3">{t('Todavía no hay imágenes: las capturas y vídeos que hagan los Claude en este proyecto aparecerán aquí y en Galería.')}</div></div>}
          </section>
          <section>
            <h2 className="section-title">{t('Últimos cambios')} <button className="more" onClick={() => go('cronologia')}>{t('Ver todo')}</button></h2>
            <motion.div {...fade(6)} className="group">
              {changes.map((e) => {
                const h = humanize(e)
                const color = e.kind === 'commit' ? 'var(--orange)' : e.kind === 'relevo' ? 'var(--purple)' : e.kind === 'peticion' ? 'var(--blue)' : 'var(--green)'
                const Icon = e.kind === 'commit' ? GitCommitHorizontal : e.kind === 'relevo' ? Hourglass : e.kind === 'peticion' ? MessageCircle : CheckCircle2
                return (
                  <button key={e.id} className="row" onClick={() => go('cronologia')}>
                    <span className="icon-sq icon-sq-lg" style={{ background: color }}><Icon size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="t-body block clamp-2">{e.kind === 'peticion' ? <>{t('Pediste: «{text}»', { text: h.text })}</> : h.text}</span>
                      <span className="t-small c3 block truncate">{clock(e.at)} · {ago(e.at, now)}{e.account ? ` · ${accName(e.account)}` : ''}{h.ids ? ` · ${h.ids}` : ''}</span>
                    </span>
                  </button>
                )
              })}
              {recent.data && !changes.length && <div className="row c3">{t('Sin cambios en las últimas 48 horas.')}</div>}
              {!recent.data && <div className="row"><div className="skeleton h-4 w-2/3 rounded" /></div>}
            </motion.div>
          </section>
        </div>
      </div>
    </div>
  )
}
