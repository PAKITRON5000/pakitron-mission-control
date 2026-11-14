import { t } from '../../../core/i18n'
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId } from '../lib/api'
import { accName } from './ui'

/**
 * EV171 «Mejorar mi proyecto» (the user, 14-11): a Claude goes over the whole project, writes the improvements down as
 * tasks and starts with the first. The same is asked by itself when a project that already had work is added.
 */
export function ImproveButton({ projectId, name }: { projectId: string; name: string }) {
  const { toast, refresh } = useStore()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!window.confirm(t('¿Pedir a los Claude que revisen {name} entero y lo mejoren?\n\nUn Claude con uso lo repasa, apunta las mejoras como tareas y empieza por la primera. Gasta uso de esa cuenta.', { name }))) return
    setBusy(true)
    try {
      const r = await api<{ route?: { kind: string; account?: string } }>('improveProject', projectId)
      const who = r.route?.account ? accName(r.route.account as AccountId) : ''
      toast(r.route?.kind === 'ventana' ? t('Encargado: se lo he escrito a {who} en su ventana', { who })
        : r.route?.kind === 'abrir' ? t('Encargado: {who} se abre en {name} y empieza por esto', { who, name })
        : t('Encargado: lo recogerá el primer Claude que trabaje en {name}', { name }))
      await refresh()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn btn-sm" disabled={busy} onClick={() => void run()} title={t('Un Claude repasa el proyecto entero, apunta las mejoras como tareas y empieza por la primera')}>
      <Sparkles size={13} /> {t('Mejorar mi proyecto')}
    </button>
  )
}
