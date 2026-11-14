import { useMemo } from 'react'
import { Hourglass } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type Task } from '../lib/api'
import { weekRate, wheelForecast, forecastText, type Forecast } from '../../../core/forecast'
import { nameify } from './ui'

/**
 * EV67: the wheel's forecast for a project, at each account's own pace (from its usage readings): hours of work left this
 * week, when everything would stop, and whether the agenda fits. Undefined when the project has no wheel on.
 */
export function useWheelForecast(projectId?: string): { f: Forecast; text: string } | undefined {
  const { state, now } = useStore()
  const chain = projectId ? state?.settings.relayChains?.[projectId] : undefined
  const tasks = useAsync(() => (projectId && chain?.on ? api<Task[]>('tasks', projectId) : Promise.resolve([] as Task[])), [projectId, chain?.on, state?.refreshedAt?.docs])
  return useMemo(() => {
    if (!state || !chain?.on || !chain.order.length) return undefined
    const members = chain.order.map((id) => {
      const a = state.agents.find((x) => x.id === id)
      const w = a?.usage.snapshot?.sevenDay
      const out = Boolean(state.settings.accountStatus?.[id]) || Boolean(chain.paused?.includes(id)) || !a
      return { id, skipped: out, weekUsed: w?.usedPct, weekResetsAt: w?.resetsAt, backAt: a?.usage.activeLimit?.resetsAt, rate: a ? weekRate(a.usage.history, now).rate : undefined }
    })
    const key = chain.until?.section?.toLowerCase()
    const inAgenda = (tasks.data ?? []).filter((t) => !key || t.section.toLowerCase().includes(key))
    const open = inAgenda.filter((t) => t.status !== 'terminada' && t.status !== 'idea').length
    // The pace of the agenda lately: hours of work in the last day for each task finished in that day.
    const done = inAgenda.filter((t) => t.status === 'terminada' && t.updatedAt > now - 86400_000).length
    const worked = chain.order.reduce((s, id) => { const a = state.agents.find((x) => x.id === id); return s + (a ? weekRate(a.usage.history, now, 1).hours : 0) }, 0)
    const hoursPerTask = done && worked ? Math.max(0.2, Math.min(4, worked / done)) : undefined
    const f = wheelForecast(members, now, key ? { open, hoursPerTask } : undefined)
    return { f, text: forecastText(f, now) }
  }, [state, chain, tasks.data, now])
}

/** The forecast in one line, orange when the week is not enough for the agenda. */
export function ForecastLine({ projectId }: { projectId?: string }) {
  const r = useWheelForecast(projectId)
  if (!r) return null
  return (
    <div className="flex items-start gap-2 t-body" style={{ color: r.f.short ? 'var(--orange)' : 'var(--label-2)' }} title="Al ritmo de cada cuenta en los últimos días (lo que gasta de su semana por hora de trabajo); sin datos, un ritmo típico">
      <Hourglass size={16} className="flex-none mt-0.5" />
      <span>{nameify(r.text)}</span>
    </div>
  )
}
