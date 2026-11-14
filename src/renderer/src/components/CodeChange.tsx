// EV138: the code a task changed, in Revisar, with a comment on any line. The comments go together as the change the user
// asks for (core/changes.ts › askChange), so they reach the Claude as «Revisión del usuario», like any other note.
import { t } from '../../../core/i18n'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Code2, MessageSquarePlus, Send, X } from 'lucide-react'
import { useAsync } from '../lib/store'
import { api } from '../lib/api'
import { whenFull } from '../lib/format'
import { lineNote, type DiffLine, type TaskCommit } from '../../../core/taskdiff'

interface Comment { key: string; path: string; commit: string; line: DiffLine; text: string }

const MONO = "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, ui-monospace, monospace"
const tint = (l: DiffLine) => (l.kind === 'add' ? 'color-mix(in srgb, var(--green) 14%, transparent)' : l.kind === 'del' ? 'color-mix(in srgb, var(--red) 14%, transparent)' : 'transparent')

export function CodeChange({ pid, taskId, who, busy, onSend }: { pid?: string; taskId: number; who?: string; busy: boolean; onSend: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const d = useAsync(() => (open && pid ? api<TaskCommit[]>('taskDiff', pid, taskId) : Promise.resolve(undefined)), [open, pid, taskId])
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const [at, setAt] = useState<string>()
  const [draft, setDraft] = useState('')
  const [comments, setComments] = useState<Comment[]>([])
  const commits = d.data ?? []
  const files = commits.reduce((n, c) => n + c.files.length, 0)
  const add = (c: Omit<Comment, 'text'>) => {
    if (!draft.trim()) return
    setComments((list) => [...list.filter((x) => x.key !== c.key), { ...c, text: draft.trim() }])
    setAt(undefined)
    setDraft('')
  }
  const send = () => {
    onSend(t('Comentarios en el código:\n{v0}', { v0: comments.map((c) => lineNote(c)).join('\n') }))
    setComments([])
  }
  return (
    <div className="flex flex-col gap-2">
      <button className="btn btn-sm btn-ghost self-start" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <Code2 size={13} /> {t('El código que cambió')}
        {open && !d.loading && <span className="c3">· {commits.length ? `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}, ${files} ${files === 1 ? 'archivo' : 'archivos'}` : 'nada'}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {d.loading && <div className="t-small c3">{t('Leyendo el historial…')}</div>}
          {!d.loading && !commits.length && <div className="t-small c3 rounded-xl px-3 py-2" style={{ background: 'var(--fill)' }}>{t('Ningún commit nombra esta tarea fuera de los documentos de seguimiento: no hay código que revisar.')}</div>}
          {commits.length > 0 && <div className="t-small c3">{t('Pulsa una línea para comentarla; los comentarios le llegan juntos a {v0} como cambio pedido.', { v0: who ?? t('quien la haga') })}</div>}
          {commits.map((c) => (
            <div key={c.hash} className="rounded-xl overflow-hidden" style={{ boxShadow: 'inset 0 0 0 1px var(--sep)' }}>
              <div className="px-3 py-1.5 t-small" style={{ background: 'var(--fill)' }}><b>{c.subject.length > 140 ? `${c.subject.slice(0, 140)}…` : c.subject}</b> <span className="c3">· {whenFull(c.at)} · {c.hash.slice(0, 7)}</span></div>
              {c.files.map((f) => {
                const fk = `${c.hash}|${f.path}`
                const closed = shut[fk] ?? c.files.length > 3
                return (
                  <div key={fk}>
                    <button className="w-full text-left px-3 py-1 t-small flex items-center gap-1.5" style={{ fontFamily: MONO, boxShadow: '0 -0.5px 0 var(--sep)' }} onClick={() => setShut({ ...shut, [fk]: !closed })}>
                      {closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span className="truncate min-w-0">{f.path}</span>
                      <span style={{ color: 'var(--green)' }}>+{f.added}</span><span style={{ color: 'var(--red)' }}>−{f.removed}</span>
                    </button>
                    {!closed && (f.binary ? <div className="px-3 pb-2 t-small c3">{t('Archivo que no es texto (imagen, sonido…).')}</div> : (
                      <div style={{ fontFamily: MONO, fontSize: 12, overflowX: 'auto' }}>
                        {f.hunks.map((h, hi) => (
                          <div key={hi}>
                            <div className="px-3 c3" style={{ background: 'var(--fill)' }}>{h.header || '···'}</div>
                            {h.lines.map((l, li) => {
                              const key = `${fk}|${hi}|${li}`
                              const mine = comments.find((x) => x.key === key)
                              return (
                                <div key={li}>
                                  <button className="w-full text-left flex" style={{ background: tint(l), cursor: 'pointer', whiteSpace: 'pre' }} title={t('Comentar esta línea')} onClick={() => { setAt(at === key ? undefined : key); setDraft(mine?.text ?? '') }}>
                                    <span className="c3 text-right select-none" style={{ width: 44, flex: 'none', paddingRight: 8 }}>{l.newNo ?? l.oldNo}</span>
                                    <span className="select-none" style={{ width: 14, flex: 'none', color: l.kind === 'add' ? 'var(--green)' : l.kind === 'del' ? 'var(--red)' : 'var(--label-3)' }}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                                    <span>{l.text || ' '}</span>
                                    {mine && <MessageSquarePlus size={12} style={{ marginLeft: 8, flex: 'none', color: 'var(--indigo)' }} />}
                                  </button>
                                  {at === key && (
                                    <div className="flex flex-col gap-1.5 px-3 py-2" style={{ background: 'var(--fill)', fontFamily: 'var(--font)', whiteSpace: 'normal', position: 'sticky', left: 0, maxWidth: 560 }}>
                                      <textarea className="field t-small" rows={2} autoFocus placeholder={t('Qué hay que cambiar aquí')} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical', whiteSpace: 'pre-wrap' }} />
                                      <div className="flex gap-1.5">
                                        <button className="btn btn-sm btn-primary" disabled={!draft.trim()} onClick={() => add({ key, path: f.path, commit: c.hash, line: l })}>{mine ? t('Cambiar el comentario') : t('Añadir el comentario')}</button>
                                        {mine && <button className="btn btn-sm" onClick={() => { setComments(comments.filter((x) => x.key !== key)); setAt(undefined) }}>{t('Quitarlo')}</button>}
                                        <button className="btn btn-sm btn-ghost" onClick={() => setAt(undefined)}><X size={13} /> {t('Cancelar')}</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                        {f.cut ? <div className="px-3 py-1 t-small c3">{t('… y {cut} líneas más que no se enseñan.', { cut: f.cut })}</div> : null}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
          {comments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'color-mix(in srgb, var(--indigo) 14%, transparent)' }}>
              <span className="t-small">{t('{v0} sin enviar', { v0: comments.length === 1 ? t('1 comentario') : t('{length} comentarios', { length: comments.length }) })}</span>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={send}><Send size={13} /> {t('Enviar{v0}', { v0: who ? t(' a {who}', { who: who }) : '' })}</button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setComments([])}>{t('Descartarlos')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
