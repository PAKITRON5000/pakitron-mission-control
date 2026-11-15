// EV126 (the user, 14-11 19:2x: «debemos avisar al usuario de que está activado el modo autónomo y que trabajará hasta
// considerar que la app no tiene más que mejorar… se le de a elegir… empiece con otro o deje de trabajar»): on Inicio,
// while autonomous mode is on here, what it does, what happens when a Claude gives the project up as finished
// (pmc terminado), and that mark itself with «Seguir mejorándolo».
import { t } from '../../../core/i18n'
import { Infinity as Forever } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { Segmented, accName } from './ui'
import { ago } from '../lib/format'

interface DoneMark { at: number; by: string; why: string }

export function AutonomyNotice({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { state, refresh, toast } = useStore()
  const done = useAsync(() => api<Record<string, DoneMark>>('autonomyDone'), [state?.now])
  if (!state?.settings.autonomous || (state.settings.autonomyOff ?? []).includes(projectId)) return null
  const mark = done.data?.[projectId]
  const whenDone = (state.settings as { autonomyWhenDone?: 'parar' | 'otro' }).autonomyWhenDone ?? 'parar'
  const choose = (v: 'parar' | 'otro') => void api('setSettings', { autonomyWhenDone: v }).then(() => refresh(), (e: Error) => toast(e.message))
  const goOn = () => void api('clearDone', projectId).then(() => { done.reload(); toast(t('Los Claude seguirán mejorando {name}', { name: projectName })) }, (e: Error) => toast(e.message))
  return (
    <div className="group p-4 mb-5 flex gap-3 items-start">
      <span className="icon-sq flex-none" style={{ background: 'var(--indigo)', color: 'white', width: 34, height: 34, borderRadius: 10 }}><Forever size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="t-head">{mark ? t('{name} está dado por terminado', { name: projectName }) : t('Modo autónomo encendido en {name}', { name: projectName })}</div>
        <div className="t-small c2 mt-1">{mark
          ? t('{who} lo dio por terminado {when}: «{why}». El modo autónomo ya no le pide seguir aquí hasta que haya trabajo nuevo (una tarea o una nota tuya).', { who: accName(mark.by as never), when: ago(mark.at), why: mark.why })
          : t('Los Claude de este proyecto siguen trabajando solos, sin parar, hasta que el límite de uso los corta (y vuelven cuando se recupera) o hasta que uno lo da por terminado porque no queda nada que merezca la pena mejorar. Se apaga en Relevos › Cómo trabajan los Claude.')}</div>
        <div className="flex flex-wrap items-center gap-2 mt-3 t-small c2">
          <span>{t('Cuando lo den por terminado:')}</span>
          <Segmented value={whenDone} onChange={choose} options={[{ value: 'parar', label: t('Parar') }, { value: 'otro', label: t('Pasar a otro proyecto con trabajo') }]} />
          {mark && <button className="btn btn-sm" onClick={goOn}>{t('Seguir mejorándolo')}</button>}
        </div>
      </div>
    </div>
  )
}
