// «Quién está dónde» (the user, 12-11: «que comprenda qué hay y en qué trabaja cada cosa»): every account, every project,
// in one list. Its windows (and which project and copy each is in), what it says it is doing, its usage, and what will
// happen when it runs out with the way of working the user chose. A second window of the same account is called out,
// with a button to close the one that is idle (12-11 06:03: a scheduled start opened a second claude3 window).
import { useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Hand, MapPin, Play, Repeat, X } from 'lucide-react'
import { useAsync, useStore } from '../lib/store'
import { api, type AgentCard } from '../lib/api'
import { Avatar, STATE_META, workingOn, ACCOUNT_COLOR, accName } from './ui'
import { isSessionWorking } from '../../../core/working'
import { WORK_MODES, modeOf } from '../../../core/workmode'

const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`
}

/** With `ids` and `bare`, only those accounts' places and buttons, without the card around (the Claude screen uses it per account). */
export function WhoWhere({ ids, bare }: { ids?: string[]; bare?: boolean } = {}) {
  const { state, now, toast, setAgentOpen } = useStore()
  const [closing, setClosing] = useState<string>()
  const [launching, setLaunching] = useState<string>()
  const [giving, setGiving] = useState<string>()
  // Windows opened before their account's coordination was updated keep stopping at the end of every answer (12-11).
  const stale = useAsync(() => api<{ account: string; sessionId: string; working: boolean }[]>('staleWindows'), [state?.refreshedAt?.agents, Math.floor(now / 60_000)])
  const staleIds = new Set((stale.data ?? []).map((x) => x.sessionId))
  if (!state) return null
  const mode = modeOf(state.settings)
  const projectName = (id?: string) => state.projects.find((p) => p.id === id)?.name ?? (id ? id : 'fuera de los proyectos')
  const rows = state.agents.filter((a) => a.state !== 'baja' && (!ids || ids.includes(a.id)))
  const pad = bare ? '' : 'pl-10'
  const afterLimit = (a: AgentCard) => {
    if (a.state === 'apartada') return 'No se usa: nunca se abre sola.'
    if (mode === 'manual' || !mode) return 'Se quedará parada hasta que tú la abras.'
    if (mode === 'cada-uno') return 'Seguirá ella misma, en su ventana, cuando vuelva su uso.'
    return 'La siguiente libre del turno seguirá su trabajo; ella seguirá al volver si nadie lo ha tomado.'
  }
  const close = async (a: AgentCard, sessionId: string) => {
    setClosing(sessionId)
    try { await api('stopClaude', a.id, 'ya', sessionId); toast(`Cerrada una ventana de ${accName(a.id)}`) } catch (e) { toast((e as Error).message) } finally { setClosing(undefined) }
  }
  const askStop = (a: AgentCard) => void api('stopClaude', a.id, 'pedir').then(() => toast(`${accName(a.id)} dejará el relevo al día y parará al acabar el paso en curso`), (e) => toast((e as Error).message))
  // «Que siga otra…» (EV51): the same hand-off as in its sheet. The one that goes on gets everything it needs; this one
  // finishes what it has half done and leaves the rest.
  const takers = (a: AgentCard) => state.agents
    .filter((x) => x.id !== a.id && x.state !== 'baja' && x.state !== 'apartada')
    .map((x) => { const w = x.usage.snapshot?.sevenDay; return { id: x.id, free: w && w.resetsAt > now ? Math.max(0, 100 - Math.round(w.usedPct)) : undefined, out: x.state === 'sin-uso' } })
    .sort((p, q) => Number(p.out) - Number(q.out) || (q.free ?? -1) - (p.free ?? -1))
  const handoff = (a: AgentCard, projectId: string, to: string) =>
    void api('handoff', projectId, a.id, to).then(
      () => toast(`${accName(to)} seguirá lo de ${accName(a.id)} en ${projectName(projectId)}${state.hooks?.[to] ? '' : ' (lo recibirá al abrir su próxima sesión)'}`),
      (e) => toast((e as Error).message)
    )
  const list = rows.map((a) => {
        const windows = a.sessions.filter((s) => s.pid && s.kind !== 'background')
        const doing = workingOn(a, state.activity?.[a.id], [], now)
        const m = STATE_META[a.state]
        const five = a.usage.snapshot?.fiveHour, week = a.usage.snapshot?.sevenDay
        const dup = windows.length > 1
        return (
          <div key={a.id} className={bare ? 'flex flex-col gap-1.5' : 'rounded-xl p-3 flex flex-col gap-1.5'} style={bare ? undefined : { background: dup ? 'color-mix(in srgb, var(--orange) 10%, transparent)' : 'var(--fill)' }}>
            {!bare && <div className="flex items-center gap-3 flex-wrap">
              <button className="border-0 bg-transparent p-0" onClick={() => setAgentOpen(a.id)} title="Ver su ficha"><Avatar id={a.id} size={28} /></button>
              <b className="t-body">{accName(a.id)}</b>
              <span className="t-small" style={{ color: m.color }}>{m.label}</span>
              {(five || week) && <span className="t-small c3">· queda {five && five.resetsAt > now ? `${Math.max(0, 100 - Math.round(five.usedPct))} %` : '—'} de 5 h y {week && week.resetsAt > now ? `${Math.max(0, 100 - Math.round(week.usedPct))} %` : '—'} de la semana</span>}
              {(() => {
                const w = Object.entries(state.settings.relayChains ?? {}).find(([, c]) => c?.on && c.order.includes(a.id))
                if (!w) return null
                const mine = w[1]!.holder === a.id
                return <span className="pill" style={{ background: mine ? 'color-mix(in srgb, var(--green) 18%, transparent)' : 'var(--fill-2)', color: mine ? 'var(--green)' : 'var(--label-2)' }}><Repeat size={11} /> {mine ? 'tiene el turno' : 'espera su turno'} en {projectName(w[0])}</span>
              })()}
              {/* The same sentence for every account said once under the title (EV18); here only what is this one's own. */}
              <span className="t-small c3 ml-auto">{a.state === 'apartada' ? afterLimit(a) : ''}</span>
              {windows.some((s) => isSessionWorking(s)) && (
                <button className="btn btn-sm btn-ghost" title="En su próximo paso lee que debe dejar el relevo al día, liberar sus tareas y parar. No corta nada a medias." onClick={() => askStop(a)}><Hand size={12} /> Pedir que pare</button>
              )}
            </div>}
            {bare && windows.some((s) => isSessionWorking(s)) && (
              <div><button className="btn btn-sm" title="En su próximo paso lee que debe dejar el relevo al día, liberar sus tareas y parar. No corta nada a medias." onClick={() => askStop(a)}><Hand size={12} /> Pedir que pare</button></div>
            )}
            {doing.text && (a.state === 'trabajando' || a.state === 'esperando') && <div className={`t-small c2 ${pad}`}>{doing.text}</div>}
            {/* 12-11: with its coordination out of date (Stop hook in the background) an account stops at the end of every answer. */}
            {mode && mode !== 'manual' && a.state !== 'apartada' && state.hooks?.[a.id] && state.hooksOutdated?.[a.id] && (
              <div className={`t-small ${pad} flex items-center gap-1.5`} style={{ color: 'var(--red)' }}><AlertTriangle size={13} /> Parará al acabar cada respuesta: actualiza su coordinación en Inicio › Para ti.</div>
            )}
            {windows.length === 0 && (
              <div className={`t-small c3 ${pad} flex items-center gap-2 flex-wrap`}>Sin ventana abierta.
                {/* Launching from here (EV18: it was only in the turn list further down). With the model its next task asks for (EV39). */}
                {a.state !== 'apartada' && a.state !== 'sin-uso' && state.activeProjectId && (
                  <button className="btn btn-sm btn-ghost" disabled={launching === a.id} title="Abre su ventana en este proyecto con «sigue», en la copia donde se trabaja y con el modelo que pide su siguiente tarea"
                    onClick={() => { setLaunching(a.id); void api('putToWork', state.activeProjectId, a.id).then(() => toast(`${accName(a.id)} se pone a trabajar en ${projectName(state.activeProjectId)}`), (e) => toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))).finally(() => setLaunching(undefined)) }}>
                    <Play size={12} /> Ponerla a trabajar en {projectName(state.activeProjectId)}
                  </button>
                )}
              </div>
            )}
            {dup && <div className={`t-small ${pad} flex items-center gap-1.5`} style={{ color: 'var(--orange)' }}><AlertTriangle size={13} /> Tiene {windows.length} ventanas abiertas: gastan de la misma cuenta. Cierra la que sobre.</div>}
            {windows.map((s) => {
              const working = isSessionWorking(s)
              return (
                <div key={s.sessionId} className={`t-small ${pad} flex items-center gap-2 flex-wrap`}>
                  <span className="rounded-full flex-none" style={{ width: 7, height: 7, background: working ? 'var(--green)' : 'var(--label-3)' }} />
                  <span className="c2"><b style={{ fontWeight: 580 }}>{projectName(s.projectId)}</b>{s.worktree ? ` · ${s.worktree}` : ''}</span>
                  <span className="c3">· {working ? 'trabajando' : s.rateLimited ? 'parada por el límite' : 'quieta'}{s.lastActivityAt ? `, ${ago(s.lastActivityAt, now)}` : ''}{/* The chat's name in quotes: bare, «· Recarga de créditos no detectada» read like a status of the account (13-11). */}{s.title ? ` · chat «${s.title.slice(0, 60)}»` : ''}</span>
                  {!s.projectId && !(state.settings.declinedFolders ?? []).some((d) => d.toLowerCase() === s.cwd.toLowerCase()) && (
                    <button className="btn btn-sm btn-ghost" title={`Mission Control empezará a seguir ${s.cwd}: tareas, relevo, galería y ayudantes`} onClick={() => void api('addProjectAt', s.cwd).then(() => toast('Añadido como proyecto: ya lo sigue Mission Control'), (e) => toast((e as Error).message))}>+ Añadirlo como proyecto</button>
                  )}
                  {/* «Que siga otra…» as buttons, not a menu (the user, 12-11: desplegables que no se leen bien). */}
                  {s.projectId && (working || s.rateLimited) && (giving === s.sessionId ? (
                    <span className="flex items-center gap-1 flex-wrap" title="Otra cuenta sigue este trabajo: recibe el último latido, las reservas y los cambios sin guardar; esta termina lo que tiene a medias y no empieza nada de eso">
                      <span className="c3">que siga:</span>
                      {takers(a).map((x) => (
                        <button key={x.id} className="btn btn-sm" disabled={x.out} onClick={() => { setGiving(undefined); handoff(a, s.projectId!, x.id) }} title={x.out ? 'Sin uso ahora' : x.free != null ? `Le queda el ${x.free} % de la semana` : undefined}>
                          <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: ACCOUNT_COLOR[x.id as any] }} /> {accName(x.id)}{x.out ? ' · sin uso' : x.free != null ? ` · ${x.free} %` : ''}
                        </button>
                      ))}
                      <button className="btn btn-sm btn-icon btn-ghost" onClick={() => setGiving(undefined)} aria-label="Cancelar"><X size={12} /></button>
                    </span>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => setGiving(s.sessionId)}><ArrowRightLeft size={12} /> Que siga otra…</button>
                  ))}
                  {staleIds.has(s.sessionId) && mode && mode !== 'manual' && (
                    <span className="flex items-center gap-1.5" style={{ color: 'var(--orange)' }}>
                      · abierta antes de actualizar su coordinación: para al acabar cada respuesta
                      {!working && <button className="btn btn-sm btn-ghost" disabled={closing === s.sessionId} title="Cierra esta ventana y retoma la misma conversación con «sigue», ya con la coordinación nueva" onClick={() => { setClosing(s.sessionId); void api('reopenWindow', a.id, s.sessionId).then(() => { toast(`Reabriendo la ventana de ${accName(a.id)}: sigue donde estaba`); stale.reload() }, (e) => toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))).finally(() => setClosing(undefined)) }}>Reabrir para que siga sola</button>}
                    </span>
                  )}
                  {dup && !working && (
                    <button className="btn btn-sm btn-ghost" disabled={closing === s.sessionId} title="Cierra esta ventana y su pestaña de la terminal (su conversación queda guardada y se puede retomar)" onClick={() => void close(a, s.sessionId)}><X size={12} /> Cerrar esta</button>
                  )}
                </div>
              )
            })}
          </div>
        )
      })
  if (bare) return <div className="flex flex-col gap-1.5">{list}</div>
  return (
    <div className="card p-4 mb-5 flex flex-col gap-2">
      <div className="flex items-center gap-2"><MapPin size={15} style={{ color: 'var(--indigo)' }} /><b className="t-body">Quién está dónde</b><span className="t-small c3">· todas las cuentas y todos los proyectos{mode ? ` · ${WORK_MODES.find((m) => m.id === mode)!.label.toLowerCase()}` : ''}</span></div>
      {mode && <div className="t-small c3 -mt-1 mb-1">{WORK_MODES.find((m) => m.id === mode)!.happens}</div>}
      {list}
    </div>
  )
}
