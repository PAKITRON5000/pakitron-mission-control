import { useState } from 'react'
import { Play } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type Task } from '../lib/api'
import { Avatar, accName } from './ui'

/**
 * EV159 «Solo esta tarea»: opens one Claude in the project for this task alone. It works even on an account set to «No
 * usar» (the user sends it by hand); when it hands the task in, its window closes and it does not go on by itself.
 */
export function OnlyTask({ t }: { t: Task }) {
  const { state, toast } = useStore()
  const [busy, setBusy] = useState<string>()
  const pid = state?.activeProjectId
  if (!pid || t.status === 'terminada' || t.status === 'idea') return null
  const agents = (state?.agents ?? []).filter((a) => (a.identity.hasLogin || a.sessions.length > 0) && a.state !== 'baja')
  if (!agents.length) return null
  const launch = async (id: string) => {
    setBusy(id)
    try {
      const r = await api<{ label: string }>('onlyTask', pid, t.key, id)
      toast(`${accName(id)} se abre solo para ${r.label}: al terminarla se cerrará`)
    } catch (e) { toast((e as Error).message) } finally { setBusy(undefined) }
  }
  return (
    <div>
      <div className="t-micro c3 mb-2">Solo esta tarea</div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => {
          const off = a.state === 'sin-uso' || a.sessions.some((s) => s.projectId === pid && (s.status === 'busy' || s.state === 'running' || s.state === 'working'))
          return (
            <button key={a.id} className="chip" disabled={off || Boolean(busy)} onClick={() => void launch(a.id)}
              title={a.state === 'sin-uso' ? `${accName(a.id)} no tiene uso ahora` : off ? `${accName(a.id)} ya está trabajando aquí` : `Abrir a ${accName(a.id)} solo para esta tarea; al terminarla se cierra y no sigue con otras`}>
              <Avatar id={a.id} size={16} /> {accName(a.id)} {busy === a.id ? '…' : <Play size={11} />}
            </button>
          )
        })}
      </div>
      <div className="t-small c3 mt-1.5">Abre ese Claude solo para esta tarea, aunque esté en «No usar»: al terminarla se cierra, sin seguir con otras ni entrar en modo autónomo.</div>
    </div>
  )
}
