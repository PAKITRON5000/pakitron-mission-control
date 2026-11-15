// Inicio as the live map (EV84; Decidir #127, the user chose the «Mapa vivo»): the projects are missions with their
// progress and what waits for the user, and each Claude is its own ring (its colour, its number, what is left of its
// 5 hours and its week) that slides along the line to the project where it works, waits on the wheel for its turn, or
// rests until its usage comes back. Everything from what the app already knows; nothing spends usage. The user, 13-11,
// after seeing drawn characters and a battle: «lo que mejor se entienda para el usuario… que quede bien y ya».
import { t, tn } from '../../../core/i18n'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useStore, useAsync, type Route } from '../lib/store'
import { api, type AgentCard } from '../lib/api'
import type { ChainMember, RelayChain } from '../../../core/chain'
import { ClaudeRing } from './ClaudeRing'
import { mapCast, type CastMember } from './missionCast'
import { clock, plural } from '../lib/format'
import { accName } from './ui'

type WheelData = Record<string, { chain: RelayChain; members: ChainMember[] }>
type TaskLite = { status: string; section?: string; extId?: string; title: string }

const TONE: Record<CastMember['tone'], string> = { gold: 'var(--yellow-ink, #b07800)', teal: 'var(--teal)', red: 'var(--red)', orange: 'var(--orange)', gray: 'var(--label-3)' }
const short = (id: string) => accName(id)
/** The tasks of a mission: as the wheel's agenda counts them (`agendaDone`), by a section whose name contains it. */
const inMission = (t: TaskLite, section?: string) => !section || (t.section ?? '').toLowerCase().includes(section.toLowerCase())
const RING = 88
const PLATE = 184

/** One Claude: its ring and a plate with what it is doing. On the way to a project it slides there along the line. */
function Pilot({ m, a, doing, path, at, style, compact }: { m: CastMember; a?: AgentCard; doing?: string; path?: string; at?: number; style?: CSSProperties; compact?: boolean }) {
  const { setAgentOpen, now, state } = useStore()
  const projectName = (id: string) => state?.projects.find((p) => p.id === id)?.name ?? id
  const [dist, setDist] = useState(0)
  useEffect(() => {
    if (!path) return
    const r = requestAnimationFrame(() => setDist(at ?? 80))
    return () => cancelAnimationFrame(r)
  }, [path, at])
  if (!a) return null
  const walker: CSSProperties = path ? ({ offsetPath: `path('${path}')`, offsetDistance: `${dist}%`, offsetAnchor: `${PLATE / 2}px ${RING / 2}px`, offsetRotate: '0deg', left: 0, top: 0 } as CSSProperties) : {}
  return (
    <button className={`mm-pilot mm-${m.mood} ${compact ? 'mm-c-pilot' : ''}`} style={{ ...walker, ...style }} onClick={() => setAgentOpen(m.id as any)} aria-label={`${short(m.id)}: ${m.label}`}>
      <span className="mm-ring">
        <ClaudeRing a={a} size={compact ? 72 : RING} now={now} />
        <span className="mm-num" style={{ background: m.color }}>{m.id.replace(/\D/g, '')}</span>
        {m.mood === 'llama' && <span className="mm-bubble">✋</span>}
      </span>
      <span className={`mm-plate ${m.holder ? 'turn' : ''}`}>
        <b>{short(m.id)}</b>
        <span className="mm-label" style={{ color: TONE[m.tone] }}>{m.label}</span>
        {m.mood === 'duerme' && m.backAt && <span className="mm-doing">{t('vuelve a las {v0}', { v0: clock(m.backAt) })}</span>}
        {doing && <span className="mm-doing">{doing}</span>}
        {m.alsoIn?.length ? <span className="mm-also" title={t('El mismo Claude tiene otra ventana trabajando a la vez')}>{t('y a la vez en {v0}', { v0: m.alsoIn.map(projectName).join(', ') })}</span> : null}
      </span>
    </button>
  )
}

function Panel({ pid, wheels, tasks, onClose, inline }: { pid: string; wheels?: WheelData; tasks?: TaskLite[]; onClose: () => void; inline?: boolean }) {
  const { state, go, toast } = useStore()
  const p = state?.projects.find((x) => x.id === pid)
  if (!state || !p) return null
  const chain = wheels?.[pid]?.chain
  const section = chain?.until?.section
  const list = (tasks ?? []).filter((t) => inMission(t, section))
  const done = list.filter((t) => t.status === 'terminada').length
  const next = list.filter((t) => t.status !== 'terminada').slice(0, 3)
  const pend = state.pending?.[pid]
  const open = async (route?: Route) => {
    if (state.activeProjectId !== pid) { await api('setActiveProject', pid); toast(t('Viendo {name}', { name: p.name })) }
    if (route) go(route)
    onClose()
  }
  return (
    <div className={`mm-panel ${inline ? 'mm-panel-inline' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="mm-dot" style={{ background: p.color }} />
        <b className="t-head flex-1 truncate">{p.name}</b>
        <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label={t('Cerrar')}><X size={15} /></button>
      </div>
      <div className="mm-box">
        <div className="mm-k">{section ? t('Misión: {section}', { section: section }) : t('Tareas')}</div>
        <div className="mm-xp"><i style={{ width: `${list.length ? (done / list.length) * 100 : 0}%`, background: p.color }} /></div>
        <div className="t-small c3">{t('{done} de {length} hechas', { done: done, length: list.length })}{section && chain?.until?.next ? t('. Después, la rueda pasa a {name}', { name: state.projects.find((x) => x.id === chain.until!.next)?.name ?? chain.until.next }) : ''}</div>
        {next.length > 0 && <div className="t-small c2 mt-1.5">{t('Siguiente:')} {next.map((t) => `${t.extId ? t.extId + ' · ' : ''}${t.title.replace(/\*+/g, '').slice(0, 60)}`).join(' · ')}</div>}
      </div>
      <div className="mm-box">
        <div className="mm-k">{t('Rueda de relevos')}</div>
        {chain?.on && chain.order.length ? (
          <div className="t-small c2">{chain.order.map((id, k) => <span key={id}>{k ? ' → ' : ''}<b style={{ color: chain.holder === id ? 'var(--orange)' : undefined }}>{chain.holder === id ? '★ ' : ''}{short(id)}</b></span>)}{chain.phase === 'espera' ? t('. Esperando a que alguien recupere su uso') : ''}{chain.outgoing ? t('. {v0} remata lo pequeño', { v0: short(chain.outgoing) }) : ''}</div>
        ) : <div className="t-small c3">{t('Apagada: aquí solo se trabaja cuando tú abres un Claude.')}</div>}
      </div>
      {pend && (pend.decisions || pend.review || pend.comments) ? (
        <button className="mm-box mm-alert text-left" onClick={() => void open(pend.decisions ? 'decisiones' : pend.review ? 'tareas' : 'revisiones')}>
          <div className="mm-k" style={{ color: 'var(--red)' }}>{t('Te espera')}</div>
          <div className="t-small c2">{[pend.decisions && tn(pend.decisions, '{n} pregunta en Decidir', '{n} preguntas en Decidir'), pend.review && tn(pend.review, '{n} tarea para revisar', '{n} tareas para revisar'), pend.comments && tn(pend.comments, '{n} corrección', '{n} correcciones')].filter(Boolean).join(' · ')}</div>
        </button>
      ) : null}
      <div className="flex gap-2 flex-wrap mt-auto pt-1">
        {state.activeProjectId !== pid && <button className="btn btn-sm btn-primary" onClick={() => void open()}>{t('Ver este proyecto')}</button>}
        <button className="btn btn-sm" onClick={() => void open('relevos')}>{t('Relevos')}</button>
        <button className="btn btn-sm" onClick={() => void open('tareas')}>{t('Tareas')}</button>
      </div>
    </div>
  )
}

export function MissionMap() {
  const { state, now } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(1100)
  const [sel, setSel] = useState<string>()
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
    // The narrow layout (EV104) is another element: watch the one on screen.
  }, [W < 640])
  const projects = state?.projects ?? []
  const wheels = useAsync(() => api<WheelData>('chains'), [Math.floor(now / 15_000), state?.refreshedAt?.agents, JSON.stringify(state?.settings.relayChains ?? {})])
  const tasks = useAsync(async () => {
    const out: Record<string, TaskLite[]> = {}
    await Promise.all(projects.map(async (p) => { try { out[p.id] = await api<TaskLite[]>('tasks', p.id) } catch { /* unreadable now */ } }))
    return out
  }, [projects.map((p) => p.id).join(','), state?.refreshedAt?.docs])
  if (!state || !projects.length) return null

  const cast = mapCast(state.agents, wheels.data ?? {}, now)
  const agent = (id: string) => state.agents.find((a) => a.id === id)
  // What it says it does (`pmc ahora`), said from the conversation that puts it there: the same account with a window in
  // another project says something else there (15-11: Epic showed in Mission Control what it was doing in Canal).
  const doing = (m: CastMember) => {
    const act = state.activity?.[m.id]
    const fresh = (x?: { at: number; text: string }) => (x && now - x.at < 8 * 3600_000 ? x.text : undefined)
    const own = m.sessionId ? fresh(act?.focusBySession?.[m.sessionId]) : undefined
    if (own) return own
    const said = act?.focus
    if (said && (!said.sessionId || !m.sessionId || said.sessionId === m.sessionId) && !m.alsoIn?.length) return fresh(said)
    return agent(m.id)?.sessions.find((s) => s.sessionId === m.sessionId)?.title ?? (m.sessionId ? undefined : fresh(said))
  }
  const N = projects.length
  const nodeW = Math.round(Math.min(290, Math.max(210, W * 0.25)))
  const atBase = cast.filter((m) => m.where !== 'proyecto')
  const H = Math.round(Math.max(420, N * 130 + 40))
  const px = W - nodeW - 20
  const nodeTop = (i: number) => Math.round(20 + ((H - 40) * (i + 0.5)) / N - 54)
  const slot = Math.min(PLATE + 14, Math.max(PLATE * 0.8, (px - 60) / Math.max(1, atBase.length)))
  const by = H - 172
  const bx = Math.max(24 + (slot * atBase.length) / 2, (px - 40) * 0.3)
  const rx = Math.max(110, (slot * atBase.length) / 2 + 24)
  const start = { x: bx + rx * 0.7, y: by - 10 }
  const ctrl = (i: number) => {
    const e = { x: px - 6, y: nodeTop(i) + 54 }
    const dx = e.x - start.x
    return [start, { x: start.x + dx * 0.35, y: start.y - H * 0.25 }, { x: start.x + dx * 0.62, y: e.y + H * 0.08 }, e] as const
  }
  const route = (i: number) => {
    const [a, b, c, e] = ctrl(i)
    return `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${c.x} ${c.y}, ${e.x} ${e.y}`
  }
  // The point at a share of a route's length (as `offset-distance` measures it), to know where a Claude will stand.
  const pointAt = (i: number, pct: number) => {
    const [a, b, c, e] = ctrl(i)
    const P = (s: number) => { const u = 1 - s; return { x: u * u * u * a.x + 3 * u * u * s * b.x + 3 * u * s * s * c.x + s * s * s * e.x, y: u * u * u * a.y + 3 * u * u * s * b.y + 3 * u * s * s * c.y + s * s * s * e.y } }
    const pts = Array.from({ length: 49 }, (_, k) => P(k / 48))
    const len = [0]
    for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y))
    const want = (len[48] * pct) / 100
    const k = Math.max(1, len.findIndex((l) => l >= want))
    const f = (want - len[k - 1]) / Math.max(1e-6, len[k] - len[k - 1])
    return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * f, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * f }
  }
  // Where each Claude at work stands on its line: the first free spot, so none covers another (the user, 15-11: two
  // Claudes going to two projects were drawn one on top of the other) nor the project it goes to.
  const BOX_H = 178
  const taken: { x: number; y: number }[] = atBase.map((_, k) => ({ x: bx - (slot * atBase.length) / 2 + slot * k + slot / 2, y: by }))
  const spot = new Map<string, number>()
  projects.forEach((p, i) => cast.filter((m) => m.where === 'proyecto' && m.projectId === p.id).forEach((m) => {
    let best = 70
    let bestGap = -Infinity
    for (const at of [72, 60, 82, 48, 90, 36, 26]) {
      const q = pointAt(i, at)
      if (q.x + PLATE / 2 > px - 8) continue
      const gap = taken.reduce((g, o) => Math.min(g, Math.max(Math.abs(o.x - q.x) - (PLATE + 10), Math.abs(o.y - q.y) - BOX_H)), Infinity)
      if (gap >= 0) { best = at; break }
      if (gap > bestGap) { bestGap = gap; best = at }
    }
    taken.push(pointAt(i, best))
    spot.set(`${m.id}:${p.id}`, best)
  }))
  const busy = new Set(cast.filter((m) => m.where === 'proyecto').map((m) => m.projectId))
  const wheel = state.projects.map((p) => wheels.data?.[p.id]?.chain).find((c) => c?.on && c.order.length)
  const baseText = wheel ? <>{t('Rueda:')} {wheel.order.map((id) => id.replace(/\D/g, '')).join(' → ')}{wheel.holder ? <> {t('· turno de')} <b>{short(wheel.holder)}</b></> : null}</> : t('Base: aquí esperan los que no trabajan')
  const nodeBody = (p: (typeof projects)[number]) => {
    const chain = wheels.data?.[p.id]?.chain
    const section = chain?.until?.section
    const list = (tasks.data?.[p.id] ?? []).filter((t) => inMission(t, section))
    const done = list.filter((t) => t.status === 'terminada').length
    const pend = state.pending?.[p.id]
    const n = (pend?.decisions ?? 0) + (pend?.review ?? 0) + (pend?.comments ?? 0)
    return (
      <>
        {n > 0 && <span className="mm-flag" title={t('Te espera en este proyecto')}>{n}</span>}
        <span className="flex items-center gap-2 min-w-0"><span className="mm-dot" style={{ background: p.color }} /><b className="truncate">{p.name}</b></span>
        <span className="t-small c3 block truncate mt-0.5">{section ? t('Misión: {section}', { section: section }) : busy.has(p.id) ? t('Alguien trabaja aquí') : t('Nadie trabaja aquí ahora')}</span>
        <span className="mm-xp block"><i style={{ width: `${list.length ? (done / list.length) * 100 : 0}%`, background: p.color }} /></span>
        <span className="t-small c3 flex justify-between mt-1"><span>{tasks.data ? t('{done} de {length} hechas', { done: done, length: list.length }) : '…'}</span><span className="num">{list.length ? `${Math.round((done / list.length) * 100)} %` : ''}</span></span>
      </>
    )
  }

  // EV104 (the user, 13-11: «en la appweb del móvil… se solapan los círculos de claude con los proyectos»): below 640 px
  // the drawn map has no room (projects 210 px wide on the right, plates of 184 px), so it becomes a list: each project
  // with the Claudes working on it right under it, and the base with the ones waiting at the end.
  if (W < 640) return (
    <div ref={box} className="mm mm-compact">
      {projects.map((p) => {
        const crew = cast.filter((m) => m.where === 'proyecto' && m.projectId === p.id)
        return (
          <div key={p.id} className="flex flex-col gap-2">
            <button className={`mm-node mm-c-node ${p.id === state.activeProjectId ? 'on' : ''} ${sel === p.id ? 'sel' : ''} ${busy.has(p.id) ? 'mm-c-busy' : ''}`} style={{ ['--c' as any]: p.color }} onClick={() => setSel(sel === p.id ? undefined : p.id)}>
              {nodeBody(p)}
            </button>
            {crew.length > 0 && <div className="mm-c-crew">{crew.map((m) => <Pilot key={m.id} m={m} a={agent(m.id)} doing={doing(m)} compact />)}</div>}
            {sel === p.id && <Panel pid={p.id} wheels={wheels.data} tasks={tasks.data?.[p.id]} onClose={() => setSel(undefined)} inline />}
          </div>
        )
      })}
      {atBase.length > 0 && (
        <div className="mm-c-base">
          <div className="t-small c3">{baseText}</div>
          <div className="mm-c-crew">{atBase.map((m) => <Pilot key={m.id} m={m} a={agent(m.id)} compact />)}</div>
        </div>
      )}
      <div className="t-small c3">{t('Anillos: fuera la semana, dentro las 5 horas. Pulsa un proyecto o un Claude para ver su ficha.')}</div>
    </div>
  )

  return (
    <div ref={box} className="mm" style={{ height: H }}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs><linearGradient id="mm-hot" x1="0" x2="1"><stop offset="0" stopColor="var(--teal)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient></defs>
        {projects.map((p, i) => busy.has(p.id) ? (
          <g key={p.id}>
            <path d={route(i)} fill="none" stroke="var(--accent-soft)" strokeWidth={14} strokeLinecap="round" />
            <path d={route(i)} fill="none" stroke="url(#mm-hot)" strokeWidth={4} strokeLinecap="round" className="mm-flow" />
          </g>
        ) : <path key={p.id} d={route(i)} fill="none" stroke="var(--sep)" strokeWidth={2} strokeDasharray="3 8" />)}
        <ellipse cx={bx} cy={by + 40} rx={rx} ry={26} fill="var(--fill)" stroke="var(--sep)" strokeWidth={1.5} />
      </svg>

      <div className="mm-pad-label" style={{ left: bx, top: by + RING / 2 + 82 }}>{baseText}</div>

      {projects.map((p, i) => (
        <button key={p.id} className={`mm-node ${p.id === state.activeProjectId ? 'on' : ''} ${sel === p.id ? 'sel' : ''}`} style={{ left: px, top: nodeTop(i), width: nodeW, ['--c' as any]: p.color }} onClick={() => setSel(sel === p.id ? undefined : p.id)}>
          {nodeBody(p)}
        </button>
      ))}

      {atBase.map((m, k) => (
        <Pilot key={m.id + ':base'} m={m} a={agent(m.id)} style={{ left: bx - (slot * atBase.length) / 2 + slot * k + slot / 2 - PLATE / 2, top: by - RING / 2 }} />
      ))}
      {projects.map((p, i) => cast.filter((m) => m.where === 'proyecto' && m.projectId === p.id).map((m) => (
        <Pilot key={m.id + ':' + p.id} m={m} a={agent(m.id)} doing={doing(m)} path={route(i)} at={spot.get(`${m.id}:${p.id}`) ?? 70} />
      )))}

      {sel && <Panel pid={sel} wheels={wheels.data} tasks={tasks.data?.[sel]} onClose={() => setSel(undefined)} />}
      <div className="mm-legend"><span><i className="hot" /> {t('trabajando ahora')}</span><span><i /> {t('nadie ahora')}</span><span>{t('Anillos: fuera la semana, dentro las 5 horas')}</span><span>{t('Pulsa un proyecto o un Claude para ver su ficha')}</span></div>
    </div>
  )
}
