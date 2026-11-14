import { t } from '../../../core/i18n'
import { useState } from 'react'
import { MessageSquareQuote, Check, X } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { Segmented, Avatar } from './ui'
import { ago } from '../lib/format'

export interface UserRequest { hash: string; at: number; account: string; text: string; projectId?: string; status: 'apuntada' | 'sin-apuntar' | 'cerrada' }

/**
 * «Lo que has pedido estos días» (EV64): every request typed to any Claude of this project, and whether a task, a memory
 * or a decision covers it. The ones nobody wrote down can be noted as a task with one click, or closed.
 */
export function RequestsBox() {
  const { state, toast, now } = useStore()
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  const [show, setShow] = useState<'sin-apuntar' | 'todas'>('sin-apuntar')
  const v = useAsync(() => (pid ? api<UserRequest[]>('requests', pid, 3) : Promise.resolve([])), [pid, state?.refreshedAt?.docs])
  if (!project) return null
  const all = v.data ?? []
  const open = all.filter((r) => r.status === 'sin-apuntar')
  const list = show === 'sin-apuntar' ? open : all
  return (
    <section className="card p-5 mb-7 flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="icon-sq icon-sq-lg" style={{ background: 'var(--orange)' }}><MessageSquareQuote size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="t-section">{t('Lo que has pedido estos días')}</div>
          <div className="t-small c3">{t('Tus mensajes a los Claude de {name} (3 días). Si ninguna tarea, recuerdo ni decisión los recoge, salen como «sin apuntar»: así no se pierden al cambiar de cuenta.', { name: project.name })}</div>
        </div>
        <Segmented value={show} onChange={setShow} options={[{ value: 'sin-apuntar', label: t('Sin apuntar · {length}', { length: open.length }) }, { value: 'todas', label: t('Todas · {length}', { length: all.length }) }]} />
      </div>
      {list.map((r) => (
        <div key={r.hash} className="rounded-xl px-3 py-2.5 flex items-start gap-3" style={{ background: r.status === 'sin-apuntar' ? 'color-mix(in srgb, var(--orange) 9%, var(--bg-elev-2))' : 'var(--bg-elev-2)' }}>
          <Avatar id={r.account as any} size={22} />
          <div className="min-w-0 flex-1">
            <div className="t-body clamp-3 selectable">{r.text}</div>
            <div className="t-small c3 mt-0.5">{ago(r.at, now)} · <span style={{ color: r.status === 'apuntada' ? 'var(--green)' : r.status === 'cerrada' ? 'var(--label-3)' : 'var(--orange)' }}>{r.status === 'apuntada' ? t('apuntada en una tarea o decisión') : r.status === 'cerrada' ? t('la diste por hecha') : t('sin apuntar')}</span></div>
          </div>
          {r.status === 'sin-apuntar' && (
            <span className="flex items-center gap-1 flex-none">
              <button className="btn btn-sm btn-primary" title={t('La convierte en una tarea de este proyecto: la verá quien tenga el turno')} onClick={() => void api('requestNote', project.id, r.hash).then(() => { v.reload(); toast(t('Apuntada como tarea')) }, (e) => toast((e as Error).message))}><Check size={12} /> {t('Apuntarla')}</button>
              <button className="btn btn-sm" title={t('Ya está hecha o no hace falta')} onClick={() => void api('requestClose', r.hash).then(() => { v.reload(); toast(t('Cerrada')) })}><X size={12} /> {t('Ya está')}</button>
            </span>
          )}
        </div>
      ))}
      {!list.length && <div className="t-small c3">{v.loading ? t('Mirando tus mensajes…') : show === 'sin-apuntar' ? t('Todo lo que has pedido estos días está apuntado.') : t('No hay mensajes tuyos estos días.')}</div>}
    </section>
  )
}
