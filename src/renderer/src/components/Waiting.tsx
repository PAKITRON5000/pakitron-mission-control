import { motion, AnimatePresence } from 'motion/react'
import { Gavel, ListChecks, MessageSquareText } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { SPRING } from './ui'

/**
 * What waits for the user, project by project, always in sight in the title bar (the user, 12-11: «si trabajo en un
 * proyecto y otro a la vez, debería poder ver de un vistazo en qué proyecto se me está haciendo decidir algo»).
 * One pill per project with something pending, in its colour; one click opens that project where it waits.
 */
export function Waiting() {
  const { state, go } = useStore()
  const pending = state?.pending ?? {}
  const rows = (state?.projects ?? []).map((p) => ({ p, x: pending[p.id] })).filter((r) => r.x && (r.x.decisions || r.x.review || r.x.comments))
  if (!rows.length) return null
  const open = async (pid: string, route: 'decisiones' | 'tareas' | 'revisiones') => {
    if (pid !== state?.activeProjectId) await api('setActiveProject', pid)
    go(route)
  }
  return (
    <div className="no-drag flex items-center gap-1.5 min-w-0 overflow-hidden" aria-label="Lo que te espera en cada proyecto">
      <span className="t-small c3 flex-none hidden min-[1100px]:inline">Te esperan</span>
      <AnimatePresence initial={false}>
        {rows.map(({ p, x }) => {
          const other = p.id !== state?.activeProjectId
          const route = x!.decisions ? 'decisiones' : x!.review ? 'tareas' : 'revisiones'
          const title = [x!.decisions && `${x!.decisions} ${x!.decisions === 1 ? 'pregunta' : 'preguntas'} en Decidir`, x!.review && `${x!.review} para revisar en Tareas`, x!.comments && `${x!.comments} en Revisar`].filter(Boolean).join(' · ')
          return (
            <motion.button key={p.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING}
              className={`flex items-center gap-1.5 h-[28px] pl-2 pr-1 rounded-full border-0 flex-none ${other && x!.decisions ? 'waiting-pulse' : ''}`}
              style={{ background: `color-mix(in srgb, ${p.color} 16%, var(--fill))`, boxShadow: other && x!.decisions ? `inset 0 0 0 1.5px ${p.color}` : 'none' }}
              onClick={() => void open(p.id, route)} title={`${p.name}: ${title}${other ? ' (otro proyecto: pulsa para ir)' : ''}`}>
              <span className="dot" style={{ background: p.color }} />
              <span className="t-small truncate max-w-[140px]" style={{ fontWeight: 620 }}>{p.name}</span>
              {x!.decisions > 0 && <span className="pill num" style={{ background: 'var(--red)', color: 'white', height: 20, padding: '0 7px', gap: 4 }}><Gavel size={11} />{x!.decisions}</span>}
              {x!.review > 0 && <span className="pill num" style={{ background: 'var(--orange)', color: 'white', height: 20, padding: '0 7px', gap: 4 }}><ListChecks size={11} />{x!.review}</span>}
              {x!.comments > 0 && <span className="pill num" style={{ background: 'var(--yellow)', color: '#3a2a00', height: 20, padding: '0 7px', gap: 4 }}><MessageSquareText size={11} />{x!.comments}</span>}
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
