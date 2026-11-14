import { t } from '../../../core/i18n'
import { useEffect, useState } from 'react'
import { Moon, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AgentCard } from '../lib/api'
import { Avatar, Segmented, accName } from './ui'

type Rule = { account: string; projectId: string; on: boolean; note?: string; marginMin?: number }
type Live = Rule & { open: boolean; why: string }

const MARGINS = [{ value: '30', get label() { return t('30 min') } }, { value: '60', get label() { return t('1 h') } }, { value: '120', get label() { return t('2 h') } }, { value: '180', get label() { return t('3 h') } }]

function liveText(r: Live | undefined, agents: AgentCard[]): string | undefined {
  if (!r) return undefined
  const a = agents.find((x) => x.id === r.account)
  const here = a?.sessions.filter((s) => s.projectId === r.projectId && s.pid && s.kind !== 'background').length ?? 0
  if (a?.state === 'trabajando' && here) return t('Ahora está trabajando allí ({here} {v0}).', { here: here, v0: here === 1 ? t('ventana') : t('ventanas') })
  return t('Ahora {v0}: {why}.', { v0: r.open ? t('le toca') : t('no le toca'), why: r.why })
}

/**
 * EV166 (the user, 14-11 13:42: «un sitio para apuntar en la app, que cuando los claude relevo se queden sin créditos mucho
 * tiempo, haya otro claude que trabaje en otra cosa… ese claude guarde y cierre todo de manera segura y luego salta el
 * relevo de nuevo»): the backup accounts of the dead time, set here: who, where, what it does, and from how long.
 */
export function DeadTime({ live }: { live?: Live[] }) {
  const { state, refresh, toast } = useStore()
  const rules: Rule[] = state?.settings.reserves ?? []
  const [notes, setNotes] = useState<Record<number, string>>({})
  useEffect(() => setNotes({}), [rules.length])
  if (!state) return null
  const agents = state.agents.filter((a) => (a.identity.hasLogin || a.sessions.length > 0) && state.settings.accountStatus?.[a.id] !== 'baja')
  const save = (next: Rule[], ok?: string) => void api('setSettings', { reserves: next }).then(async () => { await refresh(); if (ok) toast(ok) }, (e) => toast((e as Error).message))
  const change = (i: number, patch: Partial<Rule>, ok?: string) => save(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)), ok)
  const wheelAccounts = new Set(Object.values(state.settings.relayChains ?? {}).filter((c) => c?.on).flatMap((c) => c!.order))
  const add = () => {
    const a = agents.find((x) => !wheelAccounts.has(x.id) && !rules.some((r) => r.account === x.id)) ?? agents[0]
    const p = state.projects.find((x) => x.id === state.activeProjectId) ?? state.projects[0]
    if (!a || !p) return toast(t('Primero añade una cuenta y un proyecto'))
    save([...rules, { account: a.id, projectId: p.id, on: false, marginMin: 60 }], t('Elige la cuenta, el proyecto y qué hace, y enciéndela'))
  }
  return (
    <div className="card p-5 mb-5 flex flex-col gap-4">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="icon-sq flex-none" style={{ background: 'var(--indigo)', color: 'white' }}><Moon size={15} /></span>
        <div className="min-w-0 flex-1" style={{ flexBasis: 260 }}>
          <div className="t-head">{t('En los tiempos muertos')}</div>
          <div className="t-small c3 mt-0.5">{t('Cuando todas las cuentas de la rueda se quedan sin uso durante un buen rato, otra cuenta trabaja en otra cosa. Antes de que vuelva la rueda deja todo guardado y a salvo, y la app cierra su ventana. La rueda espera a que haya cerrado, 15 minutos como mucho, para no trabajar dos a la vez.')}</div>
        </div>
        <button className="btn btn-sm flex-none" onClick={add}><Plus size={13} /> {t('Añadir')}</button>
      </div>
      {!rules.length && <div className="t-small c3">{t('Ninguna todavía. Con «Añadir» eliges qué cuenta trabaja en esos ratos, aunque esté en «No usar».')}</div>}
      {rules.map((r, i) => {
        const lv = live?.find((x) => x.account === r.account && x.projectId === r.projectId)
        const note = notes[i] ?? r.note ?? ''
        return (
          <div key={`${r.account}:${r.projectId}:${i}`} className="rounded-xl p-4 flex flex-col gap-3" style={{ background: r.on ? 'color-mix(in srgb, var(--indigo) 10%, transparent)' : 'var(--fill)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Avatar id={r.account as any} size={24} />
              <select className="field" style={{ height: 32, width: 'auto' }} value={r.account} aria-label={t('Cuenta')} onChange={(e) => change(i, { account: e.target.value })}>
                {agents.map((a) => <option key={a.id} value={a.id}>{accName(a.id)}{state.settings.accountStatus?.[a.id] === 'pausada' ? t(' (No usar)') : ''}{wheelAccounts.has(a.id) ? t(' (de la rueda)') : ''}</option>)}
              </select>
              <span className="t-small c3">{t('trabaja en')}</span>
              <select className="field" style={{ height: 32, width: 'auto' }} value={r.projectId} aria-label={t('Proyecto')} onChange={(e) => change(i, { projectId: e.target.value })}>
                {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="ml-auto flex items-center gap-2">
                <Segmented value={r.on ? 'si' : 'no'} onChange={(v) => change(i, { on: v === 'si' }, v === 'si' ? t('{v0} trabajará en los tiempos muertos', { v0: accName(r.account) }) : t('{v0} ya no se abre en los tiempos muertos', { v0: accName(r.account) }))} options={[{ value: 'si', label: t('Encendida') }, { value: 'no', label: t('Apagada') }]} />
                <button className="btn btn-sm btn-icon btn-ghost" title={t('Quitar')} aria-label={t('Quitar')} onClick={() => save(rules.filter((_, j) => j !== i), t('Quitada'))}><Trash2 size={14} /></button>
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="t-small c2">{t('Qué hace allí')} <span className="c3">{t('(lo lee al abrirse; vacío: sigue las tareas del proyecto por orden)')}</span></span>
              <textarea className="field" rows={2} style={{ resize: 'vertical' }} placeholder={t('Por ejemplo: ordenar los vídeos, terminar los subtítulos de IV12, repasar la documentación…')} value={note}
                onChange={(e) => setNotes({ ...notes, [i]: e.target.value })}
                onBlur={() => { if (note !== (r.note ?? '')) change(i, { note: note.trim() || undefined }, t('Guardado')) }} />
            </label>
            <div className="flex items-center gap-2 flex-wrap t-small c2">
              <span>{t('Solo si la primera de la rueda tarda en volver al menos')}</span>
              <Segmented value={String(r.marginMin ?? 60)} onChange={(v) => change(i, { marginMin: Number(v) })} options={MARGINS} />
            </div>
            {r.on && <div className="t-small c3">{liveText(lv, state.agents)}</div>}
          </div>
        )
      })}
    </div>
  )
}
