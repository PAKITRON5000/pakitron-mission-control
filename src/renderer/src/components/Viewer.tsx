import { t } from '../../../core/i18n'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  X, MapPin, Circle, MoveUpRight, Hand, PenLine, Square, ExternalLink, FolderOpen, Play, Pause, ChevronLeft, ChevronRight, Camera, Columns2, Maximize, Box, Send, Copy, Check, RotateCcw, PanelRight
} from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, media, fileUrl, thumbUrl, type AccountId, type Comment, type Instruction } from '../lib/api'
import { SPRING, ACCOUNT_COLOR, accName } from './ui'
import { ago, bytes, dateShort, clock } from '../lib/format'

type Mode = 'ver' | 'pin' | 'circle' | 'rect' | 'arrow' | 'pen'
const ModelStage = lazy(() => import('./ModelStage'))
interface Draft { x?: number; y?: number; shape: 'pin' | 'circle' | 'rect' | 'arrow' | 'pen'; geom?: { r?: number; x2?: number; y2?: number; p?: [number, number, number]; pts?: [number, number][] }; timeSec?: number; frame?: string }

const C_STATUS: Record<string, { label: string; color: string }> = {
  pendiente: { get label() { return t('Pendiente') }, color: 'var(--orange)' },
  recibido: { get label() { return t('Recibido') }, color: 'var(--teal)' },
  'en-correccion': { get label() { return t('En corrección') }, color: 'var(--accent)' },
  corregido: { get label() { return t('Corregido') }, color: 'var(--purple)' },
  'esperando-revision': { get label() { return t('Esperando tu revisión') }, color: 'var(--yellow)' },
  aprobado: { get label() { return t('Aprobado') }, color: 'var(--green)' },
  reabierto: { get label() { return t('Reabierto') }, color: 'var(--red)' }
}
const D_STATUS: Record<string, string> = {
  get guardada() { return t('Guardada en Mission Control (aún no la ha visto ningún agente)') },
  get 'pendiente-entrega'() { return t('Pendiente de entrega') },
  get entregada() { return t('Escrita en el Buzón: la verá el próximo agente que empiece un bloque') },
  get recibida() { return t('Recibida: un agente la ha recogido del Buzón') },
  get ejecutada() { return t('Hecha y aprobada por ti') },
  get fallida() { return t('No se pudo entregar') }
}

function fmtT(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  const f = Math.floor((secs % 1) * 30)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`
}

export function Viewer() {
  const { viewer, setViewer, viewerList, state, toast } = useStore()
  // What ← → walks through: the list it was opened from, or else the newest files of the project.
  const fallback = useAsync(() => (!viewerList && viewer && state?.activeProjectId ? api<{ items: { id: number }[] }>('assets', { projectId: state.activeProjectId, limit: 400 }).then((r) => r.items.map((x) => x.id)) : Promise.resolve(undefined)), [viewer && !viewerList, state?.activeProjectId])
  const list = useMemo(() => {
    const l = viewerList ?? fallback.data ?? []
    return viewer && !l.includes(viewer) ? [viewer, ...l] : l
  }, [viewerList, fallback.data, viewer])
  const idx = viewer ? list.indexOf(viewer) : -1
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  const asset = useAsync(() => (viewer ? api<any>('asset', viewer) : Promise.resolve(undefined)), [viewer])
  const comments = useAsync(() => (viewer && pid ? api<Comment[]>('comments', pid, viewer) : Promise.resolve([])), [viewer, pid])
  const instr = useAsync(() => (pid ? api<Instruction[]>('instructions', pid) : Promise.resolve([])), [pid, comments.data])
  const versions = useAsync(() => (viewer && pid ? api<any[]>('assetVersions', pid, viewer) : Promise.resolve([])), [viewer, pid])
  const a = asset.data
  const [mode, setMode] = useState<Mode>('ver')
  const [draft, setDraft] = useState<Draft>()
  const [text, setText] = useState('')
  const [target, setTarget] = useState<AccountId | ''>('')
  const [panel, setPanel] = useState(true)
  const [compare, setCompare] = useState<number>()
  const [split, setSplit] = useState(0.5)
  const [hover, setHover] = useState<number>()
  const [editing, setEditing] = useState<number>()
  const [editText, setEditText] = useState('')
  const hooksOn = Object.values(state?.hooks ?? {}).some(Boolean)
  const saveEdit = async (id: number) => {
    try {
      await api('editComment', id, editText.trim())
      setEditing(undefined)
      comments.reload()
      instr.reload()
      toast(t('Nota corregida'))
    } catch (e) { toast((e as Error).message) }
  }
  const [note, setNote] = useState('')
  const [noteTarget, setNoteTarget] = useState<AccountId | ''>('')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const saveNote = async () => {
    if (!a || !pid || !note.trim()) return
    try {
      await api('addComment', { projectId: pid, assetId: a.id, body: note.trim(), target: noteTarget || undefined, shape: 'pin' }, a.rel)
      setNote('')
      comments.reload()
      toast(t('Nota guardada: queda como corrección pendiente para los Claude'))
    } catch (e) { toast((e as Error).message) }
  }
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => { setMode('ver'); setDraft(undefined); setCompare(undefined); setText('') }, [viewer])
  useEffect(() => { if (window.innerWidth < 1000) setPanel(false) }, [viewer])

  const close = useCallback(() => setViewer(undefined), [setViewer])
  useEffect(() => {
    if (!viewer) return
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'Escape') { if (draft) setDraft(undefined); else close() }
      if (typing) return
      if (e.key === 'ArrowLeft' && !draft && idx > 0) { e.preventDefault(); setViewer(list[idx - 1]) }
      if (e.key === 'ArrowRight' && !draft && idx >= 0 && idx < list.length - 1) { e.preventDefault(); setViewer(list[idx + 1]) }
      if (e.key === 'v') setMode('ver')
      if (e.key === 'c') setMode('pin')
      if (e.key === 'o') setMode('circle')
      if (e.key === 'f') setMode('arrow')
      if (e.key === 'r') setMode('pen')
      if (e.key === 'b') setMode('rect')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [viewer, draft, close, list, idx, setViewer])

  const save = async () => {
    if (!a || !pid || !draft || !text.trim()) return
    try {
      await api('addComment', { projectId: pid, assetId: a.id, x: draft.x, y: draft.y, timeSec: draft.timeSec, shape: draft.shape, geom: draft.geom, body: text.trim(), target: target || undefined, frameDataUrl: draft.frame }, a.rel)
      setDraft(undefined)
      setText('')
      comments.reload()
      toast(t('Comentario guardado y convertido en corrección'))
    } catch (e) { toast((e as Error).message) }
  }

  const insFor = (c: Comment) => instr.data?.find((i) => i.id === c.instructionId)

  return (
    <AnimatePresence>
      {viewer && (
        <motion.div
          ref={root}
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'color-mix(in srgb, var(--bg) 96%, black)' }}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.985 }}
          transition={SPRING}
        >
          <div className="titlebar viewer-bar" style={{ background: 'transparent', borderBottom: '1px solid var(--sep)' }}>
            <button className="btn btn-sm btn-icon btn-ghost" onClick={close} aria-label={t('Cerrar visor')}><X size={16} /></button>
            <div className="min-w-0">
              <div className="t-body truncate" style={{ fontWeight: 600 }}>{a?.name ?? '…'}</div>
            </div>
            <div className="t-small c3 truncate hidden min-[900px]:block">{a?.rel}</div>
            <div className="ml-auto flex items-center gap-1.5 no-drag">
              {a && (a.kind === 'image' || a.kind === 'video' || a.kind === 'model') && (
                <div className="seg">
                  {([['ver', Hand, t('Mover (V)')], ['pin', MapPin, t('Punto (C)')], ['circle', Circle, t('Círculo (O)')], ['rect', Square, t('Recuadro (B)')], ['arrow', MoveUpRight, t('Flecha (F)')], ['pen', PenLine, t('Rotulador (R)')]] as const).filter(([m]) => (a.kind !== 'model' || m === 'ver' || m === 'pin') && (a.kind !== 'video' || m !== 'pen')).map(([m, I, label]) => (
                    <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={label} aria-label={label}>
                      {mode === m && <motion.div layoutId="vmode" className="seg-thumb" transition={SPRING} />}
                      <span className="flex items-center gap-1.5"><I size={14} /><span className="hidden min-[1100px]:inline">{label.split(' (')[0]}</span></span>
                    </button>
                  ))}
                </div>
              )}
              {a?.kind === 'image' && (versions.data?.length ?? 0) > 1 && (
                <select className="field h-[30px] text-[12.5px]" value={compare ?? ''} onChange={(e) => setCompare(e.target.value ? Number(e.target.value) : undefined)} aria-label={t('Comparar con otra versión')}>
                  <option value="">{t('Comparar…')}</option>
                  {versions.data!.filter((v) => v.id !== a.id).map((v) => <option key={v.id} value={v.id}>{dateShort(v.mtime)} {clock(v.mtime)} · {v.rel.split('/').slice(-2, -1)[0]}</option>)}
                </select>
              )}
              <button className="btn btn-sm btn-icon" title={t('Pantalla completa')} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())}><Maximize size={14} /></button>
              <button className="btn btn-sm btn-icon" title={t('Ficha y comentarios')} onClick={() => setPanel(!panel)}><PanelRight size={14} /></button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 relative">
              {a?.kind === 'image' && (
                <ImageStage
                  key={a.id}
                  id={a.id}
                  compareId={compare}
                  split={split}
                  setSplit={setSplit}
                  mode={mode}
                  comments={comments.data ?? []}
                  draft={draft}
                  setDraft={(d) => { setDraft(d); setText('') }}
                  hover={hover}
                />
              )}
              {a?.kind === 'video' && <VideoStage key={a.id} id={a.id} mode={mode} comments={comments.data ?? []} draft={draft} setDraft={(d) => { setDraft(d); setText('') }} />}
              {a?.kind === 'model' && (
                <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center t-small c3">{t('Preparando el visor 3D…')}</div>}>
                  <ModelStage key={a.id} id={a.id} name={a.name} picking={mode === 'pin'} comments={comments.data ?? []} draftPoint={draft?.geom?.p} onPick={(p) => { setDraft({ shape: 'pin', geom: { p } }); setText('') }} />
                </Suspense>
              )}
              {a?.kind === 'audio' && (
                <div className="absolute inset-0 flex items-center justify-center"><audio controls src={fileUrl(a.id)} className="w-[min(560px,80%)]" /></div>
              )}
              <AnimatePresence>
                {draft && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={SPRING}
                    className="absolute left-1/2 bottom-6 -translate-x-1/2 card p-3 w-[min(520px,calc(100%-32px))] z-10" style={{ boxShadow: 'var(--shadow-3), var(--card-edge)' }}
                  >
                    <div className="t-small c3 mb-2 flex items-center gap-2">
                      {draft.frame && <img src={draft.frame} className="h-9 rounded-md" alt="" />}
                      <span>{draft.geom?.p ? t('Punto del modelo 3D') : draft.timeSec != null ? t('En {v0}', { v0: fmtT(draft.timeSec) }) : t('Comentario')}{draft.x != null ? t(' · {v0} en {v1} %, {v2} %', { v0: draft.shape === 'circle' ? t('círculo') : draft.shape === 'arrow' ? t('flecha') : draft.shape === 'rect' ? t('recuadro') : draft.shape === 'pen' ? t('trazo a mano') : t('punto'), v1: Math.round(draft.x * 100), v2: Math.round((draft.y ?? 0) * 100) }) : ''}</span>
                    </div>
                    <textarea
                      autoFocus rows={3} className="field w-full" placeholder={t('Qué hay que corregir. Ej.: Las pestañas están demasiado arriba; corrige su posición y mantén la expresión.')}
                      value={text} onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save() }}
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <select className="field h-[30px] text-[12.5px]" value={target} onChange={(e) => setTarget(e.target.value as AccountId)} aria-label={t('Para quién')}>
                        <option value="">{t('Para quien esté libre')}</option>
                        {(state?.agents ?? []).map((x) => x.id).map((x) => <option key={x} value={x}>{t('Para {v0}', { v0: accName(x) })}</option>)}
                      </select>
                      <span className="t-small c4 ml-auto">{t('Ctrl + Intro')}</span>
                      <button className="btn btn-sm" onClick={() => setDraft(undefined)}>{t('Cancelar')}</button>
                      <button className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={() => void save()}>{t('Guardar')}</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {idx > 0 && !draft && (
                <button className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center border-0 opacity-70 hover:opacity-100 transition-opacity"
                  style={{ background: 'var(--chrome)', backdropFilter: 'blur(14px)', boxShadow: 'var(--shadow-2)' }} onClick={() => setViewer(list[idx - 1])} aria-label={t('Anterior (←)')} title={t('Anterior (←)')}><ChevronLeft size={20} /></button>
              )}
              {idx >= 0 && idx < list.length - 1 && !draft && (
                <button className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center border-0 opacity-70 hover:opacity-100 transition-opacity"
                  style={{ background: 'var(--chrome)', backdropFilter: 'blur(14px)', boxShadow: 'var(--shadow-2)' }} onClick={() => setViewer(list[idx + 1])} aria-label={t('Siguiente (→)')} title={t('Siguiente (→)')}><ChevronRight size={20} /></button>
              )}
            </div>
            {list.length > 1 && <Filmstrip list={list} current={viewer!} onPick={(id) => setViewer(id)} />}
            </div>
            <AnimatePresence initial={false}>
              {panel && a && (
                <motion.aside
                  initial={{ width: 0, opacity: 0 }} animate={{ width: 360, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={SPRING}
                  className="flex-none overflow-hidden border-l" style={{ borderColor: 'var(--sep)', background: 'var(--bg-elev)' }}
                >
                  <div className="w-[360px] h-full overflow-y-auto p-5 flex flex-col gap-5">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 t-small">
                      <div><div className="t-micro c3">{t('Tipo')}</div>{a.kind === 'image' ? t('Imagen') : a.kind === 'video' ? t('Vídeo') : a.kind === 'model' ? t('Modelo 3D') : t('Audio')}</div>
                      <div><div className="t-micro c3">{t('Categoría')}</div>{a.category}</div>
                      <div><div className="t-micro c3">{t('Fecha')}</div>{dateShort(a.mtime)}, {clock(a.mtime)}</div>
                      <div><div className="t-micro c3">{t('Tamaño')}</div>{bytes(a.size)}{a.width ? ` · ${a.width}×${a.height}` : ''}</div>
                      <div><div className="t-micro c3">{t('Claude responsable')}</div><span className="c3">{a.account ?? t('Sin datos')}</span></div>
                      <div><div className="t-micro c3">{t('Tarea asociada')}</div><span className="c3">{a.task_ext_id ?? t('Sin datos')}</span></div>
                      <div className="col-span-2"><div className="t-micro c3">{t('Estado')}</div>
                        <select className="field h-[28px] mt-1 text-[12.5px]" defaultValue={a.status} onChange={(e) => { const v = e.target.value; void api('setAssetStatus', a.id, v).then(() => toast(v === 'con-cambios' ? t('Estado guardado: escribe abajo qué hay que cambiar') : t('Estado guardado'))); if (v === 'con-cambios') setTimeout(() => noteRef.current?.focus(), 50) }}>
                          <option value="nuevo">{t('Nuevo')}</option><option value="en-revision">{t('En revisión')}</option><option value="con-cambios">{t('Necesita cambios')}</option><option value="aprobado">{t('Aprobado')}</option>
                        </select>
                      </div>
                      <div className="col-span-2"><div className="t-micro c3">{t('Ruta original')}</div><div className="selectable break-all c2">{a.path}</div></div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-sm" onClick={() => api('openAsset', a.id)}><ExternalLink size={13} /> {t('Abrir original')}</button>
                      <button className="btn btn-sm" onClick={() => api('showAsset', a.id)}><FolderOpen size={13} /> {t('Mostrar en carpeta')}</button>
                    </div>
                    {(versions.data?.length ?? 0) > 1 && (
                      <div>
                        <div className="t-micro c3 mb-1.5">{t('Versiones con el mismo nombre · {length}', { length: versions.data!.length })}</div>
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                          {versions.data!.map((v) => (
                            <button key={v.id} className="tile flex-none w-20 aspect-[4/3] p-0 border-0" style={v.id === a.id ? { boxShadow: '0 0 0 2px var(--accent)' } : undefined} onClick={() => setViewer(v.id)} title={`${v.rel} · ${dateShort(v.mtime)}`}>
                              <img src={thumbUrl(v.id, 200)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="rounded-2xl p-3 mb-4" style={{ background: 'var(--bg-elev-2)' }}>
                        <div className="t-head mb-2">{t('¿Qué hay que cambiar?')}</div>
                        <textarea
                          ref={noteRef} rows={3} className="field w-full t-body" placeholder={t('Ej.: las pestañas están demasiado arriba; corrígelas y mantén la expresión.')}
                          value={note} onChange={(e) => setNote(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveNote() }}
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <select className="field h-[28px] text-[12.5px] flex-1 min-w-0" value={noteTarget} onChange={(e) => setNoteTarget(e.target.value as AccountId)} aria-label={t('Para quién')}>
                            <option value="">{t('Para quien esté libre')}</option>
                            {(state?.agents ?? []).map((x) => x.id).map((x) => <option key={x} value={x}>{t('Para {v0}', { v0: accName(x) })}</option>)}
                          </select>
                          <button className="btn btn-sm btn-primary" disabled={!note.trim()} onClick={() => void saveNote()}>{t('Guardar nota')}</button>
                        </div>
                        {(a.kind === 'image' || a.kind === 'video' || a.kind === 'model') && (
                          <button className="t-small mt-2 border-0 bg-transparent p-0 flex items-center gap-1.5" style={{ color: 'var(--accent)' }} onClick={() => setMode('pin')}>
                            <MapPin size={13} /> {t('O marca el sitio exacto en {v0}', { v0: a.kind === 'video' ? t('el vídeo (pausa en el segundo que quieras)') : a.kind === 'model' ? t('el modelo') : t('la imagen') })}
                          </button>
                        )}
                        <div className="t-small c3 mt-2">{t('Cada nota se convierte en una corrección para los Claude: la reciben al abrir su próxima sesión y aquí verás si la han cogido.')}</div>
                      </div>
                      <div className="t-micro c3 mb-2">{t('Notas y comentarios ·')} {(comments.data ?? []).filter((c) => c.status !== 'aprobado').length} {t('abiertos')}</div>
                      {(comments.data ?? []).length === 0 && <div className="t-small c3">{t('Aún no hay notas en este archivo.')}</div>}
                      <div className="flex flex-col gap-2">
                        {(comments.data ?? []).map((c, i) => {
                          const ins = insFor(c)
                          const st = C_STATUS[c.status]
                          return (
                            <div key={c.id} className="card-flat p-3" onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(undefined)}>
                              <div className="flex items-center gap-2 t-small">
                                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] num" style={{ background: st.color, color: 'white', fontWeight: 700 }}>{i + 1}</span>
                                <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                                {c.timeSec != null && <span className="c3 num">{fmtT(c.timeSec)}</span>}
                                {c.target && <span className="c3 flex items-center gap-1 ml-auto"><span className="dot" style={{ background: ACCOUNT_COLOR[c.target] }} />{accName(c.target)}</span>}
                              </div>
                              {editing === c.id ? (
                                <div className="mt-1.5">
                                  <textarea autoFocus rows={3} className="field w-full t-body" value={editText} onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Escape') setEditing(undefined); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveEdit(c.id) }} />
                                  <div className="flex gap-1.5 mt-1.5">
                                    <button className="btn btn-sm btn-primary" disabled={!editText.trim()} onClick={() => void saveEdit(c.id)}>{t('Guardar cambios')}</button>
                                    <button className="btn btn-sm" onClick={() => setEditing(undefined)}>{t('Cancelar')}</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="t-body mt-1.5 selectable">{c.body}</div>
                              )}
                              {ins && <div className="t-small c3 mt-1.5">{ins.status === 'guardada' && hooksOn ? t('Esperando: la recogerá el próximo Claude que trabaje en el proyecto (no tienes que hacer nada)') : D_STATUS[ins.status]}{ins.error ? `: ${ins.error}` : ''}</div>}
                              {c.assetMtime && c.assetMtime !== a.mtime && (
                                <div className="mt-1.5">
                                  <div className="t-small" style={{ color: 'var(--purple)' }}>{t('El archivo ha cambiado desde tu nota{v0}', { v0: c.keptPath ? t('. Esta es la versión que anotaste (guardada aparte, nadie la puede borrar):') : t(': revisa la versión nueva.') })}</div>
                                  {c.keptPath && a.kind === 'image' && (
                                    <button className="block w-full border-0 p-0 mt-1.5 rounded-lg overflow-hidden" style={{ background: 'var(--fill)', cursor: 'zoom-in' }} title={t('Abrir la versión anotada')} onClick={() => api('openPath', c.keptPath)}>
                                      <img src={media(`kept/${c.id}`)} alt={t('Versión anotada')} className="w-full block" />
                                    </button>
                                  )}
                                  {c.keptPath && a.kind !== 'image' && <button className="btn btn-sm mt-1.5" onClick={() => api('openPath', c.keptPath)}>{t('Abrir la versión anotada')}</button>}
                                </div>
                              )}
                              {!(c.assetMtime && c.assetMtime !== a.mtime) && c.keptPath && <div className="t-small c4 mt-1">{t('Guardada una copia de esta versión: aunque un Claude la sobrescriba, tu nota no se pierde.')}</div>}
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {editing !== c.id && <button className="btn btn-sm" onClick={() => { setEditing(c.id); setEditText(c.body) }}>{t('Editar')}</button>}
                                {editing !== c.id && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm(t('¿Borrar esta nota? Si ningún Claude la ha cogido aún, desaparece del todo.'))) void api('deleteComment', c.id).then(() => { comments.reload(); toast(t('Nota borrada')) }) }}>{t('Borrar')}</button>}
                                {ins && ins.status === 'guardada' && !hooksOn && (
                                  project?.allowBuzon
                                    ? <button className="btn btn-sm btn-primary" onClick={() => api('deliverInstruction', pid, ins.id).then((r: any) => { instr.reload(); toast(r.status === 'entregada' ? t('Escrito en el Buzón') : r.error ?? t('No se pudo')) })}><Send size={12} /> {t('Al Buzón')}</button>
                                    : <button className="btn btn-sm" title={t('Actívalo en Ajustes › Proyecto')} onClick={() => toast(t('Para entregarlo, permite escribir en el Buzón en Ajustes › Proyecto'))}><Send size={12} /> {t('Al Buzón')}</button>
                                )}
                                {ins && <button className="btn btn-sm" onClick={() => api('copyInstruction', pid, ins.id).then(() => toast(t('Copiado: pégalo en la ventana del Claude que quieras')))}><Copy size={12} /> {t('Copiar')}</button>}
                                {c.status !== 'aprobado' && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'aprobado').then(() => { comments.reload(); toast(t('Aprobado')) })}><Check size={12} /> {t('Aprobar')}</button>}
                                {(c.status === 'aprobado' || c.status === 'corregido' || c.status === 'esperando-revision') && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'reabierto').then(() => { comments.reload(); toast(t('Reabierto: vuelve a la cola')) })}><RotateCcw size={12} /> {t('Otra corrección')}</button>}
                                {(c.status === 'recibido' || c.status === 'pendiente' || c.status === 'reabierto') && <button className="btn btn-sm btn-ghost" onClick={() => api('setCommentStatus', c.id, 'esperando-revision', t('Marcado por el usuario')).then(() => comments.reload())}>{t('Ya está corregido')}</button>}
                              </div>
                              <div className="t-small c4 mt-1.5">{t('{v0} · historial:', { v0: ago(c.createdAt) })} {c.history.map((h) => C_STATUS[h.status]?.label ?? h.status).join(' → ')}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---- image stage: zoom around the cursor, pan, annotate in image coordinates -------------------------------------

function Marks({ comments, draft, w, h, s, hover }: { comments: Comment[]; draft?: Draft; w: number; h: number; s: number; hover?: number }) {
  const all = [...comments.map((c, i) => ({ ...c, n: i + 1, draft: false })), ...(draft && draft.x != null ? [{ ...draft, id: -1, n: comments.length + 1, status: 'pendiente', draft: true } as any] : [])]
  const pr = 12 / s
  return (
    <svg className="absolute left-0 top-0 pointer-events-none" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <defs>
        <marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#FF453A" /></marker>
      </defs>
      {all.filter((c) => c.x != null).map((c) => {
        const x = c.x * w, y = c.y * h
        const col = c.draft ? '#0A84FF' : c.status === 'aprobado' ? '#30D158' : '#FF453A'
        const on = hover === c.id || c.draft
        return (
          <g key={c.id} opacity={hover && !on ? 0.45 : 1}>
            {c.shape === 'circle' && c.geom?.r && <circle cx={x} cy={y} r={c.geom.r * w} fill="none" stroke={col} strokeWidth={3} vectorEffect="non-scaling-stroke" />}
            {c.shape === 'rect' && c.geom?.x2 != null && <rect x={Math.min(c.x, c.geom.x2) * w} y={Math.min(c.y, c.geom.y2!) * h} width={Math.abs(c.geom.x2 - c.x) * w} height={Math.abs(c.geom.y2! - c.y) * h} rx={6 / s} fill="none" stroke={col} strokeWidth={3} vectorEffect="non-scaling-stroke" />}
            {c.shape === 'pen' && c.geom?.pts && <polyline points={c.geom.pts.map(([px, py]: [number, number]) => `${px * w},${py * h}`).join(' ')} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {c.shape === 'arrow' && c.geom?.x2 != null && <line x1={c.geom.x2 * w} y1={c.geom.y2! * h} x2={x} y2={y} stroke={col} strokeWidth={3.5} vectorEffect="non-scaling-stroke" markerEnd="url(#ah)" />}
            <circle cx={x} cy={y} r={pr} fill={col} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <text x={x} y={y + pr * 0.36} textAnchor="middle" fontSize={pr} fontWeight={700} fill="white" fontFamily="Inter Variable, sans-serif">{c.n}</text>
          </g>
        )
      })}
    </svg>
  )
}

function ImageStage({ id, compareId, split, setSplit, mode, comments, draft, setDraft, hover }: {
  id: number; compareId?: number; split: number; setSplit: (v: number) => void; mode: Mode; comments: Comment[]; draft?: Draft; setDraft: (d?: Draft) => void; hover?: number
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number }>()
  const [view, setT] = useState({ s: 1, x: 0, y: 0 })
  const drag = useRef<{ kind: 'pan' | 'draw' | 'split'; sx: number; sy: number; tx: number; ty: number; px?: number; py?: number } | null>(null)
  const [live, setLiveState] = useState<Draft>()
  // The shape being drawn also lives in a ref: pointer events can arrive faster than renders.
  const liveRef = useRef<Draft>(undefined)
  const setLive = (v: Draft | undefined | ((prev?: Draft) => Draft | undefined)) => {
    const next = typeof v === 'function' ? v(liveRef.current) : v
    liveRef.current = next
    setLiveState(next)
  }

  const fit = useCallback(() => {
    const el = stage.current
    if (!el || !nat) return
    const r = el.getBoundingClientRect()
    const s = Math.min((r.width - 48) / nat.w, (r.height - 48) / nat.h, 4)
    setT({ s, x: (r.width - nat.w * s) / 2, y: (r.height - nat.h * s) / 2 })
  }, [nat])
  useEffect(() => { fit() }, [fit])
  useEffect(() => {
    const ro = new ResizeObserver(() => fit())
    if (stage.current) ro.observe(stage.current)
    return () => ro.disconnect()
  }, [fit])

  const toImg = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - view.x) / view.s / nat!.w, y: (e.clientY - r.top - view.y) / view.s / nat!.h }
  }
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1

  const onWheel = (e: React.WheelEvent) => {
    const r = stage.current!.getBoundingClientRect()
    const cx = e.clientX - r.left, cy = e.clientY - r.top
    const ns = Math.min(16, Math.max(0.05, view.s * Math.exp(-e.deltaY * 0.0016)))
    setT({ s: ns, x: cx - ((cx - view.x) * ns) / view.s, y: cy - ((cy - view.y) * ns) / view.s })
  }
  const onDown = (e: RPointerEvent) => {
    if (!nat || e.button !== 0) return
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* synthetic or lost pointer */ }
    const p = toImg(e)
    if (compareId && Math.abs(p.x - split) < 0.02 / view.s * 10 && mode === 'ver') { drag.current = { kind: 'split', sx: e.clientX, sy: e.clientY, tx: 0, ty: 0 }; return }
    if (mode === 'ver') { drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.x, ty: view.y }; return }
    if (!inside(p)) return
    drag.current = { kind: 'draw', sx: e.clientX, sy: e.clientY, tx: 0, ty: 0, px: p.x, py: p.y }
    if (mode === 'pin') setDraft({ x: p.x, y: p.y, shape: 'pin' })
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || !nat) return
    if (d.kind === 'pan') setT((o) => ({ ...o, x: d.tx + e.clientX - d.sx, y: d.ty + e.clientY - d.sy }))
    else if (d.kind === 'split') setSplit(Math.min(1, Math.max(0, toImg(e).x)))
    else if (d.kind === 'draw' && mode !== 'pin') {
      const p = toImg(e)
      if (mode === 'circle') setLive({ x: d.px, y: d.py, shape: 'circle', geom: { r: Math.hypot((p.x - d.px!) * nat.w, (p.y - d.py!) * nat.h) / nat.w } })
      if (mode === 'arrow') setLive({ x: p.x, y: p.y, shape: 'arrow', geom: { x2: d.px, y2: d.py } })
      if (mode === 'rect') setLive({ x: d.px, y: d.py, shape: 'rect', geom: { x2: Math.min(1, Math.max(0, p.x)), y2: Math.min(1, Math.max(0, p.y)) } })
      if (mode === 'pen') setLive((prev) => {
        const pts = prev?.shape === 'pen' && prev.geom?.pts ? prev.geom.pts : [[d.px!, d.py!] as [number, number]]
        const last = pts[pts.length - 1]
        if (Math.hypot((p.x - last[0]) * nat.w, (p.y - last[1]) * nat.h) < 3 / view.s) return prev
        return { x: d.px, y: d.py, shape: 'pen', geom: { pts: [...pts, [Math.min(1, Math.max(0, p.x)), Math.min(1, Math.max(0, p.y))]] } }
      })
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    const live = liveRef.current
    if (d?.kind === 'draw' && live) {
      const tooSmall = live.shape === 'rect' ? Math.abs(live.geom!.x2! - live.x!) < 0.01 || Math.abs(live.geom!.y2! - live.y!) < 0.01 : live.shape === 'pen' ? (live.geom?.pts?.length ?? 0) < 3 : live.shape === 'circle' ? (live.geom?.r ?? 0) < 0.005 : Math.hypot((live.x! - live.geom!.x2!), (live.y! - live.geom!.y2!)) < 0.01
      setDraft(tooSmall ? { x: d.px, y: d.py, shape: 'pin' } : live)
      setLive(undefined)
    }
  }

  return (
    <div
      ref={stage}
      className="absolute inset-0 overflow-hidden"
      style={{ cursor: mode === 'ver' ? (drag.current ? 'grabbing' : 'grab') : 'crosshair', touchAction: 'none' }}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={(e) => {
        if (mode !== 'ver' || !nat) return
        const r = stage.current!.getBoundingClientRect()
        const cx = e.clientX - r.left, cy = e.clientY - r.top
        const ns = view.s < 0.99 ? 1 : Math.min((r.width - 48) / nat.w, (r.height - 48) / nat.h)
        if (ns === 1) setT({ s: 1, x: cx - ((cx - view.x) * 1) / view.s, y: cy - ((cy - view.y) * 1) / view.s })
        else fit()
      }}
    >
      <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0', width: nat?.w, height: nat?.h }}>
        <img
          src={fileUrl(id)}
          alt=""
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ display: 'block', imageRendering: view.s > 2 ? 'pixelated' : 'auto', boxShadow: 'var(--shadow-2)' }}
        />
        {compareId && nat && (
          <>
            <img src={fileUrl(compareId)} alt="" draggable={false} className="absolute left-0 top-0" style={{ width: nat.w, height: nat.h, clipPath: `inset(0 0 0 ${split * 100}%)` }} />
            <div className="absolute top-0 bottom-0" style={{ left: split * nat.w, width: 0, borderLeft: `${2 / view.s}px solid white`, boxShadow: '0 0 12px rgb(0 0 0 / 0.5)' }} />
          </>
        )}
        {nat && <Marks comments={comments} draft={live ?? draft} w={nat.w} h={nat.h} s={view.s} hover={hover} />}
      </div>
      <div className="absolute left-4 bottom-4 flex items-center gap-2 t-small">
        <span className="pill num" style={{ background: 'var(--chrome)', backdropFilter: 'blur(12px)' }}>{Math.round(view.s * 100)} %</span>
        {compareId && <span className="pill" style={{ background: 'var(--chrome)', backdropFilter: 'blur(12px)' }}><Columns2 size={12} /> {t('izquierda: esta · derecha: la otra versión (arrastra la línea en modo Mover)')}</span>}
      </div>
    </div>
  )
}

// ---- video stage: frame stepping, comments at a second, frame capture ---------------------------------------------

function VideoStage({ id, mode, comments, draft, setDraft }: { id: number; mode: Mode; comments: Comment[]; draft?: Draft; setDraft: (d?: Draft) => void }) {
  const v = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const fps = 30
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      const el = v.current
      if (!el) return
      if (e.key === ' ') { e.preventDefault(); el.paused ? void el.play() : el.pause() }
      if (e.key === '.') { el.pause(); el.currentTime = Math.min(el.duration, el.currentTime + (e.shiftKey ? 1 : 1 / fps)) }
      if (e.key === ',') { el.pause(); el.currentTime = Math.max(0, el.currentTime - (e.shiftKey ? 1 : 1 / fps)) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const capture = (): string | undefined => {
    const el = v.current
    if (!el || !el.videoWidth) return undefined
    const c = document.createElement('canvas')
    c.width = el.videoWidth
    c.height = el.videoHeight
    c.getContext('2d')!.drawImage(el, 0, 0)
    try { return c.toDataURL('image/png') } catch { return undefined }
  }
  const commentHere = (pt?: { x: number; y: number }) => {
    const el = v.current
    if (!el) return
    el.pause()
    setDraft({ timeSec: el.currentTime, frame: capture(), shape: 'pin', ...(pt ?? {}) })
  }
  const onClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    const el = v.current!
    if (mode === 'ver') { el.paused ? void el.play() : el.pause(); return }
    // Point in the frame (object-fit: contain letterboxing).
    const r = el.getBoundingClientRect()
    const s = Math.min(r.width / el.videoWidth, r.height / el.videoHeight)
    const ox = (r.width - el.videoWidth * s) / 2, oy = (r.height - el.videoHeight * s) / 2
    const x = (e.clientX - r.left - ox) / (el.videoWidth * s), y = (e.clientY - r.top - oy) / (el.videoHeight * s)
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) commentHere({ x, y })
  }
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-6">
        <video
          ref={v}
          src={fileUrl(id)}
          className="max-w-full max-h-full rounded-lg"
          style={{ boxShadow: 'var(--shadow-2)', cursor: mode === 'ver' ? 'default' : 'crosshair' }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={onClick}
          preload="auto"
        />
      </div>
      <div className="px-6 pb-5">
        <div className="relative h-8 flex items-center">
          <input type="range" min={0} max={dur || 0} step={1 / fps} value={time} onChange={(e) => { if (v.current) v.current.currentTime = Number(e.target.value) }} className="w-full accent-[var(--accent)]" aria-label={t('Línea de tiempo')} />
          {dur > 0 && comments.filter((c) => c.timeSec != null).map((c) => (
            <button key={c.id} className="absolute -top-1 w-2.5 h-2.5 rounded-full border-0 p-0" style={{ left: `calc(${(c.timeSec! / dur) * 100}% - 5px)`, background: c.status === 'aprobado' ? 'var(--green)' : 'var(--red)' }} title={c.body} onClick={() => { if (v.current) v.current.currentTime = c.timeSec! }} />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button className="btn btn-sm btn-icon" onClick={() => { const el = v.current!; el.pause(); el.currentTime = Math.max(0, el.currentTime - 1 / fps) }} title={t('Fotograma anterior (,)')}><ChevronLeft size={15} /></button>
          <button className="btn btn-sm btn-icon" onClick={() => { const el = v.current!; el.paused ? void el.play() : el.pause() }} title={t('Reproducir o pausar (espacio)')}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <button className="btn btn-sm btn-icon" onClick={() => { const el = v.current!; el.pause(); el.currentTime = Math.min(el.duration, el.currentTime + 1 / fps) }} title={t('Fotograma siguiente (.)')}><ChevronRight size={15} /></button>
          <span className="t-small num c2 ml-1">{fmtT(time)} <span className="c4">/ {fmtT(dur)}</span></span>
          <span className="t-small c4 ml-2 hidden min-[900px]:inline">{t('Paso a paso: , y . (con Mayús, 1 s) · el paso supone 30 fps')}</span>
          <button className="btn btn-sm btn-primary ml-auto" onClick={() => commentHere()} disabled={Boolean(draft)}><Camera size={13} /> {t('Comentar en {v0}', { v0: fmtT(time) })}</button>
        </div>
      </div>
    </div>
  )
}

/** Thumbnails of the neighbouring files, like the strip under a photo on the iPhone. The current one stays centred. */
function Filmstrip({ list, current, onPick }: { list: number[]; current: number; onPick: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const i = list.indexOf(current)
  const from = Math.max(0, i - 40)
  const shown = list.slice(from, i + 41)
  // Mouse wheel over the strip steps through the files (one per notch, quickly), like scrubbing in Photos.
  const lastWheel = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const now = performance.now()
      if (now - lastWheel.current < 70) return
      lastWheel.current = now
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      const j = list.indexOf(current) + (d > 0 ? 1 : -1)
      if (j >= 0 && j < list.length) onPick(list[j])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [list, current, onPick])
  useEffect(() => {
    const el = ref.current?.querySelector('[data-current="1"]') as HTMLElement | null
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [current])
  return (
    <div ref={ref} className="flex-none flex gap-1.5 px-4 py-2.5 overflow-x-auto items-center" style={{ borderTop: '0.5px solid var(--sep)', scrollbarWidth: 'none' }}>
      {shown.map((id) => (
        <button key={id} data-current={id === current ? '1' : undefined} onClick={() => onPick(id)}
          className="flex-none p-0 border-0 rounded-md overflow-hidden transition-all"
          style={{ height: id === current ? 58 : 46, aspectRatio: '4 / 3', background: 'var(--fill)', boxShadow: id === current ? '0 0 0 2px var(--accent)' : undefined, opacity: id === current ? 1 : 0.72 }}>
          <img src={thumbUrl(id, 160)} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        </button>
      ))}
    </div>
  )
}
