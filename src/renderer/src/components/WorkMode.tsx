import { Bot } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { Segmented } from './ui'
import { useRelayRules } from './RelayRules'
import { RELAY_MODES } from '../../../core/turns'
import { WORK_MODES, modeOf, settingsFor, teamAdvice } from '../../../core/workmode'

/**
 * «Cómo trabajan los Claude»: the way of working for every project, as one choice of three. It lived in Próximo; it
 * belongs with the relay wheels (13-11): both answer «who works when». A project with its wheel on follows the wheel.
 */
export function WorkModeCard() {
  const { state, toast, refresh } = useStore()
  // EV140: turning on the hand-over between accounts shows Anthropic's rules first.
  const rules = useRelayRules()
  if (!state) return null
  const attempt = async (fn: () => Promise<unknown>) => {
    try { await fn() } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  const setS = async (patch: any) => { if (!(await rules.settingsOk(patch))) return false; await api('setSettings', patch); return true }
  const wheels = Object.entries(state.settings.relayChains ?? {}).filter(([, c]) => c?.on).map(([pid]) => state.projects.find((p) => p.id === pid)?.name ?? pid)
  // EV110: what fits the team the user has (accounts that can work: not «De baja» nor «No usar», with their login).
  const usable = state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada' && a.identity?.hasLogin !== false).length
  // EV140: until Anthropic's rules are read, several accounts are advised to go on each with their own work.
  const advice = teamAdvice(usable, false, Boolean(state.settings.relayRulesAt))
  const fits = modeOf(state.settings) === advice.mode && (advice.fronts === 1 || (state.settings.maxFronts ?? 1) >= advice.fronts)
  return (
      <div className="card p-4 mb-5 flex flex-col gap-3">
        <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap"><Bot size={15} style={{ color: 'var(--indigo)' }} /><b className="t-body">Cómo trabajan los Claude</b><span className="t-small c3">· en todos los proyectos{wheels.length ? `; en ${wheels.join(' y ')} manda su rueda (abajo)` : ''}</span></div>
        <div className="rounded-xl p-3 flex items-start gap-3" style={{ background: fits ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'color-mix(in srgb, var(--orange) 14%, transparent)' }}>
          <span className="min-w-0 flex-1"><b className="t-body block">{advice.title}{fits ? ' · así está' : ''}</b><span className="t-small c2 block mt-0.5">{advice.why}</span>
            {/* EV128: while the user has not picked one, the app keeps it fitting the accounts there are. */}
            {state.settings.workModeBy === 'app' && <span className="t-small c3 block mt-1">La app lo ajusta sola a las cuentas que tengas {state.settings.relayRulesAt ? ' (si inicias sesión en otra, se pasa a relevos)' : ''} mientras no elijas tú otra forma abajo.</span>}
          </span>
          {/* «Ponerlo así» takes the advice and leaves the app in charge of keeping it fitting. */}
          {!fits && <button className="btn btn-sm btn-primary flex-none" onClick={() => void attempt(async () => { if (!(await setS({ ...settingsFor(advice.mode), maxFronts: advice.fronts, workModeBy: 'app' }))) return; await refresh(); toast(advice.title) })}>Ponerlo así</button>}
        </div>
        {(() => {
          const current = modeOf(state.settings)
          const info = WORK_MODES.find((m) => m.id === current)
          return (
            <>
              <div className="grid gap-3" role="radiogroup" aria-label="Cómo trabajan los Claude" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {WORK_MODES.map((m) => {
                  const on = current === m.id
                  return (
                    <button key={m.id} role="radio" aria-checked={on} className="text-left rounded-xl p-3 border-0 flex gap-3 items-start" style={{ background: on ? 'color-mix(in srgb, var(--indigo) 14%, transparent)' : 'var(--fill)', boxShadow: on ? 'inset 0 0 0 1.5px var(--indigo)' : 'none' }}
                      onClick={() => void attempt(async () => { if (on) return; if (!(await setS(settingsFor(m.id)))) return; await refresh(); toast(m.label) })}>
                      <span className="flex-none rounded-full mt-0.5 flex items-center justify-center" style={{ width: 18, height: 18, border: `2px solid ${on ? 'var(--indigo)' : 'var(--sep)'}` }}>{on && <span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--indigo)' }} />}</span>
                      <span className="min-w-0"><b className="t-body block">{m.label}</b><span className="t-small c3 block mt-0.5">{m.sub}</span></span>
                    </button>
                  )
                })}
              </div>
              <div className="t-small c2">{info ? info.happens : 'Ahora mismo los ajustes finos están puestos a mano y no coinciden con ninguna de las tres formas: elige una para volver a algo claro.'} En cualquier caso, nunca se abre una segunda ventana de la misma cuenta ni una cuenta «No usar» o «De baja» (salvo la cuenta de reserva, en su proyecto, cuando todas las demás están sin uso).</div>
            </>
          )
        })()}
        {/* Always in sight (13-11: folded, the user did not find «Reparto automático»; the configuration is seen, not hidden). */}
        <div className="flex flex-col gap-3 mt-1 pt-3" style={{ borderTop: '1px solid var(--sep)' }}>
          <div><b className="t-small c2">Ajustes finos, uno a uno</b><span className="t-small c3"> · las tres formas de arriba los ponen solos; aquí cambias cada uno por separado</span></div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {([
            ['autonomous', 'Modo autónomo', 'Nadie se queda parado: cada cuenta sigue hasta que el límite la corta y arranca sola cuando se restablece. Sin tareas, piensa qué mejorar en su proyecto y lo apunta; si no hay nada, pasa a otro proyecto. A una ventana concreta la paras escribiéndole «para».'],
            ['autoRelay', 'Relevo automático', 'Cuando una cuenta se queda sin uso, se abre sola la siguiente del turno y sigue su trabajo.'],
            ['autoPlan', 'Reparto automático', 'Si en un proyecto en el que se trabajó hoy quedan tareas y nadie está con ellas, se abre sola la siguiente cuenta. Nunca mientras juegas.'],
            // EV141 (Decidir #148 «A»): off at first; «Ver» in Chats opens any of them in a window, to watch it or write to it.
            ['bgSessions', 'Sin ventanas (en pruebas)', 'La rueda da cada turno a una sesión de Claude Code que trabaja sin ventana. En Chats, «Ver» abre cualquiera en una ventana para mirarla o escribirle.'],
            // EV149 (Decidir #150): «usar toda la potencia del pc».
            ['fullPower', 'Toda la potencia', 'Aunque tengas abierto Premiere u otro editor, los Claude pueden lanzar lo pesado (Unity, Blender, la gráfica). Si estás jugando, siguen esperando.']
          ] as const).map(([key, label, sub]) => {
            const on = Boolean(state.settings[key])
            return (
              <button key={key} role="switch" aria-checked={on} className="text-left rounded-xl p-3 border-0 flex gap-3 items-start" style={{ background: on ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'var(--fill)' }}
                onClick={() => void attempt(async () => { if (!(await setS({ [key]: !on }))) return; await refresh(); toast(`${label}: ${on ? 'apagado' : 'encendido'}`) })}>
                <span className="flex-none rounded-full mt-0.5" style={{ width: 34, height: 20, background: on ? 'var(--green)' : 'var(--sep)', position: 'relative', transition: 'background 160ms ease' }}>
                  <span className="rounded-full" style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, background: '#fff', transition: 'left 160ms ease' }} />
                </span>
                <span className="min-w-0"><b className="t-body block">{label} <span className="t-small" style={{ color: on ? 'var(--green)' : 'var(--c3, inherit)', fontWeight: 500 }}>· {on ? 'encendido' : 'apagado'}</span></b><span className="t-small c3 block mt-0.5">{sub}</span></span>
              </button>
            )
          })}
        </div>
        <div className="t-small c2 flex items-center gap-2 flex-wrap">Cuentas a la vez en un mismo proyecto (tope para el relevo y el reparto):
          <Segmented value={String(state.settings.maxFronts ?? 1)} onChange={(v) => void attempt(async () => { await api('setSettings', { maxFronts: Number(v) }); await refresh() })}
            options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
        </div>
        <div className="flex flex-col gap-2 mt-1">
          <b className="t-small c3">Cómo se relevan las cuentas</b>
          <div className="grid gap-3" role="radiogroup" aria-label="Cómo se relevan las cuentas" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {RELAY_MODES.map((m) => {
              const on = (state.settings.relayMode ?? 'conjunto') === m.id
              return (
                <button key={m.id} role="radio" aria-checked={on} className="text-left rounded-xl p-3 border-0 flex gap-3 items-start" style={{ background: on ? 'color-mix(in srgb, var(--indigo) 14%, transparent)' : 'var(--fill)', boxShadow: on ? 'inset 0 0 0 1.5px var(--indigo)' : 'none' }}
                  onClick={() => void attempt(async () => { if (on) return; await api('setSettings', { relayMode: m.id }); await refresh(); toast(m.label) })}>
                  <span className="flex-none rounded-full mt-0.5 flex items-center justify-center" style={{ width: 18, height: 18, border: `2px solid ${on ? 'var(--indigo)' : 'var(--sep)'}` }}>
                    {on && <span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--indigo)' }} />}
                  </span>
                  <span className="min-w-0"><b className="t-body block">{m.label}</b><span className="t-small c3 block mt-0.5">{m.sub}</span></span>
                </button>
              )
            })}
          </div>
          {(state.settings.relayMode ?? 'conjunto') === 'proyecto' && (() => {
            const on = Boolean(state.settings.heavyTurns)
            return (
              <button role="switch" aria-checked={on} className="text-left rounded-xl p-3 border-0 flex gap-3 items-start" style={{ background: on ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'var(--fill)' }}
                onClick={() => void attempt(async () => { await api('setSettings', { heavyTurns: !on }); await refresh(); toast(`Trabajo pesado por turnos: ${on ? 'apagado' : 'encendido'}`) })}>
                <span className="flex-none rounded-full mt-0.5" style={{ width: 34, height: 20, background: on ? 'var(--green)' : 'var(--sep)', position: 'relative', transition: 'background 160ms ease' }}>
                  <span className="rounded-full" style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, background: '#fff', transition: 'left 160ms ease' }} />
                </span>
                <span className="min-w-0"><b className="t-body block">Trabajo pesado por turnos <span className="t-small" style={{ color: on ? 'var(--green)' : 'var(--c3, inherit)', fontWeight: 500 }}>· {on ? 'encendido' : 'apagado'}</span></b><span className="t-small c3 block mt-0.5">Si una vuelve mientras otra está con Unity o Blender en su proyecto, se le avisa en su ventana: sigue con lo ligero o para; cuando la otra suelta lo pesado o se queda sin uso, le escribe «te toca» en su mismo chat. Con tareas ligeras trabajan las dos a la vez.</span></span>
              </button>
            )
          })()}
        </div>
        </div>
        {rules.dialog}
      </div>
  )
}
