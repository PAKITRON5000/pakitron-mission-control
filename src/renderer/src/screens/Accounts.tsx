import { t } from '../../../core/i18n'
import { useState } from 'react'
import { Check, Pencil, Repeat, RotateCcw, UserPlus, ChevronRight } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type AgentCard, type AccountId } from '../lib/api'
import { Avatar, Segmented, Empty, STATE_META, ACCOUNT_COLOR, ACCOUNT_NAME, accName } from '../components/ui'
import { ClaudeRing, UsageBars } from '../components/ClaudeRing'
import { WhoWhere } from '../components/WhoWhere'
import { reserveNow } from './Relays'
import { useClaudeSetup } from '../components/FirstSteps'
import { ago, modelName, whenFull } from '../lib/format'

/**
 * The user's own name for a Claude, edited in place (EV99, the user, 13-11: «renombrar a los claude dentro de la app, sin
 * afectar el arranque, que sea solo visual»). Empty: «Claude N» again. Launching and the Claudes keep claudeN.
 */
export function AliasEdit({ a, onDone }: { a: AgentCard; onDone?: (t: string) => void }) {
  const { toast, refresh } = useStore()
  const [editing, setEditing] = useState(false)
  const cur = ACCOUNT_NAME[a.id] ?? ''
  const [text, setText] = useState(cur)
  const save = async () => {
    setEditing(false)
    if (text.trim() === cur) return
    const before = accName(a.id)
    await api('nameAccount', a.id, text)
    await refresh()
    ;(onDone ?? toast)(text.trim() ? t('{before} se llama ahora «{v0}» (solo en la app)', { before: before, v0: text.trim() }) : t('Vuelve a llamarse Claude {v0}', { v0: a.id.slice(6) }))
  }
  if (editing) return (
    <span className="flex items-center gap-1 min-w-0">
      <input className="field" style={{ height: 30, width: 210 }} autoFocus value={text} maxLength={30} placeholder={t('Claude {v0}', { v0: a.id.slice(6) })} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setText(cur); setEditing(false) } }} onBlur={() => void save()} aria-label={t('Nombre de {v0}', { v0: accName(a.id) })} />
      <button className="btn btn-sm btn-icon btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => void save()} aria-label={t('Guardar')}><Check size={13} /></button>
    </span>
  )
  return (
    <button className="flex items-center gap-1.5 border-0 bg-transparent p-0 min-w-0 group" onClick={() => { setText(cur); setEditing(true) }} title={t('Ponle el nombre que quieras: se verá así en toda la app (solo para ti; no cambia cómo arranca)')}>
      <span className="t-body c2 truncate">{cur ? t('Se llama «{cur}»', { cur: cur }) : t('Ponle un nombre')}</span>
      <Pencil size={12} className="c3 opacity-50 group-hover:opacity-100 flex-none" />
    </button>
  )
}

function StatusSwitch({ a }: { a: AgentCard }) {
  const { state, toast, refresh } = useStore()
  const st = state?.settings.accountStatus?.[a.id]
  return (
    <Segmented value={st === 'pausada' ? 'pausada' : st === 'baja' ? 'baja' : 'uso'}
      onChange={(v) => void api('setSettings', { accountStatus: { ...(state?.settings.accountStatus ?? {}), [a.id]: v === 'uso' ? undefined : v } }).then(async () => {
        await refresh()
        toast(v === 'uso' ? t('{v0} vuelve a usarse', { v0: accName(a.id) }) : v === 'pausada' ? t('{v0} apartada: no se usa ni se le deja trabajo', { v0: accName(a.id) }) : t('{v0} de baja', { v0: accName(a.id) }))
      })}
      options={[{ value: 'uso', label: t('En uso') }, { value: 'pausada', label: t('No usar') }, { value: 'baja', label: t('De baja') }]} />
  )
}

/**
 * IV1: an account kept as a backup for one project (core/reserve.ts). It opens there by itself when every other account
 * in use is out of usage, even set aside: the user asked for it by name (13-11). Shown where «No usar» is, so it is
 * never a surprise, and switched off with one click.
 */
function ReserveLine({ a }: { a: AgentCard }) {
  const { state, toast, refresh } = useStore()
  const rules = state?.settings.reserves ?? []
  const mine = rules.filter((r) => r.account === a.id)
  const live = useAsync(() => (mine.length ? api<{ projectId: string; open: boolean; why: string }[]>('reserveState') : Promise.resolve([])), [mine.length, state?.refreshedAt?.agents])
  if (!state || !mine.length) return null
  return (
    <>
      {mine.map((r) => {
        const p = state.projects.find((x) => x.id === r.projectId)
        const set = (on: boolean) => void api('setSettings', { reserves: rules.map((x) => (x === r ? { ...x, on } : x)) }).then(async () => {
          await refresh()
          toast(on ? t('{v0} se abrirá sola en {v1} cuando todas las demás estén sin uso', { v0: accName(a.id), v1: p?.name ?? r.projectId }) : t('{v0} ya no se abre sola en {v1}', { v0: accName(a.id), v1: p?.name ?? r.projectId }))
        })
        return (
          <div key={r.projectId} className="rounded-xl px-3 py-2.5 flex flex-col gap-2" style={{ background: r.on ? 'color-mix(in srgb, var(--blue) 10%, transparent)' : 'var(--fill)' }}>
            <span className="t-body"><b>{t('De reserva para {v0}:', { v0: p?.name ?? r.projectId })}</b> {t('se abre sola allí cuando todas las demás cuentas en uso están sin uso{v0}.', { v0: state.settings.accountStatus?.[a.id] === 'pausada' ? t(', aunque esté en «No usar»') : '' })}</span>
            {r.on && live.data?.find((x) => x.projectId === r.projectId) && <span className="t-small c2">{reserveNow({ ...live.data.find((x) => x.projectId === r.projectId)!, account: a.id }, state.agents)}</span>}
            <Segmented value={r.on ? 'si' : 'no'} onChange={(v) => set(v === 'si')} options={[{ value: 'si', label: t('Sí') }, { value: 'no', label: t('No') }]} />
          </div>
        )
      })}
    </>
  )
}

/** One account, whole: its name, how much it has left, what it is doing and where, and what can be done with it. */
/** EV146: the e-mail and the plan («… · Pro»; «Pago por uso (clave)» alone for a key, which has no e-mail). */
const accountLine = (a: AgentCard) => [a.identity.email ?? (a.identity.hasLogin ? '' : t('Sin sesión iniciada en este PC')), a.identity.plan?.label].filter(Boolean).join(' · ') || t('Sesión iniciada')

/** EV146: its plan gives no usage to read and none has come (Team, Enterprise, a key, a cloud). */
export const noUsageToRead = (a: AgentCard) => Boolean(a.identity.plan && !a.identity.plan.limits && !a.usage.snapshot?.fiveHour && !a.usage.snapshot?.sevenDay)

function AccountPanel({ a }: { a: AgentCard }) {
  const { state, now, setAgentOpen } = useStore()
  if (!state) return null
  const m = STATE_META[a.state]
  const wheel = Object.entries(state.settings.relayChains ?? {}).find(([, c]) => c?.on && c.order.includes(a.id))
  const wheelName = wheel ? state.projects.find((p) => p.id === wheel[0])?.name ?? wheel[0] : undefined
  const mine = wheel?.[1]?.holder === a.id
  return (
    <section className="card p-5 grid gap-x-8 gap-y-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }} aria-label={accName(a.id)}>
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex items-center gap-4 min-w-0">
          <ClaudeRing a={a} now={now} size={96} />
          <div className="min-w-0 flex flex-col gap-1">
            <button className="t-title text-left border-0 bg-transparent p-0" onClick={() => setAgentOpen(a.id)} title={t('Ver su ficha')}>{accName(a.id)}</button>
            <AliasEdit a={a} />
            <span className="t-small c2 truncate" title={t('El correo con el que está iniciada esta cuenta')}>{accountLine(a)}</span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="pill" style={{ background: `color-mix(in srgb, ${m.color} 16%, transparent)`, color: m.color }}><span className={`dot ${a.state === 'trabajando' ? 'live-dot' : ''}`} style={{ background: m.color, color: m.color }} />{m.label}</span>
              {modelName(a.model) && <span className="t-small c3">{modelName(a.model)}</span>}
            </div>
          </div>
        </div>
        {/* EV146: a plan Claude Code gives no usage for (Team, Enterprise, a key, a cloud): said instead of bars that never fill. */}
        {noUsageToRead(a) ? <div className="t-small c2 rounded-xl px-3 py-2.5" style={{ background: 'var(--fill)' }}>{a.identity.plan!.note}</div> : <UsageBars a={a} now={now} />}
        <StatusSwitch a={a} />
        <ReserveLine a={a} />
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        {wheel && (
          <div className="rounded-xl px-3 py-2 t-small flex items-center gap-2" style={{ background: mine ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'var(--fill)' }}>
            <Repeat size={13} style={{ color: mine ? 'var(--green)' : 'var(--label-3)' }} />
            <span><b>{t('Rueda de {wheelName}:', { wheelName: wheelName })}</b> {mine ? t('tiene el turno') : t('espera su turno')} <span className="c3">({wheel[1]!.order.map(accName).join(' → ')})</span></span>
          </div>
        )}
        <div className="t-micro c3">{t('Ahora')}</div>
        <WhoWhere ids={[a.id]} bare />
        <div className="t-small c3 mt-auto flex items-center gap-2 flex-wrap">
          <span>{a.assigned.length ? t('{length} tareas a su nombre', { length: a.assigned.length }) : t('Sin tareas a su nombre')}</span>
          {a.heartbeat && <span>{t('· último relevo {v0}', { v0: whenFull(a.heartbeat.at, now) })}</span>}
          {a.lastActivityAt && <span>{t('· activa {v0}', { v0: ago(a.lastActivityAt, now) })}</span>}
          <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setAgentOpen(a.id)}>{t('Su ficha')} <ChevronRight size={12} /></button>
        </div>
      </div>
    </section>
  )
}

/**
 * «Cuentas» (13-11, one place for the accounts): before, the same accounts were in Inicio, Próximo › Quién está dónde,
 * Comparar cuentas, Relevos and Ajustes, each with other data. Here each one is whole; the others link here.
 */
export function Accounts() {
  const { state, now, go, toast } = useStore()
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  const setup = useClaudeSetup()
  if (!state) return null
  const out = (a: AgentCard) => a.state === 'baja' || a.state === 'apartada'
  const inUse = state.agents.filter((a) => !out(a))
  const aside = state.agents.filter(out)
  return (
    <div className="content-inner max-w-[1320px]">
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <h1 className="t-display flex items-center gap-3"><span className="icon-sq icon-sq-lg" style={{ background: 'var(--purple)' }}><UserPlus size={16} /></span>{t('Cuentas')}</h1>
          <div className="t-head c2 mt-2" style={{ fontWeight: 450 }}>{t('Cada cuenta entera: cuánto uso le queda, qué hace, en qué proyecto y ventana, y qué puedes hacer con ella. Pulsa el nombre para cambiarlo.')}</div>
        </div>
        <button className="btn ml-auto" onClick={() => go('relevos')}><Repeat size={14} /> {t('Quién releva a quién')}</button>
      </div>
      {setup && (
        // EV126: a PC with no account yet: what is missing instead of an empty «Claude 1» that looks like one.
        <section className="card p-5 mb-4 flex items-center gap-4 flex-wrap" aria-label={t('Tu primera cuenta')}>
          <div className="min-w-0 flex-1">
            <div className="t-body" style={{ fontWeight: 650 }}>{t('Aún no hay ninguna cuenta con la sesión iniciada en este PC')}</div>
            <div className="t-small c2 mt-1">{setup.text}</div>
          </div>
          <button className="btn btn-primary flex-none" onClick={() => void setup.button.run()}>{setup.button.label}</button>
        </section>
      )}
      <div className="flex flex-col gap-4">
        {inUse.filter((a) => !setup || a.identity.hasLogin).map((a) => <AccountPanel key={a.id} a={a} />)}
      </div>
      {aside.length > 0 && (
        <div className="mt-6">
          <div className="t-section mb-2">{t('Sin usar')}</div>
          {/* EV105 (the user, 13-11: «que se vea el correo de cada una y los créditos restantes aunque estén en No usar»). */}
          <div className="flex flex-col gap-3">
            {aside.map((a) => {
              const reserve = (state.settings.reserves ?? []).find((r) => r.on && r.account === a.id)
              const reserveName = reserve ? state.projects.find((p) => p.id === reserve.projectId)?.name ?? reserve.projectId : undefined
              return (
                <section key={a.id} className="card p-4 grid gap-x-8 gap-y-3 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }} aria-label={accName(a.id)}>
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar id={a.id} size={36} />
                    <div className="min-w-0 flex flex-col gap-1">
                      <div className="t-body" style={{ fontWeight: 650 }}>{accName(a.id)}</div>
                      <AliasEdit a={a} />
                      <span className="t-small c2 truncate" title={t('El correo con el que está iniciada esta cuenta')}>{accountLine(a)}</span>
                      <span className="t-small c3">{a.state === 'baja' ? t('Ya no se paga: nunca se abre') : reserveName ? t('Apartada: solo se abre de reserva para {reserveName}', { reserveName: reserveName }) : t('Apartada: nunca se abre ni se le deja trabajo')}</span>
                    </div>
                  </div>
                  {noUsageToRead(a) ? <div className="t-small c3">{t('{label}: Claude Code no dice cuánto uso queda.', { label: a.identity.plan!.label })}</div> : <UsageBars a={a} now={now} compact />}
                  <div className="flex flex-col gap-2 min-w-0">
                    <StatusSwitch a={a} />
                    <ReserveLine a={a} />
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
      {/* EV71: the conversations, open and saved, are all in Chats (with Retomar); here only the way there. */}
      <div className="mt-8">
        <button className="btn btn-ghost" onClick={() => go('chats')}><RotateCcw size={13} /> {t('Las conversaciones{v0}, abiertas y guardadas, están en Chats', { v0: project ? t(' de {name}', { name: project.name }) : '' })}</button>
      </div>
    </div>
  )
}
