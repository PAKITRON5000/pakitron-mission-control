import { t } from '../../../core/i18n'
import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { BadgeCheck, Box, Clock, MessageSquarePlus, Pencil, Play, Send, X, Zap } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type AgentCard, type Task, type TaskChange } from '../lib/api'
import { Lightbox, SoundRow } from './Sound'
import { ago, whenFull } from '../lib/format'
import { isSessionWorking } from '../../../core/working'
import { acceptanceOf } from '../../../core/acceptance'
import { accName } from './ui'
import { CodeChange } from './CodeChange'
import { readDraft, writeDraft } from '../lib/draft'

interface MediaItem { kind: 'image' | 'video' | 'audio' | 'model'; src: string; thumb?: string; caption?: string; group?: string; assetId?: number; from: 'entrega' | 'decision' | 'archivo' }
interface TaskInfo { simple: string; ask?: string; written: boolean; responsible?: string; media: MediaItem[] }

const name = (id: string) => `${accName(id)}`
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const working = (a: AgentCard | undefined, pid?: string) => a?.state !== 'sin-uso' && Boolean(a?.sessions.some((s) => s.projectId === pid && isSessionWorking(s)))

/** Where the note is now, in a sentence: the user always knows if it has arrived and what is holding it. */
function whereIsIt(c: TaskChange, a: AgentCard | undefined, pid: string | undefined, now: number): string {
  if (c.readAt) return t('{v0} ya la ha leído, {v1}. {v2}', { v0: c.target ? name(c.target) : t('Un Claude'), v1: ago(c.readAt, now), v2: c.urgent ? t('Va antes que todo lo demás.') : t('La hará antes que las tareas nuevas.') })
  if (!c.target) return t('En la cola: la cogerá el primero que trabaje, antes que las tareas nuevas.')
  if (a?.state === 'sin-uso') return t('Esperando: {v0} no tiene uso{v1}. Si corre prisa, pásasela a otro con «Editar».', { v0: name(c.target), v1: a.usage.activeLimit ? t(' hasta {v0}', { v0: whenFull(a.usage.activeLimit.resetsAt, now) }) : '' })
  if (working(a, pid)) return t('Le llega a {v0} en su próximo paso.', { v0: name(c.target) })
  return t('En la cola de {v0}: le llegará en cuanto trabaje, antes que las tareas nuevas.', { v0: name(c.target) })
}

/** The note and who gets it, whether writing it for the first time or changing it. */
function NoteForm({ start, startTarget, responsible, busy, onSend, onCancel, draftKey }: { draftKey?: string; start: string; startTarget: string; responsible?: string; busy: boolean; onSend: (note: string, target: string, now: boolean) => void; onCancel: () => void }) {
  const { state, now } = useStore()
  // EV185: what is written and not sent stays, per task (or what it already said, when changing a note).
  const [text, setTextState] = useState(() => (draftKey && readDraft(draftKey)) || start)
  const setText = (v: string) => { setTextState(v); if (draftKey) writeDraft(draftKey, v) }
  const [target, setTarget] = useState(startTarget)
  const pid = state?.activeProjectId
  const agents = state?.agents ?? []
  const who = agents.find((a) => a.id === target)
  const busyHere = working(who, pid)
  const out = who?.state === 'sin-uso'
  const empty = !text.trim()
  const label = (a: AgentCard) => (working(a, pid) ? t('trabajando') : a.state === 'sin-uso' ? (a.usage.activeLimit ? t('vuelve {v0}', { v0: whenFull(a.usage.activeLimit.resetsAt, now) }) : t('sin uso')) : t('libre'))
  return (
    <div className="flex flex-col gap-2.5">
      <textarea autoFocus className="field" style={{ minHeight: 72, padding: '10px 12px', resize: 'vertical' }} placeholder={t('Qué hay que cambiar…')} value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <div className="t-micro c3 mb-1.5">{t('Para quién')}</div>
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => (
            <button key={a.id} className={`chip ${target === a.id ? 'on' : ''}`} onClick={() => setTarget(a.id)}>
              {name(a.id)}{a.id === responsible ? t(' (la tiene)') : ''} <span style={{ opacity: 0.65 }}>· {label(a)}</span>
            </button>
          ))}
          <button className={`chip ${target === 'any' ? 'on' : ''}`} onClick={() => setTarget('any')}>{t('El primero que trabaje')}</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={busy || empty} onClick={() => onSend(text, target, false)}><Clock size={13} /> {target === 'any' ? t('A la cola') : t('A su cola')}</button>
        <button
          className="btn btn-sm"
          disabled={busy || empty || target === 'any' || out}
          title={target === 'any' ? t('Elige un Claude para mandárselo ya') : out ? t('{v0} no tiene uso ahora', { v0: name(target) }) : busyHere ? t('Le llega en su próximo paso y lo hará antes que lo demás') : t('Abre su ventana y empieza por esto; gasta sus créditos desde ya')}
          onClick={() => onSend(text, target, true)}
        >
          {busyHere || target === 'any' || out ? <Zap size={13} /> : <Play size={13} />} {busyHere || target === 'any' || out ? t('Que lo haga ya') : t('Lanzarlo ahora con esto')}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
      </div>
      <div className="t-small c3">{out ? t('{v0} no tiene uso ahora: se quedará esperando en su cola. Si corre prisa, elige a otro.', { v0: name(target) }) : t('En la cola, va antes que las tareas nuevas. «Ya» corta lo que esté haciendo en cuanto cierre el paso en curso.')}</div>
    </div>
  )
}

/**
 * A task as the user needs to judge it (the user, 5-11: «si no veo imágenes no sé si aprobarlo»): what it is in a plain
 * sentence, its pictures, videos and sounds, what to look at, and the answer, which stays with the task and can be changed.
 */
export function TaskLook({ t: task, onApproved, onChanged }: { t: Task; onApproved?: () => void; onChanged?: () => void }) {
  const { state, now, setViewer, toast } = useStore()
  const pid = state?.activeProjectId
  const info = useAsync(() => (pid ? api<TaskInfo>('taskInfo', pid, task.id) : Promise.resolve(undefined)), [pid, task.id, task.updatedAt])
  const [zoom, setZoom] = useState<number>()
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const all = info.data?.media ?? []
  // With a card written by hand, its pictures are the ones that say what this is; the rest, related, only on request.
  const related = info.data?.written ? all.filter((m) => m.from !== 'entrega') : []
  const media = more ? all : all.filter((m) => !related.includes(m))
  const pics = media.filter((m) => m.kind === 'image')
  const vids = media.filter((m) => m.kind === 'video')
  const sounds = media.filter((m) => m.kind === 'audio')
  const models = media.filter((m) => m.kind === 'model')
  const change = task.change
  const noteFor = state?.agents.find((a) => a.id === change?.target)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast(clean(e)) } finally { setBusy(false) }
  }
  const approve = () => run(async () => {
    await api('setTaskStatus', pid, task.id, 'terminada', true)
    toast(t('{v0}: dada por buena', { v0: task.extId ?? t('Tarea') }))
    onApproved?.()
  })
  const sendNote = (note: string, target: string, go: boolean) => run(async () => {
    const to = target === 'any' ? undefined : target
    const r = change
      ? await api<{ how?: string }>('updateTaskChange', pid, change.id, { note, target: to ?? null, now: go })
      : await api<{ how?: string }>('askTaskChange', pid, task.id, { note, target: to, now: go })
    toast(r.how === 'lanzado' ? t('{v0} lanzado: empieza por tu nota', { v0: name(target) }) : r.how === 'siguiente-paso' ? t('Le llega a {v0} en su próximo paso', { v0: name(target) }) : change ? t('Nota cambiada') : to ? t('En la cola de {v0}', { v0: name(to) }) : t('En la cola'))
    writeDraft(`tarea:${pid}:${task.id}`, '')
    setWriting(false)
    onChanged?.()
  })
  const removeNote = () => run(async () => {
    await api('removeTaskChange', pid, change!.id)
    toast(change!.readAt ? t('Nota quitada: se le dice que la olvide') : t('Nota quitada: no llegó a leerla'))
    onChanged?.()
  })
  const openPic = (m: MediaItem) => {
    if (m.assetId != null && pics.every((x) => x.assetId != null)) setViewer(m.assetId, pics.map((x) => x.assetId!))
    else setZoom(pics.indexOf(m))
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="t-micro c3 mb-1">{t('Qué es')}</div>
        <div className="t-body selectable leading-relaxed" style={{ fontSize: 15 }}>{info.data?.simple ?? (info.loading ? '…' : task.title)}</div>
      </div>
      {/* EV78: what «done» means for this task, when its line says it. */}
      {acceptanceOf(`${task.title} ${task.detail ?? ''}`) && (
        <div className="rounded-xl px-3 py-2 t-small" style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--green) 35%, transparent)' }}>
          <b>{t('Se da por buena cuando')}</b> {acceptanceOf(`${task.title} ${task.detail ?? ''}`)}
          {/* EV78: pass or not is said by the user here (or by the app's checks), never by the Claude's word. */}
          {task.status === 'terminada' && !task.verified && (
            <div className="flex gap-1.5 mt-2">
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void approve()}>{t('Se cumple')}</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => setWriting(true)}>{t('No se cumple: pedir cambios')}</button>
            </div>
          )}
        </div>
      )}
      {media.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="t-micro c3">{t('Míralo')}</div>
          {pics.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {pics.map((m, n) => (
                <div key={n} className="flex flex-col gap-1 min-w-0">
                  <button className="tile p-0 border-0 aspect-[16/10]" title={t('Pulsa para verla grande')} onClick={() => openPic(m)}><img src={m.thumb ?? m.src} alt={m.caption ?? ''} loading="lazy" /></button>
                  {m.caption && <div className="t-small c2 clamp-3">{m.caption}{m.group ? <span className="c3"> · {m.group}</span> : null}</div>}
                </div>
              ))}
            </div>
          )}
          {vids.map((m, n) => (
            <div key={n} className="flex flex-col gap-1">
              <video src={m.src} controls preload="metadata" className="w-full rounded-xl" style={{ background: 'black', aspectRatio: '16 / 9', maxHeight: 420 }} />
              {m.caption && <div className="t-small c2">{m.caption}</div>}
            </div>
          ))}
          {sounds.length > 0 && <div className="flex flex-col gap-1.5">{sounds.map((m, n) => <SoundRow key={n} src={m.src} caption={m.caption ?? t('Sonido {n}', { n: n + 1 })} sub={m.group} />)}</div>}
          {models.map((m, n) => (
            <button key={n} className="btn btn-sm self-start" disabled={m.assetId == null} onClick={() => setViewer(m.assetId!, [m.assetId!])}><Box size={13} /> {m.caption ?? t('Ver el modelo 3D')}</button>
          ))}
        </div>
      )}
      {media.length === 0 && !info.loading && (
        <div className="t-small c3 rounded-xl px-3 py-2" style={{ background: 'var(--fill)' }}>{t('No hay nada que ver ni escuchar de esto en concreto. Si no sabes juzgarlo, pide que te lo enseñen.')}</div>
      )}
      {related.length > 0 && (
        <button className="btn btn-sm btn-ghost self-start" onClick={() => setMore(!more)}>{more ? t('Ver solo lo de esta tarea') : t('Ver también {v0}', { v0: related.length === 1 ? t('otra foto relacionada') : t('otras {n} relacionadas', { n: related.length }) })}</button>
      )}
      {/* EV138: the code it changed, with a comment on any line; the comments go as the note (or are added to it). */}
      {task.extId && (
        <CodeChange
          pid={pid}
          taskId={task.id}
          who={(change?.target ?? info.data?.responsible) ? name((change?.target ?? info.data?.responsible)!) : undefined}
          busy={busy}
          onSend={(text) => void sendNote(change ? `${change.note}\n\n${text}` : text, change?.target ?? info.data?.responsible ?? 'any', false)}
        />
      )}
      {info.data?.ask && !change && (
        <div className="rounded-xl px-3 py-2" style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)' }}>
          <div className="t-micro mb-0.5" style={{ color: 'var(--orange)' }}>{t('Qué mirar')}</div>
          <div className="t-body selectable leading-relaxed">{info.data.ask}</div>
        </div>
      )}
      {task.changeDone && !change && !task.verified && (
        <div className="rounded-xl px-3 py-2" style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)' }}>
          <div className="t-micro mb-0.5" style={{ color: 'var(--green)' }}>{t('Cambios hechos{v0}', { v0: task.changeDone.doneAt ? `, ${ago(task.changeDone.doneAt, now)}` : '' })}</div>
          <div className="t-body selectable whitespace-pre-wrap">{t('Pediste: {note}', { note: task.changeDone.note })}</div>
        </div>
      )}
      {writing ? (
        <NoteForm
          draftKey={`tarea:${pid}:${task.id}`}
          start={change?.note ?? (media.length === 0 ? t('Enséñamelo con fotos o audio para poder juzgarlo.') : '')}
          startTarget={change ? change.target ?? 'any' : info.data?.responsible ?? 'any'}
          responsible={info.data?.responsible}
          busy={busy}
          onSend={(note, target, go) => void sendNote(note, target, go)}
          onCancel={() => setWriting(false)}
        />
      ) : change ? (
        <div className="rounded-xl px-3 py-2.5 flex flex-col gap-2" style={{ background: 'color-mix(in srgb, var(--indigo) 14%, transparent)' }}>
          <div className="t-micro" style={{ color: 'var(--indigo)' }}>{t('Tu nota: cambios pedidos{v0}', { v0: change.urgent ? t(', para ya') : '' })}</div>
          <div className="t-body selectable whitespace-pre-wrap leading-relaxed">{change.note}</div>
          <div className="t-small c2">{whereIsIt(change, noteFor, pid, now)}</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={busy} onClick={() => setWriting(true)}><Pencil size={13} /> {t('Editar o pasársela a otro')}</button>
            {change.target && !change.urgent && noteFor?.state !== 'sin-uso' && (
              <button className="btn btn-sm" disabled={busy} onClick={() => void sendNote(change.note, change.target!, true)}>
                {working(noteFor, pid) ? <><Zap size={13} /> {t('Que lo haga ya')}</> : <><Play size={13} /> {t('Lanzarlo ahora con esto')}</>}
              </button>
            )}
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void removeNote()}><X size={13} /> {t('Quitar la nota')}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!task.verified && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void approve()}><BadgeCheck size={14} /> {t('Está bien así')}</button>}
          <button className="btn btn-sm" onClick={() => setWriting(true)}><MessageSquarePlus size={14} /> {t('Hay que cambiar algo')}</button>
        </div>
      )}
      <AnimatePresence>{zoom != null && <Lightbox items={pics.map((m) => ({ src: m.src, caption: m.caption, group: m.group }))} start={zoom} onClose={() => setZoom(undefined)} />}</AnimatePresence>
    </div>
  )
}
