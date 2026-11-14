import { motion } from 'motion/react'
import { Gavel, Users, Gauge, Moon, Repeat, Images, ListChecks, HelpCircle, RotateCcw } from 'lucide-react'
import { useStore } from '../lib/store'
import { ask, clearChat, useChat } from '../lib/assistantChat'
import { AssistantChat, Orb } from '../components/AssistantChat'
import { SPRING } from '../components/ui'

/**
 * The assistant's own screen (EV85, Decidir #127: «un apartado visual para él»): the same conversation as the bubble, with
 * room for photos and lists, and what it can do as big buttons when the conversation is empty.
 */
export function Assistant() {
  const { state } = useStore()
  const msgs = useChat()
  const project = state?.projects.find((p) => p.id === state.activeProjectId)
  const tiles = [
    { q: '¿Qué me espera?', sub: 'Preguntas y cosas para revisar', icon: Gavel, color: 'var(--red)' },
    { q: '¿Quién trabaja?', sub: 'Dónde está cada Claude', icon: Users, color: 'var(--green)' },
    { q: '¿Cuánto uso queda?', sub: 'Semana y 5 horas de cada cuenta', icon: Gauge, color: 'var(--blue)' },
    { q: '¿Qué hicieron anoche?', sub: 'Tareas, commits y relevos', icon: Moon, color: 'var(--indigo)' },
    { q: '¿Cómo va la rueda?', sub: 'Quién tiene el turno y quién sigue', icon: Repeat, color: 'var(--orange)' },
    { q: `¿Qué queda en ${project?.name ?? 'el proyecto'}?`, sub: 'Las siguientes tareas', icon: ListChecks, color: 'var(--teal)' },
    { q: 'Fotos de hoy', sub: 'O «fotos del glaciar», de lo que sea', icon: Images, color: 'var(--pink)' },
    { q: '¿Qué puedes hacer?', sub: 'Y cómo pedirle algo a un Claude', icon: HelpCircle, color: 'var(--purple)' }
  ]
  const empty = (
    <div className="flex flex-col items-center text-center pt-[4vh] pb-4">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', bounce: 0.35, duration: 0.6 }}><Orb size={76} /></motion.div>
      <div className="t-display mt-4">¿En qué te ayudo?</div>
      <div className="t-head c2 mt-2 max-w-[560px]" style={{ fontWeight: 450 }}>Pregúntame lo que quieras de tus proyectos: te contesto con lo que ya sabe la app, <b>sin gastar uso</b>. Si me pides algo, se lo paso al Claude que tenga el turno y te digo cuándo lo verá.</div>
      <div className="grid gap-2.5 mt-7 w-full max-w-[760px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
        {tiles.map((t, i) => {
          const I = t.icon
          return (
            <motion.button key={t.q} className="card text-left border-0 p-3.5 flex flex-col gap-2" style={{ cursor: 'pointer' }} onClick={() => void ask(t.q, state?.activeProjectId)}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.05 + i * 0.035 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
              <span className="icon-sq icon-sq-lg" style={{ background: t.color }}><I size={15} strokeWidth={2.3} /></span>
              <span style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.25 }}>{t.q}</span>
              <span className="t-small c3">{t.sub}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
  return (
    <div className="h-full flex flex-col mx-auto w-full" style={{ maxWidth: 880, padding: '18px 24px 18px' }}>
      <div className="flex items-center gap-3 flex-none mb-2">
        <Orb size={30} />
        <h1 className="t-title m-0">Asistente</h1>
        <span className="t-small c3 truncate">contesta con los datos de la app · para pedir algo, escríbelo tal cual</span>
        {msgs.length > 0 && <button className="btn btn-sm btn-ghost ml-auto flex-none" onClick={clearChat} title="Empieza una conversación nueva"><RotateCcw size={13} /> Nueva</button>}
      </div>
      <div className="flex-1 min-h-0">
        <AssistantChat empty={empty} />
      </div>
    </div>
  )
}
