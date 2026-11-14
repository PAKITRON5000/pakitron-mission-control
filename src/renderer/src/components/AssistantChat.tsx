import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowUp, ChevronRight, Sparkles, Send, X, PenLine, Bot, Check } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { api, thumbUrl } from '../lib/api'
import { ask, askClaude, cancelPlan, sendPlan, useChat, type ChatMsg, type Reply } from '../lib/assistantChat'
import type { Go } from '../../../core/assistant'
import { Avatar, Bar, SPRING, nameify } from './ui'

/** The assistant's face: the app's own colours, breathing slowly while it thinks. */
export function Orb({ size = 40, thinking }: { size?: number; thinking?: boolean }) {
  return (
    <motion.span
      className="flex items-center justify-center flex-none relative"
      style={{ width: size, height: size, borderRadius: 999, background: 'radial-gradient(circle at 30% 28%, color-mix(in srgb, white 45%, var(--indigo)), var(--indigo) 45%, var(--pink) 100%)', color: 'white', boxShadow: '0 4px 18px color-mix(in srgb, var(--indigo) 40%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.4)' }}
      animate={thinking ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={thinking ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : SPRING}
      aria-hidden
    >
      <Sparkles size={size * 0.46} strokeWidth={2.2} />
    </motion.span>
  )
}

/** Where a row of an answer leads: into its project first when it is another one. */
export function useGo() {
  const { state, go, jump, setAgentOpen, setViewer } = useStore()
  return async (to: Go, list?: number[]) => {
    if ('agent' in to) { setAgentOpen(to.agent); return }
    if ('asset' in to) { setViewer(to.asset, list); return }
    if (to.projectId && to.projectId !== state?.activeProjectId) await api('setActiveProject', to.projectId)
    if (to.focus) jump(to.route as Route, to.focus)
    else go(to.route as Route)
  }
}

function Answer({ m, compact }: { m: ChatMsg; compact?: boolean }) {
  const { state, openComposer } = useStore()
  const run = useGo()
  const r: Reply | undefined = m.reply
  const photoIds = r?.photos?.map((p) => p.id) ?? []
  return (
    <div className="min-w-0 flex-1 flex flex-col gap-2">
      <div className="t-body selectable whitespace-pre-wrap" style={{ fontSize: compact ? 13.5 : 14.5, lineHeight: 1.5 }}>{nameify(m.text)}</div>
      {r?.by && <div className="t-small flex items-center gap-1.5" style={{ color: 'var(--indigo)' }}><Bot size={13} /> {nameify(r.by)}</div>}
      {r?.rows && r.rows.length > 0 && (
        <div className="flex flex-col rounded-xl overflow-hidden" style={{ background: 'var(--fill)' }}>
          {r.rows.map((x, i) => {
            const body = (
              <>
                {x.account ? <Avatar id={x.account as any} size={compact ? 24 : 28} /> : <span className="flex-none rounded-full" style={{ width: 9, height: 9, margin: compact ? '0 7px' : '0 9px', background: x.color ?? 'var(--label-3)' }} />}
                <span className="min-w-0 flex-1 flex flex-col">
                  <span className="truncate" style={{ fontWeight: 600, fontSize: compact ? 13 : 13.5 }}>{nameify(x.title)}</span>
                  {x.sub && <span className="t-small c3" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{nameify(x.sub)}</span>}
                  {x.meter && <span className="flex items-center gap-2 mt-1"><span className="flex-1"><Bar pct={x.meter.pct} color={x.meter.pct <= 10 ? 'linear-gradient(90deg, #FF6B60, #FF3B30)' : x.meter.pct <= 25 ? 'linear-gradient(90deg, #FFC043, #FF9F0A)' : 'linear-gradient(90deg, #34C759, #30D158)'} /></span><span className="t-small c3 num flex-none">{x.meter.label}</span></span>}
                </span>
                {x.go && <ChevronRight size={14} className="c3 flex-none" />}
              </>
            )
            const style = { borderTop: i ? '0.5px solid var(--sep)' : undefined, padding: compact ? '7px 9px' : '9px 12px' }
            return x.go
              ? <button key={i} className="w-full text-left flex items-center gap-2.5 border-0 bg-transparent hover:bg-[var(--fill-2)]" style={style} onClick={() => void run(x.go!)}>{body}</button>
              : <div key={i} className="flex items-center gap-2.5" style={style}>{body}</div>
          })}
        </div>
      )}
      {r?.photos && r.photos.length > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 76 : 112}px, 1fr))` }}>
          {r.photos.map((p, i) => (
            <motion.button key={p.id} className="border-0 p-0 rounded-lg overflow-hidden relative" style={{ aspectRatio: '4 / 3', background: 'var(--fill)' }} title={p.name}
              initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...SPRING, delay: Math.min(i, 10) * 0.03 }}
              whileHover={{ scale: 1.03 }} onClick={() => void run({ asset: p.id }, photoIds)}>
              <img src={thumbUrl(p.id, compact ? 200 : 300)} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
            </motion.button>
          ))}
        </div>
      )}
      {r?.send && (
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'color-mix(in srgb, var(--indigo) 10%, var(--bg-elev))', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--indigo) 30%, transparent)' }}>
          <div className="flex items-center gap-2 min-w-0">
            {r.send.target ? <Avatar id={r.send.target as any} size={26} /> : <Send size={15} style={{ color: 'var(--indigo)' }} />}
            <span className="t-small" style={{ fontWeight: 650 }}>Para {nameify(r.send.who)} · {r.send.project}</span>
          </div>
          <div className="t-small c2 selectable" style={{ fontStyle: 'italic' }}>«{r.send.body.length > 240 ? r.send.body.slice(0, 240) + '…' : r.send.body}»</div>
          {m.done === 'enviado' ? <div className="t-small flex items-center gap-1.5" style={{ color: 'var(--green)', fontWeight: 600 }}><Check size={14} /> Enviado</div>
            : m.done === 'cancelado' ? <div className="t-small c3">No se ha enviado.</div>
            : (
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-sm btn-primary" onClick={() => void sendPlan(m.id)}><Send size={12} /> {r.send.kind === 'idea' || r.send.kind === 'nota' ? 'Guardar' : 'Enviar'}</button>
                <button className="btn btn-sm" title="Abre «Nueva instrucción» con este texto para cambiar destino o tipo" onClick={() => { cancelPlan(m.id); openComposer({ text: r.send!.body, target: r.send!.target }) }}><PenLine size={12} /> Cambiar…</button>
                <button className="btn btn-sm btn-ghost" onClick={() => cancelPlan(m.id)}><X size={12} /> No</button>
              </div>
            )}
        </div>
      )}
      {r?.offerClaude && !m.done && (
        <div>
          <button className="btn btn-sm" style={{ color: 'var(--indigo)' }} title="Se lo pregunta a Haiku con la cuenta que más semana tiene, dándole lo que sabe la app. Gasta un poco de uso." onClick={() => void askClaude(m.id, state?.activeProjectId)}><Bot size={13} /> Pregúntale a Claude <span className="c3">(gasta un poco de uso)</span></button>
        </div>
      )}
      {r?.more && <div><button className="btn btn-sm btn-ghost" style={{ color: 'var(--accent)', paddingLeft: 0 }} onClick={() => void run(r.more!.go)}>{r.more.label} <ChevronRight size={13} /></button></div>}
    </div>
  )
}

function Bubble({ m, compact, last }: { m: ChatMsg; compact?: boolean; last: boolean }) {
  if (m.from === 'tu') {
    return (
      <motion.div className="flex justify-end" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
        <div className="selectable whitespace-pre-wrap" style={{ maxWidth: '82%', background: 'var(--accent)', color: 'white', padding: compact ? '7px 12px' : '9px 14px', borderRadius: '16px 16px 4px 16px', fontSize: compact ? 13.5 : 14.5, lineHeight: 1.45 }}>{m.text}</div>
      </motion.div>
    )
  }
  return (
    <motion.div className="flex gap-2.5 items-start" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
      <Orb size={compact ? 26 : 32} thinking={m.pending && last} />
      {m.pending ? <span className="typing mt-2" style={{ color: 'var(--indigo)' }}><i /><i /><i /></span> : <Answer m={m} compact={compact} />}
    </motion.div>
  )
}

/** The conversation and the box to write in: the same in the bubble and in its own screen. */
export function AssistantChat({ compact, empty }: { compact?: boolean; empty?: React.ReactNode }) {
  const { state } = useStore()
  const msgs = useChat()
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = msgs.some((m) => m.pending)
  // With nothing said yet the welcome shows from its top (13-11: scrolled to the end, its orb was cut under the title).
  useEffect(() => { if (msgs.length) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [msgs.length, msgs[msgs.length - 1]?.pending])
  useEffect(() => { setTimeout(() => input.current?.focus(), 80) }, [])
  const submit = (t = text) => { if (!t.trim() || busy) return; void ask(t, state?.activeProjectId); setText('') }
  const lastApp = [...msgs].reverse().find((m) => m.from === 'app' && !m.pending)
  const chips = lastApp?.reply?.chips ?? []
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3" style={{ padding: compact ? '12px 12px 6px' : '8px 4px 10px' }}>
        {msgs.length === 0 && empty}
        {msgs.map((m, i) => <Bubble key={m.id} m={m} compact={compact} last={i === msgs.length - 1} />)}
      </div>
      <AnimatePresence initial={false}>
        {chips.length > 0 && !busy && (
          <motion.div className="flex gap-1.5 overflow-x-auto flex-none" style={{ padding: compact ? '4px 12px' : '4px 4px 6px', scrollbarWidth: 'none' }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {chips.map((c) => <button key={c} className="chip flex-none" onClick={() => submit(nameify(c))}>{nameify(c)}</button>)}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-2 flex-none" style={{ padding: compact ? '8px 10px 10px' : '6px 0 0' }}>
        <textarea ref={input} rows={1} className="field flex-1 t-body" style={{ resize: 'none', minHeight: compact ? 36 : 44, maxHeight: 140, padding: compact ? '8px 12px' : '11px 14px', borderRadius: 14, fontSize: compact ? 13.5 : 14.5 }}
          placeholder={compact ? 'Pregunta o pide algo…' : 'Pregúntame lo que quieras o pídeme algo para un Claude…'} value={text}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px' }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} aria-label="Escribe al asistente" />
        <motion.button className="btn btn-primary btn-icon flex-none" style={{ width: compact ? 36 : 44, height: compact ? 36 : 44, borderRadius: 999 }} disabled={!text.trim() || busy} onClick={() => submit()} aria-label="Enviar" whileTap={{ scale: 0.9 }}>
          <ArrowUp size={compact ? 17 : 20} strokeWidth={2.5} />
        </motion.button>
      </div>
    </div>
  )
}
