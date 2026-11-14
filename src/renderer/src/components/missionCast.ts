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
    const working = a.sessions.find((s) => isSessionWorking(s) && s.status !== 'waiting' && s.projectId)
    const waiting = a.sessions.find((s) => s.status === 'waiting' && s.projectId)
    if (a.state === 'esperando' && waiting) {
      out.push({ ...base, where: 'proyecto', projectId: waiting.projectId, mood: 'llama', label: /permission|permiso/i.test(waiting.waitingFor ?? '') ? t('Te pide permiso') : t('Te espera'), tone: 'orange', holder: holderOf === waiting.projectId })
      continue
    }
    if (a.state === 'trabajando' && working?.projectId) {
      const w = wheels[working.projectId]?.chain
      const holder = Boolean(w?.on && w.holder === a.id)
      const outgoing = Boolean(w?.on && w.outgoing === a.id)
      out.push({ ...base, where: 'proyecto', projectId: working.projectId, mood: 'trabaja', label: holder ? t('★ En misión') : outgoing ? t('★ Remata lo pequeño') : t('Trabajando'), tone: holder || outgoing ? 'gold' : 'orange', holder })
      continue
    }
    if (a.state === 'desconectado') { out.push({ ...base, where: 'base', mood: 'espera', label: t('Sin conexión'), tone: 'gray', holder: false }); continue }
    out.push({ ...base, where: 'base', mood: 'espera', label: holderOf ? t('★ Tiene el turno') : inWheel ? t('Lista, espera su turno') : t('Libre'), tone: holderOf ? 'gold' : 'teal', holder: Boolean(holderOf) })
  }
  return out
}
