import { t } from '../../../core/i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { SPRING } from './ui'

// Only one sound plays at a time, in the whole app.
let playing: HTMLAudioElement | null = null
const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––')

/** A sound with its play button and its bar to jump: in Decidir, in a task and in the gallery. */
export function SoundRow({ src, caption, sub, right }: { src: string; caption: string; sub?: string; right?: ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [pos, setT] = useState(0)
  const [dur, setDur] = useState(NaN)
  const [on, setOn] = useState(false)
  useEffect(() => () => { if (playing === ref.current) { ref.current?.pause(); playing = null } }, [])
  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--fill)', transition: 'background 160ms' }}>
      <audio ref={ref} src={src} preload="none"
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onPlay={() => { if (playing && playing !== ref.current) playing.pause(); playing = ref.current; setOn(true) }}
        onPause={() => setOn(false)} onEnded={() => { setOn(false); setT(0) }} />
      <button className="flex-none w-10 h-10 rounded-full border-0 flex items-center justify-center" style={{ background: 'var(--accent)', color: 'white', boxShadow: on ? '0 0 0 4px var(--accent-soft)' : undefined }} onClick={toggle} aria-label={on ? t('Pausa') : t('Escuchar')}>
        {on ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="t-body truncate" style={{ fontWeight: 600 }}>{caption}</span>
          {on && <span className="eq" aria-hidden><i /><i /><i /><i /></span>}
        </div>
        {sub && !on && <div className="t-small c3 truncate">{sub}</div>}
        {(on || pos > 0) && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-[5px] rounded-full cursor-pointer relative" style={{ background: 'var(--fill-2)' }}
              onClick={(e) => { const el = ref.current; if (!el || !Number.isFinite(dur)) return; const r = e.currentTarget.getBoundingClientRect(); el.currentTime = ((e.clientX - r.left) / r.width) * dur; if (el.paused) void el.play() }}>
              <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${Number.isFinite(dur) && dur > 0 ? (pos / dur) * 100 : 0}%`, background: 'var(--accent)' }} />
            </div>
            <span className="t-small c3 num flex-none">{mmss(pos)} / {mmss(dur)}</span>
          </div>
        )}
      </div>
      {right}
    </div>
  )
}

export interface LightItem { src: string; caption?: string; group?: string }

/** A picture seen big, walking through the others with the arrows. */
export function Lightbox({ items, start, onClose }: { items: LightItem[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const n = items.length
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n)
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [n, onClose])
  const it = items[i]
  return (
    <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.img key={i} src={it?.src} alt={it?.caption} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING} onClick={(e) => e.stopPropagation()} />
      <div className="absolute left-0 right-0 bottom-5 text-center t-small" style={{ color: 'rgb(255 255 255 / 0.85)' }}>{t('{v0}{v1} · {v2} de {n}', { v0: it?.caption, v1: it?.group ? ` · ${it.group}` : '', v2: i + 1, n: n })}</div>
      {n > 1 && <>
        <button className="btn btn-icon absolute left-5 top-1/2" style={{ background: 'rgb(255 255 255 / 0.14)', color: 'white' }} onClick={(e) => { e.stopPropagation(); setI((x) => (x - 1 + n) % n) }} aria-label={t('Anterior')}><ChevronLeft size={18} /></button>
        <button className="btn btn-icon absolute right-5 top-1/2" style={{ background: 'rgb(255 255 255 / 0.14)', color: 'white' }} onClick={(e) => { e.stopPropagation(); setI((x) => (x + 1) % n) }} aria-label={t('Siguiente')}><ChevronRight size={18} /></button>
      </>}
      <button className="btn btn-icon absolute right-5 top-5" style={{ background: 'rgb(255 255 255 / 0.14)', color: 'white' }} onClick={onClose} aria-label={t('Cerrar')}><X size={18} /></button>
    </motion.div>
  )
}
