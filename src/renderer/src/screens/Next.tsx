import { useState } from 'react'
import { ArrowRightLeft, Bot, Cpu, Clock, ChevronUp, ChevronDown, ChevronRight, RotateCcw, AlarmClock, X, Play, UserRoundCheck } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { plain, verdict } from './Tasks'
import { api, type AgentCard, type Task } from '../lib/api'
import { Avatar, STATE_META, accountNum, Recharge, accName } from '../components/ui'
import { whenFull } from '../lib/format'
import { isSessionWorking } from '../../../core/working'
import { RELAY_MODES } from '../../../core/turns'
import { WORK_MODES, modeOf, settingsFor } from '../../../core/workmode'
import { WhoWhere } from '../components/WhoWhere'
import { useRelayRules } from '../components/RelayRules'

interface AssignedTask { key: string; extId?: string; title: string; status: string; priority: number }
interface AssignmentView { id: number; to: string; from: string; position: number; order: string[]; tasks: AssignedTask[] }

/** When an account can work again: now (it has usage), or when its limit resets. */
function availableAt(a: AgentCard, now: number): number {
  if (a.state === 'sin-uso') return a.usage.activeLimit?.resetsAt ?? now + 7 * 86400_000
  return now
}

const name = (id: string) => `${accName(id)}`
/** A task's model tag in words: «sonnet» → «las de Sonnet», «fable u opus» → «las de Fable u Opus» (was «Fable U Opus»). */
const modelKind = (m: string) => m === 'sin etiqueta' ? 'las sin modelo apuntado' : `las de ${m.replace(/\b(fable|opus|sonnet|haiku)\b/g, (x) => x[0].toUpperCase() + x.slice(1))}`

/** One line of a queue: opens to say what the task is; with `onMove`, it can go up or down. */
function TaskLine({ extId, title, status, all, onMove }: { extId?: string; title: string; status: string; all: Task[]; onMove?: (d: number) => void }) {
  const [open, setOpen] = useState(false)
  const full = all.find((x) => (extId ? x.extId === extId : x.title === title))
  const v = full ? verdict(full) : undefined
  return (
    <div>
      <div className="flex items-center gap-1">
        {onMove && (
          <span className="flex flex-none">
            <button className="btn btn-sm btn-icon btn-ghost" style={{ height: 22, width: 22 }} onClick={() => onMove(-1)} aria-label="Hacer antes"><ChevronUp size={12} /></button>
            <button className="btn btn-sm btn-icon btn-ghost" style={{ height: 22, width: 22 }} onClick={() => onMove(1)} aria-label="Hacer después"><ChevronDown size={12} /></button>
          </span>
        )}
        <button className="flex-1 min-w-0 text-left border-0 bg-transparent p-0 t-body flex gap-2 items-center" onClick={() => setOpen(!open)} title="Ver qué es">
          <b className="t-small num c3 w-14 flex-none">{extId ?? '—'}</b>
          <span className={open ? '' : 'truncate'} style={{ fontWeight: open ? 600 : undefined }}>{full ? plain(full) : title}</span>
          {status === 'en-desarrollo' && <span className="t-small flex-none" style={{ color: 'var(--accent)' }}>a medias</span>}
          {v && <span className="pill flex-none" style={{ background: `color-mix(in srgb, ${v.color} 15%, transparent)`, color: v.color }}>{v.label}</span>}
        </button>
      </div>
      {open && full && (
        <div className="ml-16 mt-1 mb-2 rounded-xl px-3 py-2 t-small c2 whitespace-pre-wrap selectable leading-relaxed" style={{ background: 'var(--fill)', maxHeight: 280, overflowY: 'auto' }}>
          {full.title}{full.detail ? '\n\n' + full.detail : ''}
        </div>
      )}
    </div>
  )
}

/**
 * «Próximo» (the user, 4-11 and 5-11): who works next and on what, in order. What the user assigned stays here, visible, until
 * its tasks are done: the account starts with that and then goes on with its own. Any account can be launched right now.
 */
export function Next() {
  const { state, now, toast, refresh, go } = useStore()
  // EV140: the automatic sharing out sets other accounts to work: Anthropic's rules first.
  const rules = useRelayRules()
  const [when, setWhen] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string>()
  const pid = state?.activeProjectId
  const all = useAsync(() => (pid ? api<Task[]>('tasks', pid) : Promise.resolve([] as Task[])), [pid, state?.refreshedAt?.docs])
  const given = useAsync(() => (pid ? api<AssignmentView[]>('assignments', pid) : Promise.resolve([] as AssignmentView[])), [pid, state?.refreshedAt?.docs])
  const costs = useAsync(() => (pid ? api<{ days: number; total: number; costs: { task: string; account: string; points: number; minutes: number; model?: string }[]; byModel: { model: string; tasks: number; avgPoints: number }[]; heavy?: { task: string; account: string; points: number; avg: number; model: string }[] }>('taskCosts', pid, 7) : Promise.resolve(undefined)), [pid, state?.refreshedAt?.docs && Math.floor(state.refreshedAt.docs / 600_000)])
  const staff = useAsync(() => api<{ on: boolean; max: number; projects: { projectId: string; name: string; color: string; why: string; fronts: { account: string; task: string; copy: string }[] }[] }>('staffPlans'), [Math.floor(now / 60_000), state?.refreshedAt?.agents])
  const res = useAsync(() => api<{ busy: { playing?: string; userApps: string[]; unityEditors: number; blender: number; gpu?: { usedMb: number; totalMb: number } }; held: { name: string; account: string; until: number; note?: string }[] }>('resources'), [Math.floor(now / 20_000)])
  if (!state) return null
  const tasksFull = all.data ?? []
  const assignments = given.data ?? []
  const inUse = (a: { state: string }) => a.state !== 'apartada' && a.state !== 'baja'
  const byTime = [...state.agents].filter(inUse).sort((x, y) => availableAt(x, now) - availableAt(y, now))
  // Each project has its own turn and its own queues: what is shown is this project's, never another's.
  const turn = (pid ? state.settings.nextOrderBy?.[pid] : undefined) ?? state.settings.nextOrder ?? []
  const setTurn = (ids: string[]) => api('setSettings', { nextOrderBy: { ...(state.settings.nextOrderBy ?? {}), [pid ?? '']: ids } })
  const here = (a: AgentCard) => a.assigned.filter((t) => !t.projectId || t.projectId === pid)
  const projectName = state.projects.find((p) => p.id === pid)?.name
  const chosen = turn.filter((id) => state.agents.some((a) => a.id === id && inUse(a)))
  const order = chosen.length ? [...chosen.map((id) => state.agents.find((a) => a.id === id)!), ...byTime.filter((a) => !chosen.includes(a.id))] : byTime

  const after = async () => { given.reload(); await refresh() }
  const attempt = async (fn: () => Promise<unknown>) => {
    try { await fn() } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  const move = (i: number, d: number) => attempt(async () => {
    const ids = order.map((a) => a.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await setTurn(ids)
    toast(`Turno: ${ids.map(name).join(' → ')}`)
    await refresh()
  })
  const give = (from: string, to: string) => attempt(async () => {
    const r = await api<{ tasks: number }>('handoff', pid, from, to)
    toast(`${name(to)} hará primero las ${r.tasks} tareas de ${name(from)}`)
    await after()
  })
  const moveTask = (a: AssignmentView, k: number, d: number) => attempt(async () => {
    const keys = a.tasks.map((t) => t.key)
    const j = k + d
    if (j < 0 || j >= keys.length) return
    ;[keys[k], keys[j]] = [keys[j], keys[k]]
    await api('setAssignmentOrder', a.id, keys)
    await after()
  })
  const launch = (a: AgentCard, anyway = false) => attempt(async () => {
    setBusy(a.id)
    try {
      const r = await api<{ schedule: string; scheduledAt?: number; otherProject?: string; scheduleError?: string }>('putToWork', pid, a.id, anyway)
      const extra = r.scheduleError
        ? ` Ojo: sigue programado para ${whenFull(r.scheduledAt!, now)}. ${r.scheduleError}`
        : r.schedule === 'repetido'
        ? ` He quitado su arranque de ${whenFull(r.scheduledAt!, now)}: iba a hacer lo mismo.`
        : r.schedule === 'otro'
          ? ` Su arranque de ${whenFull(r.scheduledAt!, now)} sigue en pie: es para ${r.otherProject ?? 'otro proyecto'}, otro trabajo.`
          : ''
      toast(`${name(a.id)} lanzado.${extra}`)
      await after()
    } finally { setBusy(undefined) }
  })

  return (
    <div className="content-inner max-w-[1100px]">
      <h1 className="t-display flex items-center gap-3"><span className="icon-sq icon-sq-lg" style={{ background: 'var(--indigo)' }}><Clock size={17} /></span>Próximo{projectName ? <span className="c3" style={{ fontWeight: 450 }}>· {projectName}</span> : null}</h1>
      <div className="t-head c2 mt-2 mb-6" style={{ fontWeight: 450 }}>Quién está dónde, qué hará cada cuenta en este proyecto y lo que no se puede compartir. Quién releva a quién, en Relevos.</div>
      <button className="card p-4 mb-5 w-full text-left border-0 flex items-center gap-3" onClick={() => go('agentes')}>
        <span className="flex -space-x-2">{state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada').map((a) => <Avatar key={a.id} id={a.id} size={26} />)}</span>
        <span className="min-w-0 flex-1"><b className="t-body block">Quién está dónde</b><span className="t-small c3 block">Las ventanas de cada cuenta, en qué proyecto y copia, y sus botones (que pare, que siga otra, ponerla a trabajar): en Cuentas.</span></span>
        <ChevronRight size={16} className="c3" />
      </button>
      {/* EV43: what a task costs here, so the expensive kinds are seen before they eat the week. */}
      {costs.data && costs.data.total > 0 && (
        <div className="card p-4 mb-5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap"><b className="t-body">Lo que cuesta una tarea aquí</b><span className="t-small c3">· últimos {costs.data.days} días, {costs.data.total} tareas; puntos de la semana de la cuenta que la hizo (estimado)</span></div>
          <span className="t-small c2">{/* EV118: without the tags' brackets: «las de Opus, de media 1 punto de la semana (17)» */}De media, cada tarea gasta de la semana de su cuenta: {costs.data.byModel.map((m) => `${modelKind(m.model)}, ${String(m.avgPoints).replace('.', ',')} ${m.avgPoints === 1 ? 'punto' : 'puntos'} (${m.tasks} ${m.tasks === 1 ? 'tarea' : 'tareas'})`).join(' · ')}</span>
          <span className="t-small c3">Las que más: {costs.data.costs.slice(0, 5).map((c) => `${c.task} ${c.points} (${accName(c.account)})`).join(' · ')}</span>
          {(costs.data.heavy ?? []).map((h) => <span key={h.task} className="t-small" style={{ color: 'var(--orange)' }}>Ojo: {h.task} ({accName(h.account)}) lleva {h.points} puntos de su semana desde que la cogió, más del triple de lo normal en {modelKind(h.model)} ({String(h.avg).replace('.', ',')}): quizá conviene partirla o mirar si se ha atascado.</span>)}
        </div>
      )}
      {/* EV20: what the automatic distribution would do now in each project, and why, before it does it. */}
      {staff.data && (
        <div className="card p-4 mb-5 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <b className="t-body">Reparto automático</b>
            <span className="t-small c3 min-w-0 flex-1">· {staff.data.on ? `encendido: abre sola una cuenta donde quedan tareas y nadie trabaja (hasta ${staff.data.max} a la vez por proyecto)` : 'apagado: así lo haría si lo enciendes'}</span>
            {/* The switch itself, here, where its plan is read (13-11: the user looked for it in Ajustes and it was folded away in Relevos). */}
            <button role="switch" aria-checked={staff.data.on} className="btn btn-sm flex-none" style={staff.data.on ? { background: 'color-mix(in srgb, var(--green) 16%, transparent)', color: 'var(--green)' } : undefined}
              onClick={() => void attempt(async () => { if (!(await rules.settingsOk({ autoPlan: !staff.data!.on }))) return; await api('setSettings', { autoPlan: !staff.data!.on }); await refresh(); staff.reload(); toast(`Reparto automático: ${staff.data!.on ? 'apagado' : 'encendido'}`) })}>
              {staff.data.on ? 'Apagar' : 'Encender'}
            </button>
          </div>
          {staff.data.projects.map((x) => (
            <div key={x.projectId} className="flex items-start gap-2 t-small">
              <span className="dot mt-1.5 flex-none" style={{ background: x.color }} />
              <span className="min-w-0"><b>{x.name}:</b> {x.fronts.length ? <>{x.fronts.map((f) => `${accName(f.account)} con ${f.task}${f.copy ? ` (copia ${f.copy})` : ''}`).join(' · ')}<span className="c3">. {x.why}</span></> : <span className="c2">no abriría a nadie: {x.why}</span>}</span>
            </div>
          ))}
        </div>
      )}
      {res.data && (() => {
        const { busy, held } = res.data
        const who = (n: string) => held.find((h) => h.name === n)
        const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        const items: { label: string; value: string; color: string; held?: (typeof held)[number] }[] = [
          { label: 'Tú', value: busy.playing ? 'jugando: nada pesado ni ventanas' : busy.userApps.length ? `con ${busy.userApps.join(', ')}: nada pesado` : 'el PC está libre', color: busy.playing || busy.userApps.length ? 'var(--orange)' : 'var(--green)' },
          ...(['unity', 'gpu', 'build'] as const).map((n) => {
            const h = who(n)
            const name = n === 'unity' ? 'Unity' : n === 'gpu' ? 'Gráfica' : 'Ejecutable'
            const seen = n === 'unity' && busy.unityEditors ? `${busy.unityEditors} editor${busy.unityEditors > 1 ? 'es' : ''} abierto${busy.unityEditors > 1 ? 's' : ''}` : n === 'gpu' && busy.gpu ? `${(busy.gpu.usedMb / 1024).toFixed(1).replace('.', ',')} de ${(busy.gpu.totalMb / 1024).toFixed(1).replace('.', ',')} GB` : ''
            return { label: name, value: h ? `la tiene ${accName(h.account)} hasta las ${hhmm(h.until)}${h.note ? `: ${h.note}` : ''}` : seen || 'libre', color: h ? 'var(--orange)' : n === 'unity' && busy.unityEditors ? 'var(--yellow)' : 'var(--green)', held: h }
          }),
          ...held.filter((h) => !['unity', 'gpu', 'build'].includes(h.name)).map((h) => ({ label: h.name, value: `${accName(h.account)} hasta las ${hhmm(h.until)}`, color: 'var(--orange)', held: h }))
        ]
        return (
          <div className="card p-4 mb-5 flex flex-col gap-2">
            <div className="flex items-center gap-2"><Cpu size={15} style={{ color: 'var(--indigo)' }} /><b className="t-body">Lo que no se puede compartir</b><span className="t-small c3">· los Claude piden turno antes de lanzar algo pesado</span></div>
            <div className="flex gap-2 flex-wrap">
              {items.map((x) => (
                <span key={x.label} className="rounded-xl px-3 py-2 t-small flex items-center gap-2" style={{ background: 'var(--fill)' }}>
                  <span className="rounded-full flex-none" style={{ width: 8, height: 8, background: x.color }} />
                  <b>{x.label}</b><span className="c2">{x.value}</span>
                  {x.held && <button className="btn btn-sm btn-ghost" title="Quítale el turno si esa sesión ya no existe o quieres dárselo a otro" onClick={() => void attempt(async () => { await api('freeResource', x.held!.name, x.held!.account); res.reload(); toast(`${x.label}: turno soltado`) })}><X size={12} /> Soltar</button>}
                </span>
              ))}
            </div>
          </div>
        )
      })()}
      {/* The hand-offs have their own screen now (Relevos, 12-11): here only a pointer, so nothing is said twice. */}
      {(() => {
        const on = Object.entries(state.settings.relayChains ?? {}).filter(([, c]) => c?.on)
        return (
          <button className="card p-4 mb-5 w-full text-left border-0 flex items-center gap-3" onClick={() => go('relevos')}>
            <ArrowRightLeft size={16} style={{ color: 'var(--green)' }} />
            <span className="min-w-0 flex-1">
              <b className="t-body block">Relevos</b>
              <span className="t-small c3 block">{on.length ? `Rueda encendida en ${on.map(([pid, c]) => `${state.projects.find((p) => p.id === pid)?.name ?? pid} (${c!.order.map(name).join(' → ')})`).join(' y ')}: allí manda la rueda.` : 'Ninguna rueda encendida. Elige qué cuenta releva a cuál, en rueda, en su pantalla.'}</span>
            </span>
            <ChevronRight size={16} className="c3" />
          </button>
        )
      })()}
      {/* The turn only decides who goes on when they take turns: folded otherwise (EV18). Launching is also in «Quién está dónde». */}
      <details className="turn-section" open>
        <summary className="cursor-pointer mb-3 flex items-center gap-2 flex-wrap">
          <ChevronRight size={15} className="turn-chev c3 flex-none" />
          <b className="t-body">Turno de {projectName ?? 'este proyecto'}, encargos y arranques programados</b>
          <span className="t-small c3">· {chosen.length ? 'en el orden que elegiste' : 'por orden de cuándo vuelve cada una'}</span>
          {chosen.length > 0 && <button className="btn btn-sm btn-ghost" onClick={async (e) => { e.preventDefault(); await setTurn([]); await refresh(); toast('Turno por orden de vuelta') }}><RotateCcw size={12} /> Volver al orden por hora</button>}
        </summary>
      <div className="flex flex-col gap-4">
        {order.map((a, i) => {
          const at = availableAt(a, now)
          const m = STATE_META[a.state]
          const mine = assignments.filter((x) => x.to === a.id).sort((x, y) => x.position - y.position)
          const gaveTo = assignments.find((x) => x.from === a.id)?.to
          const assigned = here(a)
          const others = state.agents.filter((x) => x.id !== a.id && here(x).length > 0 && !mine.some((g) => g.from === x.id) && !assignments.some((g) => g.from === x.id && g.to !== a.id))
          const working = a.state !== 'sin-uso' && a.sessions.some((s) => s.projectId === pid && isSessionWorking(s))
          const out = a.state === 'sin-uso'
          const own = showAll[a.id] ? assigned : assigned.slice(0, 8)
          const sched = state.settings.schedules?.[a.id]
          const pad = (n: number) => String(n).padStart(2, '0')
          const local = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
          const suggested = local(Math.max(now + 60_000, at + 3 * 60_000))
          return (
            <div key={a.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex flex-col">
                  <button className="btn btn-sm btn-icon btn-ghost" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="Antes"><ChevronUp size={14} /></button>
                  <button className="btn btn-sm btn-icon btn-ghost" disabled={i === order.length - 1} onClick={() => void move(i, 1)} aria-label="Después"><ChevronDown size={14} /></button>
                </span>
                <span className="t-title num c3 w-8">{i + 1}</span>
                <Avatar id={a.id} size={36} />
                <div className="min-w-0">
                  <div className="t-head">{name(a.id)} <span className="t-small" style={{ color: m.color }}>· {m.label}</span></div>
                  <div className="t-small c3">{at <= now ? ((a.usage.snapshot?.fiveHour && a.usage.snapshot.fiveHour.resetsAt > now && a.usage.snapshot.fiveHour.usedPct >= 95) ? `Casi sin uso: vuelve ${whenFull(a.usage.snapshot.fiveHour.resetsAt, now)}` : 'Puede trabajar ahora') : `Vuelve ${whenFull(at, now)}`}{a.usage.snapshot?.sevenDay ? ` · semana al ${Math.round(a.usage.snapshot.sevenDay.usedPct)} %` : ''}{a.usage.snapshot?.fiveHour && a.usage.snapshot.fiveHour.resetsAt > now ? ` · 5 horas al ${Math.round(a.usage.snapshot.fiveHour.usedPct)} %` : ''}{a.usage.minutesLeft ? ` · a este ritmo le quedan unos ${a.usage.minutesLeft} min (estimación)` : ''}</div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {out && <Recharge a={a} recharged={state.settings.recharged} onDone={(t) => { toast(t); void refresh() }} />}
                  <button
                    className={`btn btn-sm ${working ? 'btn-ghost' : 'btn-primary'}`}
                    disabled={!pid || out || busy === a.id}
                    title={out ? 'No tiene uso ahora: prográmalo para cuando vuelva' : working ? 'Ya está trabajando en este proyecto: te preguntaré antes de abrir otra ventana' : 'Abre una ventana y empieza por lo que tenga encargado'}
                    onClick={() => {
                      if (!working) return void launch(a)
                      if (window.confirm(`${name(a.id)} ya está trabajando en este proyecto.\n\nOtra ventana puede ponerse con lo mismo y gastar el doble. ¿La abro de todos modos?`)) void launch(a, true)
                    }}
                  >
                    <Play size={13} /> {busy === a.id ? 'Lanzando…' : working ? 'Lanzar otra ventana' : 'Lanzar ahora'}
                  </button>
                </div>
              </div>

              {sched && sched.at > now ? (
                <div className="pl-11 flex items-center gap-2 t-small" style={{ color: 'var(--green)' }}>
                  <AlarmClock size={14} /> Arranca solo {whenFull(sched.at, now)} (o al encender el PC si estaba apagado){sched.projectId !== pid ? ` · en ${state.projects.find((p) => p.id === sched.projectId)?.name ?? 'otro proyecto'}` : ''}
                  <button className="btn btn-sm btn-ghost" onClick={() => void attempt(async () => { await api('unscheduleStart', a.id); await refresh(); toast('Arranque quitado') })}><X size={12} /> Quitar</button>
                </div>
              ) : (
                <div className="pl-11 flex items-center gap-2 t-small c3 flex-wrap">
                  <AlarmClock size={14} /> Programar arranque
                  <input type="datetime-local" className="field" style={{ height: 30 }} value={when[a.id] ?? suggested} onChange={(e) => setWhen({ ...when, [a.id]: e.target.value })} />
                  <button className="btn btn-sm" onClick={() => void attempt(async () => { await api('scheduleStart', pid, a.id, new Date(when[a.id] ?? suggested).getTime()); await refresh(); toast(`${name(a.id)} arrancará solo a esa hora`) })}>Programar</button>
                </div>
              )}

              {mine.map((g, n) => (
                <div key={g.id} className="ml-11 rounded-xl p-3 flex flex-col gap-1" style={{ background: 'color-mix(in srgb, var(--indigo) 10%, transparent)' }}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <UserRoundCheck size={14} style={{ color: 'var(--indigo)' }} />
                    <b className="t-small">{mine.length > 1 ? `${n + 1}.º` : 'Primero'}: las de {name(g.from)}</b>
                    <span className="t-small c3">· encargadas por ti · {g.tasks.length} {g.tasks.length === 1 ? 'tarea' : 'tareas'}{g.order.length ? ' en el orden que has elegido' : ', en el orden que decida Claude al arrancar'}</span>
                    <span className="ml-auto flex items-center gap-1">
                      {mine.length > 1 && <>
                        <button className="btn btn-sm btn-icon btn-ghost" disabled={n === 0} onClick={() => void attempt(async () => { await api('moveAssignment', pid, g.id, -1); await after() })} aria-label="Hacer este encargo antes"><ChevronUp size={13} /></button>
                        <button className="btn btn-sm btn-icon btn-ghost" disabled={n === mine.length - 1} onClick={() => void attempt(async () => { await api('moveAssignment', pid, g.id, 1); await after() })} aria-label="Hacer este encargo después"><ChevronDown size={13} /></button>
                      </>}
                      <button className="btn btn-sm btn-ghost" onClick={() => void attempt(async () => { await api('removeAssignment', g.id); await after(); toast(`${name(a.id)} ya no hará las de ${name(g.from)}`) })}><X size={12} /> Quitar encargo</button>
                    </span>
                  </div>
                  {g.tasks.map((t, k) => <TaskLine key={t.key} extId={t.extId} title={t.title} status={t.status} all={tasksFull} onMove={g.tasks.length > 1 ? (d) => void moveTask(g, k, d) : undefined} />)}
                </div>
              ))}

              <div className="pl-11 flex flex-col gap-1">
                {mine.length > 0 && <b className="t-small mb-1">Después: las suyas</b>}
                {gaveTo ? (
                  <div className="t-small c3">Sus tareas las hará {name(gaveTo)}, porque se las has encargado{assigned.length ? ` (${assigned.length})` : ''}. Al arrancar, {name(a.id)} cogerá la siguiente libre.</div>
                ) : assigned.length > 0 ? (
                  <>
                    {own.map((t) => <TaskLine key={t.extId ?? t.title} extId={t.extId} title={t.title} status={t.status} all={tasksFull} />)}
                    {assigned.length > 8 && <button className="btn btn-sm btn-ghost self-start" onClick={() => setShowAll({ ...showAll, [a.id]: !showAll[a.id] })}>{showAll[a.id] ? 'Ver menos' : `Ver las ${assigned.length}`}</button>}
                  </>
                ) : <div className="t-small c3">Sin tareas suyas: cogerá la siguiente libre por prioridad.</div>}
              </div>

              {others.length > 0 && (
                <div className="pl-11 flex items-center gap-2 flex-wrap t-small c3">
                  <ArrowRightLeft size={13} /> {mine.length ? 'Encargarle también las de' : 'Encargarle primero las de'}
                  {others.map((x) => <button key={x.id} className="btn btn-sm" onClick={() => void give(x.id, a.id)}>{name(x.id)} ({here(x).length})</button>)}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </details>
      {rules.dialog}
    </div>
  )
}
