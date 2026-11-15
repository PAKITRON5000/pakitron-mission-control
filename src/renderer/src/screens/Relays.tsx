import { t } from '../../../core/i18n'
import { useState, type ReactNode } from 'react'
import { DeadTime } from '../components/DeadTime'
import { motion, AnimatePresence } from 'motion/react'
import { Repeat, ListOrdered, Plus, X, ChevronLeft, ChevronRight, Pause, Play, Hand, Pencil, Check, Info, History, CornerDownLeft, AlertTriangle, MonitorOff } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type AgentCard } from '../lib/api'
import { Avatar, Segmented, SPRING, STATE_META, ACCOUNT_COLOR, accLabel, accName, ACCOUNT_NAME } from '../components/ui'
import { ForecastLine } from '../components/ForecastLine'
import { UsageBars, hhmm, usageView, usedColor } from '../components/ClaudeRing'
import { memberViews, nextInLine, type ChainMember, type MemberStatus, type RelayChain } from '../../../core/chain'
import { whenFull } from '../lib/format'
import { isSessionWorking } from '../../../core/working'
import { WorkModeCard } from '../components/WorkMode'
import { useRelayRules } from '../components/RelayRules'

type WheelData = Record<string, { chain: RelayChain; members: ChainMember[] }>

const STATUS: Record<MemberStatus, { label: string; color: string }> = {
  turno: { get label() { return t('Tiene el turno') }, color: 'var(--green)' },
  lista: { get label() { return t('Espera su turno') }, color: 'var(--teal)' },
  'sin-uso': { get label() { return t('Sin uso') }, color: 'var(--red)' },
  pausa: { get label() { return t('En pausa') }, color: 'var(--label-3)' },
  ocupada: { get label() { return t('En otro proyecto') }, color: 'var(--orange)' },
  fuera: { get label() { return t('Se salta') }, color: 'var(--label-3)' }
}

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className="no-drag flex items-center gap-2.5 border-0 bg-transparent p-0" onClick={onChange}>
      <span className="t-body" style={{ fontWeight: 620, color: on ? 'var(--green)' : 'var(--label-3)' }}>{on ? t('Encendida') : t('Apagada')}</span>
      <span className="flex-none rounded-full relative" style={{ width: 46, height: 28, background: on ? 'var(--green)' : 'var(--fill-3)', transition: 'background 160ms ease' }}>
        <motion.span className="rounded-full absolute" style={{ top: 3, width: 22, height: 22, background: '#fff', boxShadow: '0 1px 3px rgb(0 0 0 / 0.25)' }} animate={{ left: on ? 21 : 3 }} transition={SPRING} />
      </span>
    </button>
  )
}

/** The next hours of each account of the wheel: red while it has no usage, green when it has. */
function Hours({ chain, members, now }: { chain: RelayChain; members: ChainMember[]; now: number }) {
  const H = 10
  const span = H * 3600_000
  // Whole hours, every two: «02:00, 04:00…» reads better than «02:02, 04:02…».
  const firstHour = Math.ceil(now / 3600_000) * 3600_000
  const marks = Array.from({ length: H }, (_, i) => firstHour + i * 3600_000).filter((t) => new Date(t).getHours() % 2 === 0 && t - now < span - 1800_000 && t - now > 1800_000)
  const x = (t: number) => `${Math.max(0, Math.min(100, ((t - now) / span) * 100))}%`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="w-[92px] flex-none" />
        <div className="relative flex-1 h-4 t-small c3">
          <span className="absolute num" style={{ left: 0 }}>{t('ahora')}</span>
          {marks.map((t) => (
            <span key={t} className="absolute num" style={{ left: x(t), transform: 'translateX(-50%)' }}>{new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
          ))}
        </div>
      </div>
      {chain.order.map((id) => {
        const m = members.find((x) => x.id === id)
        const skipped = !m || m.status || chain.paused?.includes(id)
        const back = m?.state === 'sin-uso' ? m.backAt ?? now + span : undefined
        return (
          <div key={id} className="flex items-center gap-3">
            <span className="w-[92px] flex-none flex items-center gap-1.5 t-small truncate"><Avatar id={id} size={18} /><b>{accName(id)}</b></span>
            <div className="relative flex-1 rounded-full overflow-hidden" style={{ height: 12, background: 'var(--fill)' }}>
              {skipped ? <span className="absolute inset-0" style={{ background: 'repeating-linear-gradient(45deg, var(--fill-2) 0 6px, transparent 6px 12px)' }} /> : (
                <>
                  {back && <span className="absolute top-0 bottom-0 left-0" style={{ width: x(back), background: 'color-mix(in srgb, var(--red) 55%, transparent)' }} />}
                  <span className="absolute top-0 bottom-0 right-0" style={{ left: back ? x(back) : 0, background: `color-mix(in srgb, ${ACCOUNT_COLOR[id]} ${chain.holder === id ? 85 : 45}%, transparent)` }} />
                </>
              )}
            </div>
            <span className="t-small c3 w-[120px] flex-none truncate">{skipped ? t('se salta') : back ? t('vuelve {v0}', { v0: back - now > span ? whenFull(back, now) : hhmm(back, now) }) : t('con uso')}</span>
          </div>
        )
      })}
      <div className="t-small c3 flex gap-4 flex-wrap mt-1">
        <span className="flex items-center gap-1.5"><span className="inline-block rounded-full" style={{ width: 14, height: 8, background: 'color-mix(in srgb, var(--red) 55%, transparent)' }} /> {t('sin uso')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block rounded-full" style={{ width: 14, height: 8, background: 'var(--fill-3)' }} /> {t('con uso (más fuerte: la que tiene el turno)')}</span>
      </div>
    </div>
  )
}

/** One account inside the wheel. */
function Token({ id, pid, a, view, holder, first, last, onMove, onGive, onPause, onRemove, paused, wheelOn, now, drag }: {
  id: string; pid: string; a?: AgentCard; view: ReturnType<typeof memberViews>[number]; holder: boolean; first: boolean; last: boolean
  onMove: (d: number) => void; onGive: () => void; onPause: () => void; onRemove: () => void; paused: boolean; wheelOn: boolean; now: number
  drag: { onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void; over: boolean }
}) {
  const { state, toast } = useStore()
  const noFable: string[] = state?.settings.noFable ?? []
  // EV141: its background session on this project (the wheel «Sin ventanas»), with «Ver» to open it in a window.
  const bg = a?.sessions.filter((s) => s.kind === 'background' && s.projectId === pid).sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))[0]
  // «blocked»: at the usage limit, or with usage and waiting for a message (it ended its turn asking).
  const bgText = !bg ? '' : bg.state === 'blocked' ? (a?.state === 'sin-uso' ? t('sin uso') : t('te espera')) : isSessionWorking(bg) ? t('trabajando') : t('en reposo')
  const s = STATUS[view.status]
  const five = a ? usageView(a, 'five', now) : undefined
  const week = a ? usageView(a, 'week', now) : undefined
  const Mini = ({ label, v }: { label: string; v?: ReturnType<typeof usageView> }) => (
    <div className="flex items-center gap-2 t-small">
      <span className="c3 w-9 flex-none">{label}</span>
      <span className="relative flex-1 rounded-full" style={{ height: 6, background: 'var(--fill-2)' }}>
        {/* EV175: what is used, as /usage draws it. */}
        {v?.used != null && v.used > 0 && <span className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${Math.max(3, Math.min(100, v.used))}%`, background: usedColor(v.used, ACCOUNT_COLOR[id as any]) }} />}
      </span>
      <span className="num w-11 text-right flex-none whitespace-nowrap" style={{ color: v?.used == null ? 'var(--label-3)' : usedColor(v.used, 'var(--label-2)'), fontWeight: 600 }} title={t('Usado, como en /usage')}>{v?.out ? '100 %' : v?.used == null ? '—' : `${Math.round(v.used)} %`}</span>
    </div>
  )
  return (
    <motion.div layout transition={SPRING} draggable onDragStart={drag.onDragStart} onDragOver={drag.onDragOver} onDrop={drag.onDrop}
      className="rounded-2xl p-3 flex flex-col gap-2.5 relative"
      style={{ width: 236, background: holder && wheelOn ? 'color-mix(in srgb, var(--green) 10%, var(--bg-elev))' : 'var(--bg-elev-2)', boxShadow: holder && wheelOn ? 'inset 0 0 0 2px var(--green)' : drag.over ? 'inset 0 0 0 2px var(--accent)' : 'var(--card-edge)', cursor: 'grab' }}>
      {holder && wheelOn && <span className="absolute -top-2.5 left-3 pill" style={{ background: 'var(--green)', color: 'white', height: 20 }}><span className="dot live-dot" style={{ background: 'white', color: 'white' }} />{t('TIENE EL TURNO')}</span>}
      <div className="flex items-center gap-2.5 min-w-0 mt-0.5">
        <Avatar id={id as any} size={36} />
        <div className="min-w-0 flex-1">
          <div className="t-head truncate">{accName(id)}</div>
          {/* EV101: the model it works with now, and «sin Fable» while the app has it marked out of Fable. */}
          <div className="t-small c3 truncate">{[ACCOUNT_NAME[id] ? `Claude ${id.slice(6)}` : '', (() => { const m = a?.sessions.find((x) => x.model)?.model ?? a?.usage.snapshot?.model ?? ''; return /fable/i.test(m) ? t('con Fable') : /opus/i.test(m) ? t('con Opus') : /sonnet/i.test(m) ? t('con Sonnet') : '' })(), noFable.includes(id) ? t('sin Fable') : ''].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="t-small flex items-center gap-1.5 min-w-0" style={{ color: s.color, fontWeight: 600 }}>
        <span className="dot flex-none" style={{ background: s.color }} />
        <span className="truncate">{view.status === 'sin-uso' && view.backAt ? t('Sin uso · vuelve {v0}', { v0: hhmm(view.backAt, now) }) : view.text}</span>
      </div>
      {bg && (
        <div className="t-small flex items-center gap-1.5 min-w-0 -mt-1">
          <span className="c3 truncate flex items-center gap-1.5 min-w-0" title={t('Sesión de Claude Code sin ventana ({shortId}): {bgText}', { shortId: bg.shortId, bgText: bgText })}><MonitorOff size={13} className="flex-none" aria-label={t('Sin ventana')} />{bgText}</span>
          <button className="btn btn-sm ml-auto flex-none" title={t('Abre esta sesión en una ventana para mirarla o escribirle')} onClick={() => void api('attachSession', id, bg.cwd, bg.shortId).then(() => toast(t('Abriendo la sesión en una ventana')), (e: Error) => toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}><Play size={11} /> {t('Ver')}</button>
        </div>
      )}
      {a && view.status !== 'fuera' && <div className="flex flex-col gap-1"><Mini label={t('5 h')} v={five} /><Mini label={t('sem.')} v={week} /></div>}
      <div className="flex items-center gap-1 -mb-1">
        <button className="btn btn-sm btn-icon btn-ghost" disabled={first} onClick={() => onMove(-1)} aria-label={t('Antes en la rueda')} title={t('Antes en la rueda')}><ChevronLeft size={14} /></button>
        <button className="btn btn-sm btn-icon btn-ghost" disabled={last} onClick={() => onMove(1)} aria-label={t('Después en la rueda')} title={t('Después en la rueda')}><ChevronRight size={14} /></button>
        {!holder && wheelOn && view.status !== 'sin-uso' && view.status !== 'fuera' && (
          <button className="btn btn-sm" onClick={onGive} title={t('Le pasa el turno ahora: se le avisa (o se abre) y la que lo tenía espera')}><Hand size={12} /> {t('Dar turno')}</button>
        )}
        <span className="ml-auto flex">
          <button className="btn btn-sm btn-icon btn-ghost" onClick={onPause} aria-label={paused ? t('Reanudar') : t('Pausar')} title={paused ? t('Reanudar: vuelve a contar en la rueda') : t('Pausar: sigue en la rueda pero se la salta')}>{paused ? <Play size={13} /> : <Pause size={13} />}</button>
          <button className="btn btn-sm btn-icon btn-ghost" onClick={onRemove} aria-label={t('Quitar de la rueda')} title={t('Quitar de la rueda')}><X size={13} /></button>
        </span>
      </div>
    </motion.div>
  )
}

/**
 * The agenda (13-11): «trabajad en la lista X de este proyecto y, cuando esté hecha, seguid con aquel». The list is a
 * section of the project's TASKS.md; the wheel moves on by itself, same accounts and same turn.
 */
function Agenda({ chain, pid, set }: { chain: RelayChain; pid: string; set: (patch: Partial<RelayChain>, say?: string) => Promise<void> }) {
  const { state } = useStore()
  const [section, setSection] = useState(chain.until?.section ?? '')
  if (!state) return null
  const others = state.projects.filter((x) => x.id !== pid)
  const next = chain.until?.next
  const save = (patch: Partial<NonNullable<RelayChain['until']>>) => {
    const u = { section: chain.until?.section ?? section, next: chain.until?.next, ...patch }
    return set({ until: u.section || u.next ? u : undefined })
  }
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--fill)' }}>
      <div className="flex items-center gap-2"><ListOrdered size={15} style={{ color: 'var(--indigo)' }} /><b className="t-body">{t('Agenda')}</b><span className="t-small c3">{t('· qué hace la rueda aquí y adónde va después')}</span></div>
      <div className="flex items-center gap-2 flex-wrap t-small">
        <span className="c2">{t('Trabajar en la lista')}</span>
        <input className="field" style={{ height: 30, width: 260 }} placeholder={t('título (o parte) de una sección de TASKS.md')} value={section} onChange={(e) => setSection(e.target.value)}
          onBlur={() => { if (section !== (chain.until?.section ?? '')) void save({ section: section.trim() }) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <span className="c2">{t('y, cuando esté hecha, seguir con')}</span>
        <Segmented value={next ?? ''} onChange={(v) => void save({ next: v || undefined })} options={[{ value: '', label: t('Nada (se queda aquí)') }, ...others.map((o) => ({ value: o.id, label: o.name }))]} />
      </div>
      <div className="t-small c3">{chain.until?.section && next ? t('Cuando no quede nada abierto en «{section}», la rueda se apaga aquí y se enciende en {v0} con las mismas cuentas y el mismo turno.', { section: chain.until.section, v0: state.projects.find((x) => x.id === next)?.name ?? next }) : t('Sin agenda: la rueda trabaja en este proyecto hasta que la apagues.')}</div>
    </div>
  )
}

/** What the wheel will do, in sentences (never a guess: from the same decision the app takes). */
function Plan({ chain, members, now, autonomous, project, bg }: { chain: RelayChain; members: ChainMember[]; now: number; autonomous: boolean; project: string; bg: boolean }) {
  const lines: ReactNode[] = []
  const holder = members.find((m) => m.id === chain.holder)
  const nxt = nextInLine(chain, members, now)
  if (!chain.order.length) lines.push(<>{t('Añade abajo las cuentas en el orden en que quieres que se releven y enciéndela.')}</>)
  else if (!chain.on) {
    const busy = members.find((m) => chain.order.includes(m.id) && m.workingHere)
    lines.push(<>{t('Apagada: en {project} nadie pasa el turno a nadie. Al encenderla', { project: project })} {busy ? <>{t('sigue')} <b>{accLabel(busy.id)}</b>{t(', que ya está trabajando aquí')}</> : <>{t('empieza la primera de la rueda que tenga uso')}</>}.</>)
  } else if (chain.phase === 'espera' || !holder) {
    lines.push(<>{t('Nadie de la rueda tiene uso ahora:')} <b>{t('el turno espera')}</b>.{nxt ? <> {t('Seguirá')} <b>{accLabel(nxt.id)}</b>{nxt.at ? <> {t('cuando vuelva ({v0})', { v0: hhmm(nxt.at, now) })}</> : null}{t(', o la primera que recupere su uso.')}</> : null}</>)
  } else {
    lines.push(<>{t('Ahora tiene el turno')} <b>{accLabel(holder.id)}</b>{holder.workingHere ? t(' y está trabajando') : holder.state === 'sin-uso' ? t(', sin uso') : ''}.</>)
    lines.push(nxt ? <>{t('Cuando se quede sin uso{v0}, sigue', { v0: chain.passAt === 'casi' ? t(' (o termine por encima del 95 %)') : '' })} <b>{accLabel(nxt.id)}</b> {nxt.at ? <>{t('en cuanto vuelva ({v0}); si otra recupera su uso antes, sigue esa', { v0: hhmm(nxt.at, now) })}</> : <>{t('(ya tiene uso)')}</>}{t(', con el relevo de lo que quede a medias.')}</>
      : <>{t('Cuando se quede sin uso, el turno esperará a la primera que recupere el suyo.')}</>)
  }
  if (chain.on && chain.order.length > 1) lines.push(<>{t('Las demás esperan su turno: si una vuelve antes, Mission Control le pide que no toque nada, y no puede editar ni lanzar órdenes en {project} hasta que le toque.', { project: project })}</>)
  if (chain.on && bg) lines.push(<>{t('Sin ventanas: cada turno se da a una sesión de Claude Code que trabaja sin ventana (o a su ventana, si ya tiene una abierta aquí). «Ver», en cada cuenta, la abre en una ventana para mirarla o escribirle.')}</>)
  return (
    <div className="rounded-2xl p-4 flex gap-3" style={{ background: chain.on ? 'color-mix(in srgb, var(--indigo) 9%, transparent)' : 'var(--fill)' }}>
      <Info size={16} className="flex-none mt-0.5" style={{ color: 'var(--indigo)' }} />
      <div className="flex flex-col gap-1.5 t-body min-w-0">
        <b className="t-small" style={{ color: 'var(--indigo)' }}>{t('Qué pasará')}</b>
        {lines.map((l, i) => <div key={i} className="c2">{l}</div>)}
        {chain.on && !autonomous && <div style={{ color: 'var(--orange)' }} className="flex items-center gap-1.5"><AlertTriangle size={13} /> {t('El modo autónomo está apagado: las cuentas pararán al terminar cada respuesta.')}</div>}
      </div>
    </div>
  )
}

function WheelCard({ pid, data, others, reload }: { pid: string; data?: { chain: RelayChain; members: ChainMember[] }; others: WheelData; reload: () => void }) {
  const { state, now, toast, refresh } = useStore()
  // EV140: two or more accounts taking turns, only after reading Anthropic's rules.
  const rules = useRelayRules()
  const [dragFrom, setDragFrom] = useState<number>()
  const [dragOver, setDragOver] = useState<number>()
  const [showPast, setShowPast] = useState(false)
  const p = state?.projects.find((x) => x.id === pid)
  const chain: RelayChain = data?.chain ?? { on: false, order: [] }
  const members = data?.members ?? []
  const past = useAsync(() => (showPast ? api<{ at: number; account?: string; title: string; detail?: string }[]>('relayHistory', pid) : Promise.resolve([])), [showPast, pid, chain.last?.at])
  if (!p || !state) return null
  const views = memberViews(chain, members, now)
  const agentOf = (id: string) => state.agents.find((a) => a.id === id)
  const set = async (patch: Partial<RelayChain>, say?: string) => {
    try { if (!(await rules.chainOk(pid, patch))) return; await api('chainSet', pid, patch); await refresh(); reload(); if (say) toast(say) } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  const move = (i: number, j: number) => {
    if (j < 0 || j >= chain.order.length || i === j) return
    const o = [...chain.order]
    const [x] = o.splice(i, 1)
    o.splice(j, 0, x)
    void set({ order: o }, t('Rueda: {v0}', { v0: `${o.map(accName).join(' → ')} → ${accName(o[0])}` }))
  }
  const usable = state.agents.filter((a) => !state.settings.accountStatus?.[a.id] && !chain.order.includes(a.id))
  const inOther = (id: string) => Object.entries(others).find(([op, w]) => op !== pid && w.chain.on && w.chain.order.includes(id as any))?.[0]
  const projName = (id: string) => state.projects.find((x) => x.id === id)?.name ?? id
  const holderWorking = members.find((m) => m.id === chain.holder)?.workingHere
  return (
    <section className="card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="icon-sq icon-sq-lg" style={{ background: p.color }}><Repeat size={15} /></span>
        <div className="min-w-0">
          <div className="t-section">{p.name}</div>
          <div className="t-small c3">{chain.on ? (chain.phase === 'espera' ? t('Esperando a que alguien recupere su uso') : chain.holder ? t('Turno de {v0}{v1}{v2}', { v0: accLabel(chain.holder), v1: holderWorking ? t(' · trabajando') : '', v2: chain.outgoing ? t(' · solapando: {v0} termina lo pequeño', { v0: accName(chain.outgoing) }) : '' }) : t('Empezando…')) : chain.order.length ? t('{n} cuentas preparadas', { n: chain.order.length }) : t('Sin rueda')}</div>
        </div>
        <div className="ml-auto">
          <Switch on={chain.on} label={t('Rueda de relevos de {name}', { name: p.name })} onChange={() => {
            if (!chain.on && !chain.order.length) return toast(t('Primero añade las cuentas de la rueda'))
            const moved = !chain.on ? chain.order.filter((id) => inOther(id)) : []
            void set({ on: !chain.on }, chain.on ? t('Rueda de {name} apagada', { name: p.name }) : t('Rueda de {name} encendida{v0}', { name: p.name, v0: moved.length ? t('; {v0} sale{v1} de su otra rueda', { v0: moved.map(accName).join(' y '), v1: moved.length > 1 ? 'n' : '' }) : '' }))
          }} />
        </div>
      </div>

      {/* The wheel itself: the order, with arrows, and the way back to the first. */}
      <div className="rounded-2xl p-4 pt-5 overflow-x-auto" style={{ background: 'var(--fill)' }}>
        {chain.order.length ? (
          <div className="flex items-center gap-2 flex-wrap" onDragEnd={() => { setDragFrom(undefined); setDragOver(undefined) }}>
            <AnimatePresence initial={false}>
              {chain.order.map((id, i) => (
                <motion.div key={id} layout className="flex items-center gap-2" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={SPRING}>
                  <Token id={id} pid={pid} a={agentOf(id)} view={views[i]} holder={chain.holder === id} first={i === 0} last={i === chain.order.length - 1} now={now} wheelOn={chain.on}
                    paused={Boolean(chain.paused?.includes(id))}
                    onMove={(d) => move(i, i + d)}
                    onGive={() => void api('chainGive', pid, id).then(async () => { await refresh(); reload(); toast(t('Turno para {v0}: se le avisa ahora', { v0: accName(id) })) }, (e: Error) => toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}
                    onPause={() => void set({ paused: chain.paused?.includes(id) ? chain.paused.filter((x) => x !== id) : [...(chain.paused ?? []), id] }, chain.paused?.includes(id) ? t('{v0} vuelve a contar en la rueda', { v0: accName(id) }) : t('{v0} en pausa: la rueda se la salta', { v0: accName(id) }))}
                    onRemove={() => void set({ order: chain.order.filter((x) => x !== id) }, t('{v0} fuera de la rueda', { v0: accName(id) }))}
                    drag={{ onDragStart: () => setDragFrom(i), onDragOver: (e) => { e.preventDefault(); setDragOver(i) }, onDrop: () => { if (dragFrom != null) move(dragFrom, i); setDragFrom(undefined); setDragOver(undefined) }, over: dragOver === i && dragFrom !== i }} />
                  <span className="t-title c3 select-none" aria-hidden>{i < chain.order.length - 1 ? '→' : ''}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {chain.order.length > 1 && (
              <span className="flex items-center gap-1.5 t-small c3 rounded-xl px-3 py-2" style={{ background: 'var(--bg-elev-2)' }} title={t('Después de la última, vuelve a la primera')}>
                <CornerDownLeft size={14} /> {t('vuelve a')} <b className="c2">{accName(chain.order[0])}</b>
              </span>
            )}
          </div>
        ) : (
          <div className="t-body c3 py-3 text-center">{t('Aún no hay cuentas en esta rueda. Añádelas abajo en el orden en que quieres que se releven.')}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <span className="t-small c3">{t('Añadir a la rueda:')}</span>
          {usable.length ? usable.map((a) => {
            const other = inOther(a.id)
            return (
              <button key={a.id} className="btn btn-sm" onClick={() => void set({ order: [...chain.order, a.id] }, t('{v0} añadida{v1}', { v0: accName(a.id), v1: other && chain.on ? t('; sale de la rueda de {v0}', { v0: projName(other) }) : '' }))}
                title={other ? t('Está en la rueda encendida de {v0}: una cuenta solo puede estar en una rueda encendida', { v0: projName(other) }) : undefined}>
                <Plus size={12} /> <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: ACCOUNT_COLOR[a.id] }} /> {accLabel(a.id)}{other ? <span className="c3"> {t('· en {v0}', { v0: projName(other) })}</span> : null}
              </button>
            )
          }) : <span className="t-small c3">{t('todas las cuentas en uso ya están en la rueda')}</span>}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="t-small c2" style={{ fontWeight: 600 }}>{t('Pasa el turno')}</span>
        <Segmented value={chain.passAt ?? 'agotada'} onChange={(v) => void set({ passAt: v }, v === 'casi' ? t('Pasará el turno al 95 %, antes del corte') : t('Pasará el turno cuando se agote'))}
          options={[{ value: 'agotada', label: t('Cuando se agota') }, { value: 'casi', label: t('Al 95 %, antes del corte') }]} />
        <span className="t-small c2 ml-2" style={{ fontWeight: 600 }}>{t('Con solape')}</span>
        <Segmented value={chain.overlap === false ? 'no' : 'si'} onChange={(v) => void set({ overlap: v === 'si' }, v === 'si' ? t('Con solape: cuando a la que trabaja le queden unos 20 min, entra ya la siguiente con lo grande') : t('Sin solape'))}
          options={[{ value: 'si', label: t('Sí: la siguiente entra antes') }, { value: 'no', label: t('No') }]} />
        {/* EV152 (Decidir #152): two at once, the second one on what needs no Unity nor the GPU. */}
        <span className="flex items-center gap-3 flex-wrap">
          <span className="t-small c2 ml-2" style={{ fontWeight: 600 }}>{t('Dos a la vez')}</span>
          <Segmented value={chain.pair ? 'si' : 'no'} onChange={(v) => void set({ pair: v === 'si' }, v === 'si' ? t('Dos a la vez: mientras otra cuenta tenga uso, trabaja a la vez con lo que no necesita Unity ni la gráfica') : t('Uno cada vez'))}
            options={[{ value: 'no', label: t('No: uno cada vez') }, { value: 'si', label: t('Sí, si hay dos con uso') }]} />
        </span>
      </div>

      <Agenda chain={chain} pid={pid} set={set} />

      <Plan chain={chain} members={members} now={now} autonomous={Boolean(state.settings.autonomous)} project={p.name} bg={Boolean(state.settings.bgSessions)} />

      {chain.order.length > 0 && (
        <div className="flex flex-col gap-2">
          <b className="t-small c2">{t('Las próximas horas')}</b>
          <Hours chain={chain} members={members} now={now} />
          <ForecastLine projectId={p.id} />
        </div>
      )}

      <div>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowPast(!showPast)}><History size={13} /> {showPast ? t('Ocultar lo que ya pasó') : t('Lo que ya pasó')}</button>
        {showPast && (
          <div className="flex flex-col gap-1.5 mt-2">
            {(past.data ?? []).length ? past.data!.map((e, k) => (
              <div key={k} className="t-small flex items-start gap-2">
                <span className="c3 num flex-none whitespace-nowrap" style={{ minWidth: 140 }}>{whenFull(e.at, now)}</span>
                {e.account && <Avatar id={e.account as any} size={18} />}
                <span className="c2">{e.title}{e.detail ? <span className="c3"> · {e.detail}</span> : null}</span>
              </div>
            )) : <span className="t-small c3">{past.loading ? t('Cargando…') : t('Nada en los últimos 7 días.')}</span>}
          </div>
        )}
      </div>
      {rules.dialog}
    </section>
  )
}

/**
 * Where a backup account is now. Working in its project, that is what is said (13-11: «Ahora no le toca» while Claude 5
 * worked in the video project with two windows); otherwise whether it is its turn and why.
 */
export function reserveNow(r: { account: string; projectId: string; open: boolean; why: string }, agents: AgentCard[]): string {
  const a = agents.find((x) => x.id === r.account)
  const here = a?.sessions.filter((s) => s.projectId === r.projectId && s.pid && s.kind !== 'background').length ?? 0
  if (a?.state === 'trabajando' && here) return t('Ahora está trabajando allí ({here} {v0}).', { here: here, v0: here === 1 ? t('ventana') : t('ventanas') })
  return t('Ahora {v0}: {why}.', { v0: r.open ? t('le toca') : t('no le toca'), why: r.why })
}

/**
 * «Relevos» (the user, 12-11 at 23:40): a wheel per project, chosen by the user, that hands the turn from one account to
 * the next when it runs out (Claude 3 → Claude 1 → Claude 6 → back to Claude 3), and the accounts with their names and
 * their usage. Everything is visible and set with buttons: no menus to open.
 */
export function Relays() {
  const { state, now, go } = useStore()
  const wheels = useAsync(() => api<WheelData>('chains'), [Math.floor(now / 15_000), JSON.stringify(state?.settings.relayChains ?? {}), state?.refreshedAt?.agents])
  const reserves = useAsync(() => api<{ account: string; projectId: string; on: boolean; open: boolean; why: string }[]>('reserveState'), [Math.floor(now / 30_000), state?.refreshedAt?.agents])
  if (!state) return null
  const all = wheels.data ?? {}
  const projects = [...state.projects].sort((a, b) => Number(Boolean(all[b.id]?.chain.on)) - Number(Boolean(all[a.id]?.chain.on)) || Number(b.id === state.activeProjectId) - Number(a.id === state.activeProjectId))
  return (
    <div className="content-inner max-w-[1320px]">
      <h1 className="t-display flex items-center gap-3"><span className="icon-sq icon-sq-lg" style={{ background: 'var(--green)' }}><Repeat size={17} /></span>{t('Relevos')}</h1>
      <div className="t-head c2 mt-2 mb-6" style={{ fontWeight: 450 }}>{t('Una rueda por proyecto: trabaja una cuenta y, cuando se queda sin uso, sigue la siguiente que tenga uso, exactamente donde lo dejó. Así, en rueda, hasta cerrar lo pendiente.')}</div>
      {/* IV1 and EV166: the backup accounts of the dead time, set here (they are part of «who goes on»). */}
      <DeadTime live={reserves.data} />

      <WorkModeCard />
      <div className="flex flex-col gap-5 mb-8">
        {projects.map((p) => <WheelCard key={p.id} pid={p.id} data={all[p.id]} others={all} reload={wheels.reload} />)}
      </div>

      <button className="card p-4 w-full text-left border-0 flex items-center gap-3" onClick={() => go('agentes')}>
        <span className="flex -space-x-2">{state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada').map((a) => <Avatar key={a.id} id={a.id} size={26} />)}</span>
        <span className="min-w-0 flex-1"><b className="t-body block">{t('Las cuentas')}</b><span className="t-small c3 block">{t('Su nombre, el uso que les queda, qué hace cada una y si se usan: en Cuentas.')}</span></span>
        <ChevronRight size={16} className="c3" />
      </button>
      <div className="t-small c3 mt-6">{t('Mission Control lleva la rueda mientras está abierta. Si cierras su ventana con una rueda encendida, sigue en la bandeja (junto al reloj); para cerrarla del todo, «Salir» en su icono.')}</div>
    </div>
  )
}
