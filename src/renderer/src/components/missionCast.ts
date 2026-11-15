import { t } from '../../../core/i18n'
// Who stands where on the mission map (EV84), from what the app already knows. Kept apart from the drawing so it can be
// tested: a Claude at work walks to its project, one waiting for the user calls from there, one with usage waits by the
// wheel and one without usage sleeps recharging until its time comes back.
import type { AgentCard } from '../../../core/types'
import type { RelayChain } from '../../../core/chain'
import { isSessionWorking } from '../../../core/working'
export type CharacterMood = 'trabaja' | 'espera' | 'duerme' | 'llama'

export interface CastMember {
  id: string
  color: string
  alias: string
  where: 'base' | 'proyecto' | 'recarga'
  projectId?: string
  mood: CharacterMood
  /** The status, as on a pilot's card: «★ En misión», «Lista, espera su turno»… */
  label: string
  tone: 'gold' | 'teal' | 'red' | 'orange' | 'gray'
  backAt?: number
  /** It holds the turn of the wheel of the project it is in. */
  holder: boolean
  /** The conversation that puts it there (to say what it does in that project, not in another one). */
  sessionId?: string
  /** The other projects where the same Claude is at the same time (the user, 15-11: «cuando un claude trabaja en dos proyectos a la vez… no sabe mostrarse»). */
  alsoIn?: string[]
}

export type Wheels = Record<string, { chain: RelayChain } | undefined>

export function mapCast(agents: AgentCard[], wheels: Wheels, now: number): CastMember[] {
  const out: CastMember[] = []
  for (const a of agents) {
    if (a.state === 'baja' || a.state === 'apartada') continue
    const base = { id: a.id, color: a.color, alias: a.alias }
    const holderOf = Object.entries(wheels).find(([, w]) => w?.chain.on && w.chain.holder === a.id)?.[0]
    const inWheel = Object.values(wheels).some((w) => w?.chain.on && w.chain.order.includes(a.id))
    if (a.state === 'sin-uso') {
      const back = a.usage.activeLimit?.resetsAt
      out.push({ ...base, where: 'recarga', mood: 'duerme', label: t('Recargando'), tone: 'red', backAt: back && back > now ? back : undefined, holder: false })
      continue
    }
    // One place per project where it is at work or waiting for the user: the same account can have a window in two projects
    // at once, and each one shows in its project (before, only the first, and the other project looked empty). Waiting
    // for the user goes first: it is what the user has to see.
    const here: CastMember[] = []
    if (a.state === 'esperando' || a.state === 'trabajando') {
      for (const s of a.sessions) {
        // EV201: in the project it works in now (what it touches), not only the one its window was opened in.
        const pid = s.workProjectId ?? s.projectId
        if (!pid || here.some((m) => m.projectId === pid && m.mood === 'llama')) continue
        if (s.status === 'waiting') {
          const at = here.findIndex((m) => m.projectId === pid)
          const m: CastMember = { ...base, where: 'proyecto', projectId: pid, mood: 'llama', label: /permission|permiso/i.test(s.waitingFor ?? '') ? t('Te pide permiso') : t('Te espera'), tone: 'orange', holder: holderOf === pid, sessionId: s.sessionId }
          if (at >= 0) here[at] = m
          else here.push(m)
        } else if (isSessionWorking(s) && !here.some((m) => m.projectId === pid)) {
          const w = wheels[pid]?.chain
          const holder = Boolean(w?.on && w.holder === a.id)
          const outgoing = Boolean(w?.on && w.outgoing === a.id)
          here.push({ ...base, where: 'proyecto', projectId: pid, mood: 'trabaja', label: holder ? t('★ En misión') : outgoing ? t('★ Remata lo pequeño') : t('Trabajando'), tone: holder || outgoing ? 'gold' : 'orange', holder, sessionId: s.sessionId })
        }
      }
    }
    if (here.length) {
      here.sort((x, y) => Number(y.mood === 'llama') - Number(x.mood === 'llama'))
      if (here.length > 1) for (const m of here) m.alsoIn = here.filter((o) => o !== m).map((o) => o.projectId!)
      out.push(...here)
      continue
    }
    if (a.state === 'desconectado') { out.push({ ...base, where: 'base', mood: 'espera', label: t('Sin conexión'), tone: 'gray', holder: false }); continue }
    out.push({ ...base, where: 'base', mood: 'espera', label: holderOf ? t('★ Tiene el turno') : inWheel ? t('Lista, espera su turno') : t('Libre'), tone: holderOf ? 'gold' : 'teal', holder: Boolean(holderOf) })
  }
  return out
}
