import { t, tn } from '../../../core/i18n'
import { useMemo, useState } from 'react'
import { ScreenIcon } from '../components/Sidebar'
import { motion, AnimatePresence } from 'motion/react'
import { GitCommitHorizontal, Handshake, MessageCircle, Image as ImageIcon, CircleCheck, Hourglass, PenLine, ListPlus, Inbox } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, thumbUrl, type TimelineEvent, type AccountId } from '../lib/api'
import { Segmented, SPRING, Empty, ACCOUNT_COLOR, accName, nameify } from '../components/ui'
import { clock, dayLabel, plural } from '../lib/format'

const FILTERS: { key: string; label: string; kinds: string[] }[] = [
  { key: 'trabajo', get label() { return t('Trabajo') }, kinds: ['commit', 'relevo', 'relevo-app', 'reserva', 'tarea-hecha', 'tarea-hecha-fecha', 'tarea-cambio', 'tarea-nueva', 'tarea-movida', 'tarea-verificada', 'entrega'] },
  { key: 'sesiones', get label() { return t('Sesiones y archivos') }, kinds: ['sesion', 'compacta', 'archivo'] },
  { key: 'tu', get label() { return t('Lo tuyo') }, kinds: ['peticion', 'instruccion', 'comentario', 'idea', 'entrega', 'recibida', 'comentario-estado'] },
  { key: 'limite', get label() { return t('Límites de uso') }, kinds: ['limite'] },
  // EV55: what the dispatcher did or did not do («Relevo no hecho: ya tiene su ventana en…») and what the app ran by itself.
  { key: 'relevos', get label() { return t('Relevos y ventanas') }, kinds: ['relevo', 'relevo-app', 'limite'] },
  { key: 'rutinas', get label() { return t('Rutinas y avisos') }, kinds: ['rutina', 'aviso'] }
]

function kindMeta(e: TimelineEvent): { color: string; Icon: typeof PenLine; label: string } {
  if (e.kind === 'commit') return { color: 'var(--orange)', Icon: GitCommitHorizontal, label: t('Cambio guardado') }
  if (e.kind === 'relevo') return { color: 'var(--purple)', Icon: Handshake, label: t('Relevo') }
  if (e.kind === 'peticion') return { color: 'var(--blue)', Icon: MessageCircle, label: t('Le pediste') }
  if (e.kind === 'media') return { color: 'var(--pink)', Icon: ImageIcon, label: t('Imágenes') }
  if (e.kind.startsWith('tarea-hecha') || e.kind === 'tarea-verificada') return { color: 'var(--green)', Icon: CircleCheck, label: t('Tarea hecha') }
  if (e.kind === 'entrega') return { color: 'var(--pink)', Icon: CircleCheck, label: t('Entrega para que la mires') }
  if (e.kind === 'limite') return { color: 'var(--red)', Icon: Hourglass, label: t('Sin uso') }
  if (e.kind === 'tarea-cambio' || e.kind === 'tarea-movida') return { color: 'var(--blue)', Icon: PenLine, label: t('Tarea') }
  if (e.kind === 'reserva') return { color: 'var(--indigo)', Icon: ListPlus, label: t('Reserva') }
  if (e.kind === 'relevo-app') return { color: 'var(--purple)', Icon: Handshake, label: t('Relevo preparado') }
  if (e.kind === 'sesion') return { color: 'var(--teal)', Icon: MessageCircle, label: t('Sesión') }
  if (e.kind === 'compacta') return { color: 'var(--gray)', Icon: Inbox, label: t('Compactó') }
  if (e.kind === 'archivo') return { color: 'var(--gray)', Icon: PenLine, label: t('Archivo') }
  if (e.kind === 'idea' || e.kind === 'tarea-nueva') return { color: 'var(--purple)', Icon: ListPlus, label: t('Nueva') }
  if (e.kind === 'recibida' || e.kind === 'entrega') return { color: 'var(--teal)', Icon: Inbox, label: t('Entrega') }
  if (e.kind === 'rutina') return { color: 'var(--green)', Icon: CircleCheck, label: t('Rutina') }
  if (e.kind === 'aviso') return { color: 'var(--orange)', Icon: Hourglass, label: t('Aviso') }
  return { color: 'var(--gray)', Icon: PenLine, label: t('Tú') }
}

export function EventIcon({ e }: { e: TimelineEvent }) {
  const { color, Icon } = kindMeta(e)
  return <span className="icon-sq icon-sq-lg" style={{ background: color }}><Icon size={16} /></span>
}

/** "C1a/C1c: la chaqueta ..." -> ids apart, words capitalised. */
export function humanTitle(e: TimelineEvent): { ids?: string; text: string } {
  const m = e.title.match(/^([A-Z][A-Za-z0-9]{0,6}(?:[/,] ?[A-Z][A-Za-z0-9]{0,6})*):\s+(.*)$/)
  const text = nameify((m ? m[2] : e.title).trim())
  return { ids: m?.[1], text: text ? text[0].toUpperCase() + text.slice(1) : text }
}

export function Timeline() {
  const { state, now, setViewer } = useStore()
  const pid = state?.activeProjectId
  const [range, setRange] = useState<'1' | '7' | '30'>('7')
  const [agent, setAgent] = useState<AccountId | 'all'>('all')
  const [filter, setFilter] = useState<string>('')
  const [open, setOpen] = useState<number>()
  const [allPics, setAllPics] = useState<number>()
  const from = useMemo(() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime() - (Number(range) - 1) * 86400_000
  }, [range, now])
  const data = useAsync(() => (pid ? api<TimelineEvent[]>('timeline', pid, from, Date.now()) : Promise.resolve([])), [pid, from, state?.refreshedAt?.docs, state?.refreshedAt?.git])

  const days = useMemo(() => {
    const out = new Map<string, { at: number; events: TimelineEvent[]; images: number[]; media: number }>()
    // EV114: a «pmc guarda» left two lines with the same words (its heartbeat, and its commit «Punto de control (cuenta): …»):
    // the commit goes when its heartbeat is there.
    const beats = new Set((data.data ?? []).filter((e) => e.kind === 'relevo').map((e) => e.title.slice(0, 60)))
    const rutinaSeen = new Set<string>()
    for (const e of data.data ?? []) {
      if (e.kind === 'commit' && beats.has(e.title.replace(/^Punto de control \([^)]*\): /, '').slice(0, 60))) continue
      // Files a Claude writes outside the project (its scratchpad, Temp) are not the project's history.
      if (e.kind === 'archivo' && /\\Temp\\|\/Temp\/|scratchpad/i.test(e.title + ' ' + (e.detail ?? ''))) continue
      // The routine after each commit says the same when all passes: once a day is enough (the newest).
      if (e.kind === 'rutina' && /pasa sus comprobaciones/.test(e.title)) { const k = new Date(e.at).toDateString(); if (rutinaSeen.has(k)) continue; rutinaSeen.add(k) }
      if (agent !== 'all' && e.account !== agent && e.kind !== 'media') continue
      const k = new Date(e.at).toDateString()
      if (!out.has(k)) out.set(k, { at: e.at, events: [], images: [], media: 0 })
      const d = out.get(k)!
      if (e.kind === 'media') {
        d.media += Number(e.title.match(/^(\d+)/)?.[1]) || 1
        if (/imagen|imágenes/.test(e.title) && e.ref) d.images.push(...e.ref.split(',').map(Number))
        continue
      }
      if (filter && !FILTERS.find((f) => f.key === filter)!.kinds.includes(e.kind)) continue
      d.events.push(e)
    }
    return [...out.values()]
  }, [data.data, agent, filter])

  return (
    <div className="content-inner max-w-[1180px]">
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <h1 className="t-display flex items-center gap-3"><ScreenIcon route="cronologia" />{t('Cronología')}</h1>
          <div className="t-head c2 mt-1.5" style={{ fontWeight: 450 }}>{t('Qué ha pasado en el proyecto, día a día.')}</div>
        </div>
        <div className="ml-auto"><Segmented value={range} onChange={setRange} options={[{ value: '1', label: t('Hoy') }, { value: '7', label: t('7 días') }, { value: '30', label: t('30 días') }]} /></div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-7">
        <button className={`chip ${!filter && agent === 'all' ? 'on' : ''}`} onClick={() => { setFilter(''); setAgent('all') }}>{t('Todo')}</button>
        {FILTERS.map((f) => <button key={f.key} className={`chip ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(filter === f.key ? '' : f.key)}>{f.label}</button>)}
        <span className="w-px mx-1" style={{ background: 'var(--sep)' }} />
        {(state?.agents ?? []).filter((x) => x.state !== 'baja' && x.state !== 'apartada' || (data.data ?? []).some((e) => e.account === x.id)).map((x) => x.id).map((a) => (
          <button key={a} className={`chip ${agent === a ? 'on' : ''}`} onClick={() => setAgent(agent === a ? 'all' : a)}>
            <span className="dot" style={{ background: ACCOUNT_COLOR[a] }} /> {accName(a)}
          </button>
        ))}
      </div>
      {data.loading && !data.data && <div className="skeleton h-48 rounded-2xl" />}
      {data.data && days.length === 0 && <Empty title={t('Nada en este periodo')} text={t('Prueba con más días o quita los filtros.')} />}
      {days.map((d) => {
        const done = d.events.filter((e) => e.kind.startsWith('tarea-hecha')).length
        const commits = d.events.filter((e) => e.kind === 'commit').length
        const summary = [done && tn(done, '{n} tarea hecha', '{n} tareas hechas'), commits && tn(commits, '{n} cambio guardado', '{n} cambios guardados'), d.media && tn(d.media, '{n} imagen o vídeo nuevo', '{n} imágenes y vídeos nuevos')].filter(Boolean).join(' · ')
        return (
          <section key={d.at} className="mb-10">
            <div className="sticky top-0 z-10 pt-2 pb-3 -mx-3 px-3" style={{ background: 'linear-gradient(var(--bg) 75%, transparent)' }}>
              <h2 className="t-title">{dayLabel(d.at, now)}</h2>
              <div className="t-small c3 mt-0.5">{summary || t('Sin cambios registrados')}</div>
            </div>
            {d.images.length > 0 && (
              <div className={allPics === d.at ? 'grid gap-2 mb-3' : 'flex gap-2 mb-3 overflow-x-auto pb-1'} style={allPics === d.at ? { gridTemplateColumns: 'repeat(auto-fill, minmax(114px, 1fr))' } : undefined}>
                {(allPics === d.at ? d.images : d.images.slice(0, 14)).map((id) => (
                  <button key={id} className={`tile p-0 border-0 aspect-[4/3] ${allPics === d.at ? '' : 'flex-none h-[86px]'}`} onClick={() => setViewer(id, d.images)}><img src={thumbUrl(id, 240)} alt="" loading="lazy" /></button>
                ))}
                {d.images.length > 14 && (
                  <button className={`btn ${allPics === d.at ? '' : 'flex-none h-[86px] px-4'}`} onClick={() => setAllPics(allPics === d.at ? undefined : d.at)}>
                    {allPics === d.at ? t('Ver menos') : t('Ver las {length}', { length: d.images.length })}
                  </button>
                )}
              </div>
            )}
            {d.events.length > 0 && (
              <div className="group">
                {d.events.map((e) => {
                  const h = humanTitle(e)
                  const m = kindMeta(e)
                  const isOpen = open === e.id
                  return (
                    <div key={e.id}>
                      <button className="row" style={{ alignItems: 'flex-start' }} onClick={() => setOpen(isOpen ? undefined : e.id)} aria-expanded={isOpen}>
                        <EventIcon e={e} />
                        <span className="min-w-0 flex-1">
                          <span className={`t-body block ${isOpen ? '' : 'clamp-2'}`}>{e.kind === 'peticion' ? `«${h.text}»` : h.text}</span>
                          <span className="t-small c3 block mt-0.5">
                            {clock(e.at)} · {m.label}{e.account ? <> · <span style={{ color: ACCOUNT_COLOR[e.account] }}>{accName(e.account)}</span></> : null}{h.ids ? ` · ${h.ids}` : ''}
                          </span>
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
                            <div className="t-small c2 pl-[64px] pr-5 pb-4 whitespace-pre-wrap selectable">
                              {e.detail && e.detail !== e.title ? <div className="mb-2">{e.detail}</div> : null}
                              <span className="c3">{t('Origen: {source}{v0}', { source: e.source, v0: e.ref && e.kind !== 'media' ? ` · ${e.ref}` : '' })}</span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
