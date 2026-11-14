import { useEffect, useMemo, useState } from 'react'
import { ScreenIcon } from '../components/Sidebar'
import { motion } from 'motion/react'
import { Lightbulb, Search, BadgeCheck, FileText, Columns3, List, Music, Clapperboard, Hourglass } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type Task, type TaskStatus, type AccountId } from '../lib/api'
import { TaskLook } from '../components/TaskLook'
import { OnlyTask } from '../components/OnlyTask'
import { Segmented, Sheet, SheetHeader, SPRING, ACCOUNT_COLOR, Empty, PriorityBadge, PRIORITY, flashElement, accName } from '../components/ui'
import { ago, dateShort } from '../lib/format'

export const STATUS: { s: TaskStatus; label: string; color: string; always?: boolean }[] = [
  { s: 'idea', label: 'Ideas', color: 'var(--purple)' },
  { s: 'pendiente', label: 'Por hacer', color: 'var(--gray)', always: true },
  { s: 'planificada', label: 'Planificada', color: 'var(--teal)' },
  { s: 'en-desarrollo', label: 'En curso', color: 'var(--accent)', always: true },
  { s: 'bloqueada', label: 'Bloqueada', color: 'var(--red)' },
  { s: 'pendiente-integracion', label: 'Pendiente de integración', color: 'var(--orange)' },
  { s: 'en-pruebas', label: 'En pruebas', color: 'var(--yellow)' },
  { s: 'revision', label: 'Para revisar', color: 'var(--orange)', always: true },
  { s: 'terminada', label: 'Hecho', color: 'var(--green)', always: true }
]

/**
 * Not states of the task but of the review: the user looked at it and asked for changes (it stays there until they are
 * done), or looked at it and took it as good. What the user has accepted leaves «Hecho», so that «Hecho» is only what
 * still waits for their look (the user, 11-11: «los que he dado por buenos, o que desaparezcan o que haya otra pestaña»).
 */
type Column = TaskStatus | 'cambios' | 'aceptada'
const COLUMNS: { s: Column; label: string; color: string; always?: boolean }[] = [
  ...STATUS.filter((x) => x.s !== 'terminada'),
  { s: 'cambios', label: 'Con cambios pedidos', color: 'var(--indigo)' },
  ...STATUS.filter((x) => x.s === 'terminada'),
  { s: 'aceptada', label: 'Aceptadas', color: 'var(--teal)' }
]
const META = Object.fromEntries(COLUMNS.map((x) => [x.s, x])) as Record<Column, (typeof COLUMNS)[number]>

/** What the text says happened to a task beyond its checkbox: superseded by another, or not approved by the user. */
export function verdict(t: Task): { label: string; color: string } | undefined {
  // Proof goes before anybody's word: checks that fail are said first, whatever the text claims.
  if (t.checks?.outcome === 'falla' && !t.verified) return { label: 'Fallan las pruebas', color: 'var(--red)' }
  if (t.change) return { label: 'Cambios pedidos', color: 'var(--indigo)' }
  const text = `${t.title} ${t.detail}`
  // The user has already looked at it: what the text still says about waiting for that no longer counts.
  if (t.verified) return undefined
  if (t.changeDone) return { label: 'Cambios hechos', color: 'var(--green)' }
  const sup = text.match(/superad[oa]s? por ([A-Z]{1,4}\d+[a-z]?)/i)
  if (sup) return { label: `Sustituida por ${sup[1].toUpperCase()}`, color: 'var(--gray)' }
  if (/no aprobad[oa]/i.test(text)) return { label: 'No aprobada por ti', color: 'var(--red)' }
  if (/a falta de que lo vea|pendiente de que lo vea|falta que (?:el usuario )?lo vea/i.test(text)) return { label: 'Esperando que la veas', color: 'var(--orange)' }
  if (t.checks?.outcome === 'bien') return { label: 'Pasa las pruebas', color: 'var(--green)' }
  // EV65 (Claude's weak point: marking done without checking): finished lately with no checks run and nothing shown to
  // the user is said as such, so the next account checks it instead of trusting the box.
  if (t.status === 'terminada' && !t.waitingLook && !t.checks && Date.now() - t.updatedAt < 7 * 86400_000) return { label: 'Hecha sin comprobar', color: 'var(--yellow)' }
  return undefined
}

/**
 * What a blocked task waits for, from its newest note («*Bloqueada (13-11, claude1): espera a que el usuario encienda…*»),
 * and whether that is something of the user's. 13-11, the user: «¿por qué hay algunas tareas bloqueadas en tareas?»: the
 * column said only «Bloqueada» and each card had to be opened to know.
 */
export function waitingOn(t: Task): { text: string; yours: boolean } | undefined {
  // What the app keeps has the notes without their asterisks: up to the end of the note's first sentence.
  const m = /\*?\bBloquead[ao] \([^)]*\):\s*(.+?)(?:\.(?=\s|\*|$)|\*|$)/i.exec(`${t.title} ${t.detail ?? ''}`)
  if (!m) return undefined
  const text = m[1].trim().replace(/\.$/, '')
  const yours = /\bel usuario\b/i.test(text)
  // Said to him: «espera a que el usuario encienda…» → «que enciendas…», «dé la orden» → «des la orden», «lo pida» → «lo pidas».
  const said = yours ? text.replace(/^espera a /i, '').replace(/que el usuario ((?:lo|la|le|los|las|se|nos) )?([a-záéíóúñ]+)/i, (_, cl: string | undefined, v: string) => `que ${cl ?? ''}${v.endsWith('é') ? v.slice(0, -1) + 'es' : v + 's'}`).replace(/\bsu madre\b/g, 'tu madre') : text
  return { text: said[0].toUpperCase() + said.slice(1), yours }
}

/** The task in one plain line: its bold name without the notes in italics and brackets. */
export function plain(t: Task): string {
  // A bold note about how it went («Decidido por el usuario») is not the task's name.
  const bold = [...`${t.title} ${t.detail}`.matchAll(/\*\*([^*]{6,160})\*\*/g)].map((m) => m[1]).find((b) => !/^(decidid|aprobad|hech|pedid|plan hecho|vist|superad)/i.test(b))
  const base = (bold ?? t.title).replace(/\*[^*]*\*/g, '').replace(/\([^)]*\)/g, '').replace(/^[\s`).*:·-]+/, '').replace(/[\s:]+$/, '').replace(/\s+/g, ' ').trim()
  return base.length > 150 ? base.slice(0, 149) + '…' : base
}

interface Claim { taskKey: string; account: AccountId; expiresAt: number; claimedAt: number; abandoned: boolean; note?: string }

interface Cover { thumb?: string; audio?: boolean; video?: boolean; card?: boolean }

function TaskCard({ t, onOpen, claim, cover, givenTo }: { t: Task; onOpen: () => void; claim?: Claim; cover?: Cover; givenTo?: AccountId }) {
  return (
    <motion.div
      id={`task-${t.id}`}
      layout="position"
      transition={SPRING}
      className="task-card flex-none min-w-0 overflow-hidden"
      draggable
      onDragStart={(e) => { (e as unknown as DragEvent).dataTransfer?.setData('text/task', String(t.id)) }}
      onClick={onOpen}
    >
      {cover?.thumb && <img src={cover.thumb} alt="" loading="lazy" className="w-full rounded-lg object-cover mb-2" style={{ height: 92, background: 'var(--fill)' }} />}
      <div className="flex items-center gap-2 t-small">
        {t.extId && <b className="num c2">{t.extId}</b>}
        <PriorityBadge p={t.priority} withLabel={t.priority === 0} />
        {verdict(t) && <span className="pill" style={{ background: `color-mix(in srgb, ${verdict(t)!.color} 15%, transparent)`, color: verdict(t)!.color }}>{verdict(t)!.label}</span>}
        {t.owner && <span className="ml-auto icon-sq num" style={{ width: 18, height: 18, borderRadius: 5, fontSize: 10.5, fontWeight: 700, background: ACCOUNT_COLOR[t.owner] }} title={`${accName(t.owner)}`}>{t.owner.slice(6)}</span>}
        {t.verified ? <BadgeCheck size={14} className={t.owner ? '' : 'ml-auto'} style={{ color: 'var(--green)' }} /> : t.fileStatus && t.fileStatus !== t.status ? <span className={`${t.owner ? '' : 'ml-auto '}t-small c3`}>movida</span> : null}
      </div>
      <div className="t-body mt-1 clamp-3" style={{ fontWeight: 540 }}>{plain(t)}</div>
      {t.status === 'bloqueada' && waitingOn(t) && (
        <div className="t-small mt-1.5 rounded-lg px-2 py-1.5 flex gap-1.5 items-start" style={{ background: `color-mix(in srgb, ${waitingOn(t)!.yours ? 'var(--orange)' : 'var(--fill-2)'} 16%, transparent)` }}>
          <Hourglass size={13} className="flex-none mt-0.5" style={{ color: waitingOn(t)!.yours ? 'var(--orange)' : 'var(--label-3)' }} />
          <span className="clamp-4 c2">{waitingOn(t)!.yours && <b style={{ color: 'var(--orange)' }}>Te espera a ti: </b>}{waitingOn(t)!.yours ? waitingOn(t)!.text.replace(/^./, (c) => c.toLowerCase()) : waitingOn(t)!.text}</span>
        </div>
      )}
      {/* What its line in TASKS.md says about it (EV8): what it waits for, what it needs, the model that is enough. */}
      {t.status !== 'terminada' && (t.waitsFor?.length || t.needs?.length || t.model) ? (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {t.waitsFor?.length ? <span className="pill" style={{ background: 'color-mix(in srgb, var(--orange) 15%, transparent)', color: 'var(--orange)' }} title="No se empieza hasta que estén hechas">espera a {t.waitsFor.slice(0, 3).join(', ')}</span> : null}
          {(t.needs ?? []).map((n) => <span key={n} className="pill" style={{ background: 'var(--fill)', color: 'var(--label-2)' }} title="Recurso que no se comparte: va por turnos">{n === 'gpu' ? 'gráfica' : n === 'unity' ? 'Unity' : n}</span>)}
          {t.model && <span className="pill" style={{ background: 'var(--fill)', color: 'var(--label-3)' }} title="El modelo que basta para hacerla">{t.model.replace(/\b\w/g, (c) => c.toUpperCase()).replace(' U ', ' u ')}</span>}
        </div>
      ) : null}
      {t.change && (
        <div className="t-small mt-1.5 rounded-lg px-2 py-1" style={{ background: 'color-mix(in srgb, var(--indigo) 14%, transparent)' }}>
          <div className="clamp-3 c2">«{t.change.note}»</div>
          <div className="c3 mt-0.5">{t.change.readAt ? 'Leída por' : 'Para'} {t.change.target ? `${accName(t.change.target)}` : 'el primero que trabaje'}</div>
        </div>
      )}
      {(cover?.audio || cover?.video) && (
        <div className="t-small c3 mt-1 flex items-center gap-2">
          {cover.audio && <span className="flex items-center gap-1"><Music size={12} /> Con sonido</span>}
          {cover.video && <span className="flex items-center gap-1"><Clapperboard size={12} /> Con vídeo</span>}
        </div>
      )}
      {t.change ? null : givenTo && t.status !== 'terminada' ? (
        <div className="t-small mt-1.5 flex items-center gap-1.5" style={{ color: ACCOUNT_COLOR[givenTo] }}>
          <span className="dot" style={{ background: 'currentColor' }} />
          Encargada a {accName(givenTo)}
        </div>
      ) : claim && t.status !== 'terminada' && (
        <div className="t-small mt-1.5 flex items-center gap-1.5" style={{ color: claim.abandoned ? 'var(--orange)' : ACCOUNT_COLOR[claim.account] }}>
          <span className="dot" style={{ background: 'currentColor' }} />
          {claim.abandoned ? `Abandonada por ${accName(claim.account)}` : `La tiene ${accName(claim.account)}`}
        </div>
      )}
    </motion.div>
  )
}

export function Tasks() {
  const { state, openComposer, toast, focus, clearFocus } = useStore()
  const pid = state?.activeProjectId
  const coversQ = useAsync(() => (pid ? api<Record<number, Cover>>('taskCovers', pid) : Promise.resolve({} as Record<number, Cover>)), [pid, state?.refreshedAt?.docs])
  const givenQ = useAsync(() => (pid ? api<{ from: AccountId; to: AccountId }[]>('assignments', pid) : Promise.resolve([])), [pid, state?.refreshedAt?.docs])
  const given = useMemo(() => new Map((givenQ.data ?? []).map((g) => [g.from, g.to])), [givenQ.data])
  const [view, setView] = useState<'kanban' | 'lista'>('kanban')
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState<AccountId | 'all'>('all')
  const [openId, setOpenId] = useState<number>()
  const [more, setMore] = useState<Record<string, number>>({})
  const [over, setOver] = useState<string>()
  const data = useAsync(() => (pid ? api<Task[]>('tasks', pid) : Promise.resolve([])), [pid, state?.refreshedAt?.docs, state?.summary?.tasks.done])
  const claimsQ = useAsync(() => (pid ? api<Claim[]>('claims', pid) : Promise.resolve([])), [pid, state?.now])
  const claims = useMemo(() => new Map((claimsQ.data ?? []).map((c) => [c.taskKey, c])), [claimsQ.data])
  const [local, setLocal] = useState<Task[]>()
  const tasks = local ?? data.data ?? []
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return tasks.filter((t) => (owner === 'all' || t.owner === owner) && (!s || `${t.extId ?? ''} ${t.title} ${t.detail} ${t.section}`.toLowerCase().includes(s)))
  }, [tasks, q, owner])
  // What a Claude finished but says the user still has to look at is waiting for the user, not done.
  const columnOf = (t: Task): Column => (t.change ? 'cambios' : t.waitingLook && !t.verified ? 'revision' : t.status === 'terminada' && t.verified ? 'aceptada' : t.status)
  const cols = COLUMNS.filter((c) => c.always || filtered.some((t) => columnOf(t) === c.s))
  const open = tasks.find((t) => t.id === openId)

  // Arriving from a search: show it (whatever the filters), scroll to it and make it glow.
  useEffect(() => {
    if (focus?.kind !== 'task' || !data.data) return
    setOwner('all')
    if (focus.id < 0) { setQ(focus.q ?? ''); clearFocus(); return }
    setQ('')
    const t = tasks.find((x) => x.id === focus.id)
    if (t) setMore((m) => ({ ...m, [t.status]: 100000 }))
    flashElement(view === 'kanban' ? `task-${focus.id}` : `trow-${focus.id}`)
    clearFocus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, data.data])

  const setPriority = async (id: number, p: number) => {
    if (!pid) return
    try {
      setLocal(await api<Task[]>('setTaskPriority', pid, id, p))
      toast(p <= 1 ? `Prioridad ${PRIORITY[p].label.toLowerCase()}: los Claude la harán antes que lo demás` : `Prioridad ${PRIORITY[p].label.toLowerCase()}`)
    } catch (e) { toast((e as Error).message) }
  }

  const reloadTasks = async () => { if (pid) setLocal(await api<Task[]>('tasks', pid)) }
  // What comes from the files is newer than what was kept from the last move.
  useEffect(() => setLocal(undefined), [data.data])

  const move = async (id: number, status: TaskStatus, verified?: boolean) => {
    if (!pid) return
    if (tasks.find((t) => t.id === id)?.change) { toast('Tiene una nota tuya abierta: quítala o espera a que esté hecha'); return }
    try {
      const next = await api<Task[]>('setTaskStatus', pid, id, status, verified)
      setLocal(next)
      toast(verified ? 'Aceptada: pasa a «Aceptadas»' : verified === false ? 'Ya no está aceptada: vuelve a «Hecho»' : `Movida a «${META[status].label}»`)
    } catch (e) { toast((e as Error).message) }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-[clamp(18px,2.6vw,40px)] pt-6 pb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="t-display flex items-center gap-3"><ScreenIcon route="tareas" />Tareas</h1>
          <div className="t-head c2 mt-1.5" style={{ fontWeight: 450 }}>Arrastra para cambiar el estado. Pulsa una tarea para ver el detalle.</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 c3" />
            <input className="field pl-8 w-56" placeholder="Buscar tareas" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented value={view} onChange={setView} options={[{ value: 'kanban', label: <span className="flex items-center gap-1.5"><Columns3 size={13} />Tablero</span> }, { value: 'lista', label: <span className="flex items-center gap-1.5"><List size={13} />Lista</span> }]} />
          <button className="btn btn-primary" onClick={() => openComposer({ kind: 'idea' })}><Lightbulb size={15} /> Nueva idea</button>
        </div>
      </div>
      <div className="px-[clamp(18px,2.6vw,40px)] pb-3 flex flex-wrap gap-1.5">
        <button className={`chip ${owner === 'all' ? 'on' : ''}`} onClick={() => setOwner('all')}>Todas · {tasks.length}</button>
        {/* EV114: accounts «De baja» or «No usar» with nothing open are not offered as a filter (they were «Claude 2 · 0»). */}
        {(state?.agents ?? []).filter((x) => (x.state !== 'baja' && x.state !== 'apartada') || tasks.some((t) => t.owner === x.id && t.status !== 'terminada')).map((x) => x.id).map((a) => {
          const n = tasks.filter((t) => t.owner === a && t.status !== 'terminada').length
          return (
            <button key={a} className={`chip ${owner === a ? 'on' : ''}`} onClick={() => setOwner(owner === a ? 'all' : a)}>
              <span className="dot" style={{ background: ACCOUNT_COLOR[a] }} /> {accName(a)} · {n}
            </button>
          )
        })}
      </div>

      {view === 'kanban' ? (
        <div className="flex-1 min-h-0 overflow-x-auto px-[clamp(18px,2.6vw,40px)] pb-6">
          <div className="flex gap-3 h-full">
            {cols.map((c) => {
              const list = filtered.filter((t) => columnOf(t) === c.s)
              if (c.s === 'terminada' || c.s === 'aceptada') list.sort((x, y) => y.updatedAt - x.updatedAt)
              else list.sort((x, y) => x.priority - y.priority)
              const limit = more[c.s] ?? (c.s === 'terminada' || c.s === 'aceptada' ? 30 : 80)
              return (
                <div
                  key={c.s}
                  className="kanban-col min-w-0"
                  style={{ flex: '1 1 0', minWidth: 210, maxWidth: 640, ...(over === c.s ? { boxShadow: `inset 0 0 0 2px ${c.color}` } : {}) }}
                  onDragOver={(e) => { e.preventDefault(); setOver(c.s) }}
                  onDragLeave={() => setOver(undefined)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setOver(undefined)
                    const id = Number(e.dataTransfer.getData('text/task'))
                    // A note cannot be dropped: dropping here opens the task, to write it.
                    if (id && c.s === 'cambios') setOpenId(id)
                    // Into «Aceptadas»: taken as good. Back to «Hecho»: no longer taken as good.
                    else if (id && c.s === 'aceptada') void move(id, 'terminada', true)
                    else if (id && c.s === 'terminada' && tasks.find((t) => t.id === id)?.verified) void move(id, 'terminada', false)
                    else if (id) void move(id, c.s as TaskStatus)
                  }}
                >
                  <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
                    <span className="dot" style={{ background: c.color }} />
                    <span className="t-small" style={{ fontWeight: 620 }}>{c.label}</span>
                    <span className="t-small c3 num ml-auto">{list.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                    {list.slice(0, limit).map((t) => <TaskCard key={t.id} t={t} claim={claims.get(t.key)} givenTo={t.owner ? given.get(t.owner) : undefined} cover={c.s === 'terminada' || c.s === 'aceptada' || c.s === 'revision' || c.s === 'cambios' ? coversQ.data?.[t.id] : undefined} onOpen={() => setOpenId(t.id)} />)}
                    {list.length > limit && <button className="btn btn-sm btn-ghost" onClick={() => setMore({ ...more, [c.s]: limit + 60 })}>Mostrar {Math.min(60, list.length - limit)} más</button>}
                    {list.length === 0 && <div className="t-small c4 text-center py-6">Arrastra aquí</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-[clamp(18px,2.6vw,40px)] pb-6">
          <div className="card p-1.5">
            {filtered.length === 0 && <Empty title="Sin tareas" text="Prueba con otra búsqueda." />}
            {[...filtered].sort((x, y) => x.priority - y.priority).slice(0, 400).map((t) => (
              <button key={t.id} id={`trow-${t.id}`} className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border-0 bg-transparent hover:bg-[var(--fill)]" onClick={() => setOpenId(t.id)}>
                <span className="dot" style={{ background: META[t.status].color }} />
                <b className="t-small num c2 w-16 flex-none">{t.extId ?? '—'}</b>
                <PriorityBadge p={t.priority} withLabel />
                <span className="t-body truncate flex-1">{t.title}</span>
                <span className="t-small c3 truncate max-w-[30%]">{t.section}</span>
                <span className="t-small c3 w-36 text-right flex-none">{META[t.status].label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Sheet open={Boolean(open)} onClose={() => setOpenId(undefined)}>
        {open && (
          <>
            <SheetHeader onClose={() => setOpenId(undefined)}>
              <div className="flex items-center gap-2 t-small c3">
                {open.extId && <b className="num c2">{open.extId}</b>}
                <span className="pill" style={{ background: `color-mix(in srgb, ${META[columnOf(open)].color} 15%, transparent)`, color: META[columnOf(open)].color }}>{META[columnOf(open)].label}</span>
                {open.verified && <span className="pill" style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)', color: 'var(--green)' }}><BadgeCheck size={12} /> Verificada por ti</span>}
              </div>
              {verdict(open) && !open.change && <div className="mt-2"><span className="pill" style={{ background: `color-mix(in srgb, ${verdict(open)!.color} 15%, transparent)`, color: verdict(open)!.color }}>{verdict(open)!.label}</span></div>}
              <div className="t-title mt-2 selectable">{plain(open)}</div>
              {(open.waitsFor || open.unblocks || open.model || open.needs || open.checks) && (
                <div className="mt-2 flex flex-col gap-1 t-small c2">
                  {open.waitsFor && <div><b style={{ color: 'var(--orange)' }}>Espera a:</b> {open.waitsFor.join(', ')} <span className="c3">· no se ofrece a nadie hasta que estén hechas</span></div>}
                  {open.unblocks && <div><b style={{ color: 'var(--indigo)' }}>Desbloquea:</b> {open.unblocks.join(', ')}</div>}
                  {(open.model || open.needs) && <div>{open.model && <><b>Basta con:</b> {open.model}</>}{open.model && open.needs ? ' · ' : ''}{open.needs && <><b>Necesita:</b> {open.needs.join(', ')} <span className="c3">(uno a la vez)</span></>}</div>}
                  {open.checks && <div><b style={{ color: open.checks.outcome === 'bien' ? 'var(--green)' : 'var(--red)' }}>{open.checks.outcome === 'bien' ? 'Pasa las pruebas' : 'Fallan las pruebas'}</b> <span className="c3">({new Date(open.checks.at).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })})</span> · {open.checks.summary}</div>}
                </div>
              )}
            </SheetHeader>
            <div className="flex-1 overflow-auto px-5 py-5 flex flex-col gap-5">
              <TaskLook t={open} onChanged={() => void reloadTasks()} onApproved={() => { setOpenId(undefined); void reloadTasks() }} />
              {open.verified && <div><button className="btn btn-sm" onClick={() => move(open.id, open.status, false)}>Quitar el visto bueno</button></div>}
              <OnlyTask t={open} />
              <div>
                <div className="t-micro c3 mb-2">Prioridad</div>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITY.map((p) => (
                    <button key={p.v} className={`chip ${open.priority === p.v ? 'on' : ''}`} onClick={() => setPriority(open.id, p.v)}>
                      <span className="dot" style={{ background: p.color }} /> {p.label}
                    </button>
                  ))}
                </div>
                <div className="t-small c3 mt-1.5">Urgente y alta van antes que todo: cada Claude las ve al empezar y el primero que esté trabajando la recoge.</div>
              </div>
              <div>
                <div className="t-micro c3 mb-2">Mover a</div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS.map((c) => (
                    <button key={c.s} className={`chip ${open.status === c.s ? 'on' : ''}`} onClick={() => move(open.id, c.s)}>
                      <span className="dot" style={{ background: c.color }} /> {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <details className="t-small c2">
                <summary className="t-micro c3 cursor-pointer mb-2 select-none">Detalle técnico</summary>
                <div className="flex flex-col gap-3">
                  {open.section && <div><div className="t-micro c3">Sección de la lista</div><div className="mt-0.5">{open.section}</div></div>}
              <div className="grid grid-cols-2 gap-3 t-small">
                <div><div className="t-micro c3">Responsable</div><div className="mt-0.5">{open.owner ? `${accName(open.owner)} (según TASKS.md)` : 'Sin asignar'}</div></div>
                <div><div className="t-micro c3">Origen</div><div className="mt-0.5">{open.source === 'app' ? 'Creada en Mission Control' : `TASKS.md, línea ${open.sourceLine}`}</div></div>
                <div><div className="t-micro c3">Casilla en el archivo</div><div className="mt-0.5">{open.mark === 'x' ? '[x] hecha según el agente' : open.mark === '~' ? '[~] a medias' : open.mark === ' ' ? '[ ] sin empezar' : '—'}</div></div>
                <div><div className="t-micro c3">Último cambio visto</div><div className="mt-0.5">{ago(open.updatedAt)} · desde {dateShort(open.createdAt)}</div></div>
                <div className="col-span-2"><div className="t-micro c3">Reserva</div><div className="mt-0.5">{(() => {
                  const c = claims.get(open.key)
                  if (!c) return 'Nadie la tiene reservada ahora'
                  if (open.owner && given.get(open.owner)) return `Encargada por ti a Claude ${given.get(open.owner)!.slice(6)}`
                  if (c.abandoned) return <span style={{ color: 'var(--orange)' }}>{accName(c.account)} la reservó y su reserva caducó sin terminarla: puede recogerla otra cuenta</span>
                  return `La tiene ${accName(c.account)} desde ${dateShort(c.claimedAt)}, reserva viva hasta ${new Date(c.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${c.note ? ` · ${c.note}` : ''}`
                })()}</div></div>
              </div>
                  {open.detail && <div className="whitespace-pre-wrap selectable leading-relaxed">{open.title}{'\n\n' + open.detail}</div>}
                  {open.sourceFile && <div><button className="btn btn-sm" onClick={() => api('openPath', open.sourceFile)}><FileText size={14} /> Abrir TASKS.md</button></div>}
                </div>
              </details>
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}
