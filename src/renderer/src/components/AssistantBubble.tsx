import { t } from '../../../core/i18n'
import { useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Maximize2, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { setPanel, usePanel, useChat, ask } from '../lib/assistantChat'
import { AssistantChat, Orb } from './AssistantChat'
import { SPRING } from './ui'

/**
 * The assistant always at hand (EV85): its orb in the title bar, next to Buscar (Ctrl+J). Floating at the bottom left it
 * covered the screens' text (13-11 capture: «Para ti» read «ra ti»), so it lives up there and opens a panel below it.
 */
export function AssistantButton() {
  const { route } = useStore()
  const open = usePanel()
  const msgs = useChat()
  if (route === 'asistente') return null
  return (
    <motion.button className="no-drag border-0 bg-transparent p-0 flex items-center gap-1.5 rounded-full" onClick={() => setPanel(!open)} title={t('Asistente: pregúntale lo que quieras o pídele algo para un Claude (Ctrl+J)')} aria-label={t('Asistente')} aria-expanded={open}
      whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }}>
      <Orb size={30} thinking={msgs.some((m) => m.pending)} />
    </motion.button>
  )
}

/** The panel under the title bar, with the same conversation as the assistant's own screen. */
export function AssistantBubble() {
  const { route, go, state } = useStore()
  const open = usePanel()
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  useEffect(() => { if (route === 'asistente') setPanel(false) }, [route])
  if (route === 'asistente' || route === 'flotante') return null
  const starters = [t('¿Qué me espera?'), t('¿Quién trabaja?'), t('¿Cuánto uso queda?'), t('¿Qué hicieron anoche?')]
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="assistant-panel" role="dialog" aria-label={t('Asistente')}
          initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={SPRING} style={{ transformOrigin: 'top right' }}>
          <div className="flex items-center gap-2 px-3 py-2.5 flex-none" style={{ borderBottom: '0.5px solid var(--sep)' }}>
            <Orb size={26} />
            <span className="t-head">{t('Asistente')}</span>
            <span className="t-small c3 truncate">{t('sin gastar uso')}</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button className="btn btn-sm btn-icon btn-ghost" title={t('Abrir en grande')} onClick={() => go('asistente')}><Maximize2 size={14} /></button>
              <button className="btn btn-sm btn-icon btn-ghost" title={t('Cerrar (Esc)')} onClick={() => setPanel(false)}><X size={15} /></button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <AssistantChat compact empty={
              <div className="flex flex-col items-center text-center gap-2 py-4 px-2">
                <Orb size={48} />
                <div className="t-head mt-1">{t('¿En qué te ayudo?')}</div>
                <div className="t-small c3">{t('Pregúntame por tus proyectos o pídeme algo para un Claude.')}</div>
                <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                  {starters.map((q) => <button key={q} className="chip" onClick={() => void ask(q, state?.activeProjectId)}>{q}</button>)}
                </div>
              </div>
            } />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
