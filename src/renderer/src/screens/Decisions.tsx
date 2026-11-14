import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, ChevronDown, Undo2, Gavel, Send, ThumbsUp, ThumbsDown, Music } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, media, type Decision, type Task } from '../lib/api'
import { Avatar, Empty, PriorityBadge, Segmented, SPRING_SOFT, flashElement, accountNum, accName } from '../components/ui'
import { Lightbox, SoundRow } from '../components/Sound'
import { TaskLook } from '../components/TaskLook'
import { plain } from './Tasks'
import { ago, dateShort } from '../lib/format'

const shot = (d: Decision, n: number) => media(`dimg/${d.id}/${n}`)
type Reaction = 'si' | 'no'

/** Like / don't like, on any picture, video or sound of a decision. */
function Thumbs({ value, onChange, dark }: { value?: Reaction; onChange?: (v?: Reaction) => void; dark?: boolean }) {
  const base = dark ? { background: 'rgb(0 0 0 / 0.55)', color: 'white', backdropFilter: 'blur(8px)' } : { background: 'var(--fill)' }
  return (
    <span className="inline-flex gap-1 flex-none" onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-sm btn-icon" title="Me gusta" aria-pressed={value === 'si'} disabled={!onChange} style={value === 'si' ? { background: 'var(--green)', color: 'white', opacity: 1 } : base} onClick={() => onChange?.(value === 'si' ? undefined : 'si')}><ThumbsUp size={13} /></button>
      <button className="btn btn-sm btn-icon" title="No me gusta" aria-pressed={value === 'no'} disabled={!onChange} style={value === 'no' ? { background: 'var(--red)', color: 'white', opacity: 1 } : base} onClick={() => onChange?.(value === 'no' ? undefined : 'no')}><ThumbsDown size={13} /></button>
    </span>
  )
}

/** The pictures, videos and sounds of a decision: what is asked about, seen and heard, each saying what it is for. */
function Media({ d, react, setReact, onZoom }: { d: Decision; react: Record<number, Reaction>; setReact?: (n: number, v?: Reaction) => void; onZoom: (n: number) => void }) {
  const items = d.images.map((m, n) => ({ ...m, n }))
  const pics = items.filter((m) => m.kind === 'image' || !m.kind)
  const vids = items.filter((m) => m.kind === 'video')
  const sounds = items.filter((m) => m.kind === 'audio')
  const groups = [...new Set(sounds.map((s) => s.group ?? ''))]
  return (
    <div className="px-5 pb-4 flex flex-col gap-4">
      {pics.length > 0 && (
        <div className="decision-shots">
          {pics.map((im) => (
            <div key={im.n} className="flex flex-col gap-1.5 min-w-0">
              <button className="decision-shot" onClick={() => onZoom(im.n)} title="Pulsa para verla grande">
                <img src={shot(d, im.n)} alt={im.caption} loading="lazy" />
                <span className="absolute right-2 top-2"><Thumbs dark value={react[im.n]} onChange={setReact && ((v) => setReact(im.n, v))} /></span>
              </button>
              {(im.caption || im.group) && <div className="t-small c2 px-0.5"><b>{im.caption}</b>{im.group ? <span className="c3"> · {im.group}</span> : null}</div>}
            </div>
          ))}
        </div>
      )}
      {vids.length > 0 && (
        <div className="decision-shots">
          {vids.map((v) => (
            <div key={v.n} className="flex flex-col gap-1.5 min-w-0">
              <video src={shot(d, v.n)} controls preload="metadata" className="w-full rounded-xl" style={{ background: 'black', aspectRatio: '16 / 9' }} />
              <div className="flex items-center gap-2 t-small c2 px-0.5"><b className="truncate">{v.caption}</b>{v.group && <span className="c3 truncate">· {v.group}</span>}<span className="ml-auto"><Thumbs value={react[v.n]} onChange={setReact && ((x) => setReact(v.n, x))} /></span></div>
            </div>
          ))}
        </div>
      )}
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          {g && <div className="flex items-center gap-1.5 t-micro" style={{ color: 'var(--accent)' }}><Music size={12} /> {g}</div>}
          {sounds.filter((s) => (s.group ?? '') === g).map((s) => (
            <SoundRow key={s.n} src={shot(d, s.n)} caption={s.caption ?? `Sonido ${s.n + 1}`} right={<Thumbs value={react[s.n]} onChange={setReact && ((v) => setReact(s.n, v))} />} />
          ))}
        </div>
      ))}
      {sounds.length > 0 && setReact && <div className="t-small c3">Marca 👍 o 👎 en cada una: se lo digo al Claude tal cual, junto con lo que elijas abajo.</div>}
    </div>
  )
}

/** Only the pictures are walked through in the big view; `n` is the picture's place among all the media. */
function lightItems(d: Decision, n: number) {
  const pics = d.images.map((m, k) => ({ m, k })).filter((x) => (x.m.kind ?? 'image') === 'image')
  return { items: pics.map((x) => ({ src: shot(d, x.k), caption: x.m.caption, group: x.m.group })), start: Math.max(0, pics.findIndex((x) => x.k === n)) }
}

/** A decision already taken: closed, a line; open, everything asked, everything shown and what the user answered. */
function DecidedRow({ d, startOpen, onReopen }: { d: Decision; startOpen: boolean; onReopen: () => void }) {
  const [open, setOpen] = useState(startOpen)
  const [zoom, setZoom] = useState<number>()
  const opt = d.options.find((o) => o.id === d.choice)
  const verdict = d.status === 'descartada' ? 'No hacía falta' : opt?.label ?? (d.choice === 'si' ? 'Aprobado' : d.choice === 'no' ? 'No aprobado' : 'Con nota')
  const reactions = Object.values(d.reactions ?? {})
  const first = d.images[0]
  const delivered = d.status !== 'descartada' && d.askedBy ? (d.deliveredAt ? `${accName(d.askedBy)} ya lo ha recibido, ${ago(d.deliveredAt)}` : `Le llegará a ${accName(d.askedBy)} en su próximo paso`) : undefined
  return (
    <div id={`dec-${d.id}`} className="card overflow-hidden">
      <button className="w-full text-left flex items-start gap-3 p-3 border-0 bg-transparent" onClick={() => setOpen(!open)} aria-expanded={open}>
        {first && (first.kind ?? 'image') === 'image' ? <img src={shot(d, 0)} className="w-24 h-14 rounded-lg object-cover flex-none" alt="" /> : <span className="w-24 h-14 rounded-lg flex-none flex items-center justify-center c3" style={{ background: 'var(--fill)' }}>{first?.kind === 'audio' ? <Music size={18} /> : null}</span>}
        <span className="min-w-0 flex-1">
          <span className="t-body block truncate" style={{ fontWeight: 600 }}>{d.title}</span>
          <span className="t-small block mt-0.5 truncate" style={{ color: d.status === 'descartada' ? 'var(--label-3)' : 'var(--green)' }}>{verdict}{d.note ? <span className="c2"> · «{d.note}»</span> : null}</span>
          <span className="t-small c3 block mt-0.5">{d.askedBy ? `${accName(d.askedBy)} · ` : ''}{d.decidedAt ? dateShort(d.decidedAt) : ''}{d.images.length ? ` · ${d.images.length} ${d.images.length === 1 ? 'ejemplo' : 'ejemplos'}` : ''}{reactions.length ? ` · 👍 ${reactions.filter((v) => v === 'si').length} 👎 ${reactions.filter((v) => v === 'no').length}` : ''}</span>
        </span>
        <ChevronDown size={16} className="c3 flex-none mt-1" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 160ms' }} />
      </button>
      {open && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="px-5 flex flex-col gap-2">
            {d.question && <div className="t-body c2 selectable whitespace-pre-wrap leading-relaxed">{d.question}</div>}
            {d.context && <details className="t-small c3"><summary className="cursor-pointer select-none">Más contexto</summary><div className="mt-2 whitespace-pre-wrap selectable leading-relaxed">{d.context}</div></details>}
          </div>
          {d.images.length > 0 && <Media d={d} react={(d.reactions ?? {}) as Record<number, Reaction>} onZoom={setZoom} />}
          <div className="px-5 pb-5 flex flex-col gap-3">
            {d.options.length > 0 && (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                {d.options.map((o) => (
                  <div key={o.id} className={`option-btn ${d.choice === o.id ? 'on' : ''}`} style={{ cursor: 'default', opacity: d.choice === o.id ? 1 : 0.6 }}>
                    <span className="t-head flex items-center gap-1.5">{d.choice === o.id && <Check size={15} strokeWidth={3} />}{o.label}</span>
                    {o.detail && <span className="t-small" style={{ opacity: 0.75 }}>{o.detail}</span>}
                    {d.choice === o.id && <span className="t-micro mt-1">Lo que elegiste</span>}
                  </div>
                ))}
              </div>
            )}
            {d.note && <div className="rounded-xl px-3 py-2" style={{ background: 'var(--fill)' }}><div className="t-micro c3 mb-0.5">Lo que escribiste</div><div className="t-body selectable whitespace-pre-wrap">{d.note}</div></div>}
            <div className="flex items-center gap-2 flex-wrap">
              {delivered && <span className="t-small c3">{delivered}</span>}
              <button className="btn btn-sm ml-auto" onClick={onReopen}><Undo2 size={13} /> Reabrir</button>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>{zoom != null && <Lightbox {...lightItems(d, zoom)} onClose={() => setZoom(undefined)} />}</AnimatePresence>
    </div>
  )
}

function DecisionCard({ d, onDone }: { d: Decision; onDone: (d: Decision) => void }) {
  const { state, toast } = useStore()
  const [choice, setChoice] = useState<string>()
  const [note, setNote] = useState('')
  const [zoom, setZoom] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [react, setReactAll] = useState<Record<number, Reaction>>({})
  const setReact = (n: number, v?: Reaction) => setReactAll((r) => { const x = { ...r }; if (v) x[n] = v; else delete x[n]; return x })
  const reacted = Object.keys(react).length
  const opts = d.options.length ? d.options : [{ id: 'si', label: 'Aprobar', detail: 'Está bien así' }, { id: 'no', label: 'No, cambiarlo', detail: 'Explica qué en la nota' }]
  const picked = opts.find((o) => o.id === choice)
  const needsNote = choice === 'no' && !note.trim()
  const send = async (status: 'decidida' | 'descartada' = 'decidida') => {
    if (!state) return
    setBusy(true)
    try {
      const r = await api<Decision>('answerDecision', state.activeProjectId, d.id, { choice: status === 'descartada' ? undefined : choice, note, status, reactions: status === 'descartada' ? undefined : react })
      toast(d.askedBy ? `Enviado a ${accName(d.askedBy)}: le llega en su próximo paso` : 'Decisión guardada: la recoge el primer Claude que trabaje')
      onDone(r)
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <motion.article id={`dec-${d.id}`} layout="position" className="decision" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60, transition: { duration: 0.22 } }} transition={SPRING_SOFT}>
      <div className="p-5 pb-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 t-small c3 flex-wrap">
          {d.askedBy ? <><Avatar id={d.askedBy} size={22} /><span className="c2" style={{ fontWeight: 600 }}>{accName(d.askedBy)} pregunta</span></> : <span className="c2" style={{ fontWeight: 600 }}>Pendiente</span>}
          {d.taskExtId && <span className="pill" style={{ background: 'var(--fill)' }}><b className="num">{d.taskExtId}</b></span>}
          <PriorityBadge p={d.priority} withLabel />
          <span className="ml-auto">{ago(d.createdAt)}</span>
        </div>
        <h2 className="t-title selectable">{d.title}</h2>
        {d.question && <div className="t-body c2 selectable whitespace-pre-wrap leading-relaxed" style={{ fontSize: 15 }}>{d.question}</div>}
        {d.defaultChoice && d.waitUntil && (
          <div className="t-small rounded-xl px-3 py-2" style={{ background: 'var(--fill)', color: 'var(--label-2)' }}>
            Si no contestas antes de <b>{new Date(d.waitUntil).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</b>, se elegirá <b>«{d.options.find((o) => o.id === d.defaultChoice)?.label ?? d.defaultChoice}»</b> para que el trabajo no se pare. Puedes cambiarlo después.
          </div>
        )}
        {d.context && <details className="t-small c3"><summary className="cursor-pointer select-none">Más contexto</summary><div className="mt-2 whitespace-pre-wrap selectable leading-relaxed">{d.context}</div></details>}
      </div>
      {d.images.length > 0 && <Media d={d} react={react} setReact={setReact} onZoom={setZoom} />}
      <div className="px-5 pb-5 flex flex-col gap-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${opts.length > 3 ? 180 : 220}px, 1fr))` }}>
          {opts.map((o) => (
            <button key={o.id} className={`option-btn ${choice === o.id ? 'on' : ''}`} onClick={() => setChoice(choice === o.id ? undefined : o.id)} aria-pressed={choice === o.id}>
              <span className="t-head flex items-center gap-1.5">{choice === o.id && <Check size={15} strokeWidth={3} />}{o.label}</span>
              {o.detail && <span className="t-small" style={{ opacity: 0.75 }}>{o.detail}</span>}
            </button>
          ))}
        </div>
        <textarea className="field" style={{ minHeight: 64, padding: '10px 12px', resize: 'vertical' }} placeholder={choice === 'no' ? 'Qué hay que cambiar…' : 'Nota para el Claude (opcional)'} value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (choice || note.trim() || reacted) && !needsNote) void send() }} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary" style={{ height: 36, padding: '0 16px', fontSize: 14 }} disabled={busy || (!choice && !note.trim() && !reacted) || needsNote} onClick={() => void send()}>
            <Send size={15} /> {picked ? `Decidir: ${picked.label}` : note.trim() ? 'Enviar la nota' : reacted ? 'Enviar lo que te gusta' : 'Elige una opción'}
          </button>
          <span className="t-small c3">{needsNote ? 'Di qué cambiar en la nota' : 'Ctrl + Intro para enviar'}</span>
          <button className="btn btn-ghost btn-sm ml-auto c3" disabled={busy} onClick={() => void send('descartada')} title="Ya no hace falta decidirlo">No hace falta</button>
        </div>
      </div>
      <AnimatePresence>{zoom != null && <Lightbox {...lightItems(d, zoom)} onClose={() => setZoom(undefined)} />}</AnimatePresence>
    </motion.article>
  )
}

const REVIEW_PAGE = 10

/** What waits for the user's approval, each with what it is and what to look at: no approving blind. */
function ReviewTasks() {
  const { state } = useStore()
  const pid = state?.activeProjectId
  const q = useAsync(() => (pid ? api<Task[]>('tasks', pid) : Promise.resolve([])), [pid, state?.refreshedAt?.docs, state?.summary?.tasks.review])
  const [gone, setGone] = useState<number[]>([])
  const [limit, setLimit] = useState(REVIEW_PAGE)
  const all = (q.data ?? []).filter((t) => !gone.includes(t.id))
  const list = all.filter((t) => (t.status === 'revision' || (t.waitingLook && !t.verified)) && !t.change)
  const changed = all.filter((t) => t.change)
  if (!list.length && !changed.length) return null
  const item = (t: Task) => (
    <article key={t.id} id={`rev-${t.id}`} className="card p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <b className="t-small num c2">{t.extId ?? '—'}</b>
        <PriorityBadge p={t.priority} />
        <h3 className="t-head selectable min-w-0">{plain(t)}</h3>
      </div>
      <TaskLook t={t} onChanged={q.reload} onApproved={() => setGone((g) => [...g, t.id])} />
    </article>
  )
  return (
    <>
      {list.length > 0 && (
        <section className="mt-10">
          <div className="t-section mb-1">Tareas que esperan tu visto bueno <span className="c3 num" style={{ fontWeight: 500 }}>· {list.length}</span></div>
          <div className="t-small c3 mb-3">Los Claude las dan por hechas; solo cuentan como buenas cuando tú lo dices.</div>
          <div className="flex flex-col gap-3">{list.slice(0, limit).map(item)}</div>
          {list.length > limit && <button className="btn btn-sm mt-3" onClick={() => setLimit(limit + REVIEW_PAGE)}>Ver {Math.min(REVIEW_PAGE, list.length - limit)} más</button>}
        </section>
      )}
      {changed.length > 0 && (
        <section className="mt-10">
          <div className="t-section mb-1">Con cambios pedidos <span className="c3 num" style={{ fontWeight: 500 }}>· {changed.length}</span></div>
          <div className="t-small c3 mb-3">Ya las has revisado. Volverán arriba cuando el Claude haya hecho lo que le pides.</div>
          <div className="flex flex-col gap-3">{changed.map(item)}</div>
        </section>
      )}
    </>
  )
}

export function Decisions() {
  const { state, focus, clearFocus, toast } = useStore()
  const pid = state?.activeProjectId
  const [tab, setTab] = useState<'pendientes' | 'decididas'>('pendientes')
  const [openedFromSearch, setOpenedFromSearch] = useState<number>()
  const q = useAsync(() => (pid ? api<Decision[]>('decisions', pid) : Promise.resolve([])), [pid, state?.decisionsPending])
  const project = state?.projects.find((p) => p.id === pid)
  // Every project with its questions, always in sight (12-11): the one on screen is not the only one that asks.
  const elsewhere = (state?.projects ?? []).filter((p) => p.id !== pid && (state?.pending?.[p.id]?.decisions ?? 0) > 0)
  const [answered, setAnswered] = useState<Record<number, Decision>>({})
  const all = useMemo(() => (q.data ?? []).map((d) => answered[d.id] ?? d), [q.data, answered])
  const pending = all.filter((d) => d.status === 'pendiente')
  const done = all.filter((d) => d.status !== 'pendiente').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))

  useEffect(() => {
    if (focus?.kind !== 'decision' || !q.data) return
    const d = all.find((x) => x.id === focus.id)
    if (d && d.status !== 'pendiente') { setTab('decididas'); setOpenedFromSearch(d.id) }
    flashElement(`dec-${focus.id}`)
    clearFocus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, q.data])

  return (
    <div className="content-inner max-w-[1180px]">
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <h1 className="t-display flex items-center gap-3"><span className="icon-sq icon-sq-lg" style={{ background: 'var(--red)' }}><Gavel size={17} /></span>Decidir{project ? <span className="flex items-center gap-2" style={{ fontWeight: 450 }}><span className="c3">·</span><span className="dot" style={{ width: 12, height: 12, background: project.color }} /><span className="c2">{project.name}</span></span> : null}</h1>
          <div className="t-head c2 mt-2" style={{ fontWeight: 450 }}>Lo que los Claude necesitan que decidas o apruebes. Elige, añade una nota si quieres, y les llega solo; mientras tanto siguen con otra cosa.</div>
        </div>
        <div className="ml-auto">
          <Segmented value={tab} onChange={setTab} options={[{ value: 'pendientes', label: `Pendientes · ${pending.length}` }, { value: 'decididas', label: `Decididas · ${done.length}` }]} />
        </div>
      </div>

      {(state?.projects.length ?? 0) > 1 && (
        <div className="flex items-center gap-2 flex-wrap mb-5" role="tablist" aria-label="Proyecto">
          {state!.projects.map((p) => {
            const n = state!.pending?.[p.id]?.decisions ?? 0
            const on = p.id === pid
            return (
              <button key={p.id} role="tab" aria-selected={on} className="flex items-center gap-2 h-9 px-3 rounded-xl border-0" onClick={() => void api('setActiveProject', p.id)}
                style={{ background: on ? `color-mix(in srgb, ${p.color} 20%, var(--bg-elev))` : 'var(--fill)', boxShadow: on ? `inset 0 0 0 1.5px ${p.color}` : n ? `inset 0 0 0 1px color-mix(in srgb, var(--red) 50%, transparent)` : 'none' }}>
                <span className="dot" style={{ width: 9, height: 9, background: p.color }} />
                <span className="t-body" style={{ fontWeight: on ? 650 : 520 }}>{p.name}</span>
                <span className="pill num" style={n ? { background: 'var(--red)', color: 'white', height: 20 } : { background: 'var(--fill-2)', color: 'var(--label-3)', height: 20 }}>{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {tab === 'pendientes' ? (
        <>
          {pending.length === 0 && !q.loading && (
            <div className="card"><Empty icon={<Check size={30} />} title={`Nada pendiente de decidir${project ? ` en ${project.name}` : ''}`}
              text={elsewhere.length ? <>Pero te esperan preguntas en {elsewhere.map((p, i) => <span key={p.id}>{i ? ' y ' : ''}<b>{p.name}</b> ({state!.pending[p.id].decisions})</span>)}.</> : <>Cuando un Claude necesite tu opinión, la verás aquí con fotos y te avisará Inicio. No tienes que hacer nada hasta entonces.</>}
              action={elsewhere.length ? <button className="btn btn-primary" onClick={() => void api('setActiveProject', elsewhere[0].id)}>Ir a {elsewhere[0].name}</button> : undefined} /></div>
          )}
          <div className="flex flex-col gap-5">
            <AnimatePresence initial={false}>
              {pending.map((d) => <DecisionCard key={d.id} d={d} onDone={(r) => setAnswered((m) => ({ ...m, [r.id]: r }))} />)}
            </AnimatePresence>
          </div>
          <ReviewTasks />
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {done.length === 0 && <div className="card"><Empty title="Aún no has decidido nada aquí" text="Cuando contestes una pregunta de un Claude, queda aquí con tu respuesta, por si quieres cambiarla." /></div>}
          {done.map((d) => (
            <DecidedRow key={d.id} d={d} startOpen={openedFromSearch === d.id} onReopen={async () => { const r = await api<Decision>('reopenDecision', d.id); setAnswered((m) => ({ ...m, [r.id]: r })); setTab('pendientes'); toast('Vuelve a pendientes') }} />
          ))}
        </div>
      )}
    </div>
  )
}
