// «Primeros pasos» (EV68: «un primer arranque en 4 pasos —cuentas → ganchos → proyecto → rueda— que detecta lo que ya
// hay… pensado para un usuario que no es el de hoy»). Each step says what is already there, read from the app, and has
// the one button that does it. Shown on Inicio while there is no project, or while a step is missing until the user
// hides it; with everything done it does not show at all.
import { Check, Eye, FolderPlus, Repeat, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { accName } from './ui'
import type { RelayChain } from '../../../core/chain'

interface Step {
  key: string
  icon: ReactNode
  title: string
  done: boolean
  text: string
  button?: { label: string; run: () => Promise<unknown> | void; disabled?: boolean }
  extra?: { label: string; title?: string; run: () => Promise<unknown> | void }[]
}

/**
 * EV126: what a PC without accounts still needs, in order: Claude Code itself (its own installer, in a window), then
 * the login of the first account. Undefined once an account has its session.
 */
export function useClaudeSetup(): { text: string; button: { label: string; run: () => Promise<unknown> } } | undefined {
  const { state, toast, refresh } = useStore()
  const usable = (state?.agents ?? []).filter((a) => a.state !== 'baja' && a.state !== 'apartada')
  const logged = usable.some((a) => a.identity.hasLogin)
  // Looked at again with each reading of the accounts: installed or logged in from its window, the step moves on alone.
  const setup = useAsync(() => (logged ? Promise.resolve({ installed: true }) : api<{ installed: boolean }>('claudeSetup')), [logged, state?.refreshedAt?.agents])
  if (!state || logged || !setup.data) return undefined
  const say = async (f: () => Promise<unknown>, said: string) => {
    try { await f(); toast(said); await refresh() } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  if (!setup.data.installed) {
    return {
      text: 'Primero hace falta Claude Code, el programa de Claude para trabajar en tus carpetas. La app abre su instalador oficial en una ventana (un par de minutos); cuando acabe, este paso sigue solo.',
      button: { label: 'Instalar Claude Code', run: () => say(() => api('claudeInstall'), 'Se abre el instalador de Claude Code: cuando diga que ha terminado, vuelve aquí') }
    }
  }
  const first = usable[0]
  return {
    text: 'Claude Code ya está en este PC. Falta iniciar sesión con tu cuenta de Claude (Pro o Max): se abre una ventana y el navegador; cuando acabes, la app la ve sola.',
    button: { label: 'Iniciar sesión', run: () => say(() => api('claudeLogin', first?.id ?? 'claude1'), 'Se abre una ventana para iniciar sesión: sigue los pasos del navegador') }
  }
}

export function FirstSteps() {
  const { state, go, toast, refresh } = useStore()
  const candidates = useAsync(() => api<{ root: string; name: string; prompts: number }[]>('projectCandidates'), [state?.projects.length])
  const wheels = useAsync(() => api<Record<string, { chain: RelayChain }>>('chains'), [state?.refreshedAt?.agents, JSON.stringify(state?.settings.relayChains ?? {}), state?.projects.length])
  const setup = useClaudeSetup()
  if (!state) return null
  const usable = state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada')
  const logged = usable.filter((a) => a.identity.hasLogin)
  const blind = logged.filter((a) => !state.hooks?.[a.id])
  const names = (list: { id: string }[]) => list.map((a) => accName(a.id)).join(', ')
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]
  const wheelOn = Object.values(wheels.data ?? {}).some((w) => w.chain?.on && w.chain.order.length > 0)
  const run = async (f: () => Promise<unknown>, said: string) => {
    try { await f(); await refresh(); toast(said) } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }

  const steps: Step[] = [
    {
      key: 'cuentas', icon: <Users size={16} />, title: 'Tus cuentas de Claude', done: logged.length > 0,
      text: logged.length
        ? `${logged.length === 1 ? 'Hay 1 cuenta' : `Hay ${logged.length} cuentas`} con la sesión iniciada en este PC: ${names(logged)}. Si tienes más, añádelas en Cuentas.`
        : setup?.text ?? 'La app busca sola las cuentas de Claude Code de este PC.',
      button: logged.length || !setup ? { label: logged.length ? 'Ver las cuentas' : 'Buscar cuentas', run: () => go('agentes') } : setup.button
    },
    {
      key: 'ganchos', icon: <Eye size={16} />, title: 'Que la app vea lo que hace cada Claude', done: logged.length > 0 && blind.length === 0,
      // Since EV52 the app puts them by itself (30 s after opening, then every 10 min): the button only saves the wait.
      text: !logged.length
        ? 'Lo hace la app sola en cuanto haya una cuenta: así sabe cuándo empieza, para y escribe cada Claude (sin eso no podría coordinarlos).'
        : blind.length
          ? `La app aún no ve a ${names(blind)}: lo pone sola en unos minutos (guarda antes una copia de su configuración). Si no quieres esperar, actívalo ya.`
          : `La app ve a ${names(logged)}: sabe cuándo empieza, para y escribe cada una.`,
      button: blind.length ? { label: 'Activarlo ya', run: () => run(async () => { for (const a of blind) await api('hooksInstall', a.id) }, `Activado en ${names(blind)}`) } : undefined
    },
    {
      key: 'proyecto', icon: <FolderPlus size={16} />, title: 'Tu primer proyecto', done: state.projects.length > 0,
      text: state.projects.length
        ? `${state.projects.length === 1 ? 'Tienes 1 proyecto' : `Tienes ${state.projects.length} proyectos`}: ${state.projects.map((p) => p.name).join(', ')}.`
        : 'Elige la carpeta de lo que quieras hacer (un juego, una web, un vídeo…). La app entiende qué es y la prepara para que varios Claude trabajen en ella sin pisarse.',
      button: { label: state.projects.length ? 'Añadir otro' : 'Elegir la carpeta', run: () => run(() => api('addProject'), 'Proyecto añadido y preparado') },
      // EV56: the folders where a Claude already worked, offered with one click.
      extra: (candidates.data ?? []).map((c) => ({ label: `Añadir ${c.name}`, title: `${c.root} · ${c.prompts} mensajes tuyos allí`, run: () => run(() => api('addProjectAt', c.root), `${c.name} añadido y preparado`) }))
    },
    {
      key: 'rueda', icon: <Repeat size={16} />, title: 'Quién sigue cuando uno se queda sin uso', done: wheelOn,
      text: wheelOn
        ? 'La rueda de relevos está encendida: cuando un Claude se queda sin uso, el siguiente sigue donde lo dejó.'
        : !project
          ? 'Cuando tengas un proyecto: la rueda de relevos hace que, cuando un Claude se queda sin uso, el siguiente siga donde lo dejó.'
          : !logged.length
            ? 'Cuando tengas dos cuentas o más con sesión: la rueda de relevos hace que, cuando una se queda sin uso, la siguiente siga donde lo dejó.'
          : logged.length < 2
            ? `Con una sola cuenta no hace falta rueda: cuando se quede sin uso, seguirá ella misma al volver. Si añades otra, enciéndela aquí.`
            : `Enciende la rueda en ${project.name} con ${names(logged)}: cuando una se quede sin uso, la siguiente seguirá donde lo dejó.`,
      button: !wheelOn && project && logged.length >= 2 ? { label: 'Encender la rueda', run: () => run(() => api('chainSet', project.id, { on: true, order: logged.map((a) => a.id) }), `Rueda encendida en ${project.name}`) } : undefined
    }
  ]

  const done = steps.filter((s) => s.done).length
  if (state.projects.length && (done === steps.length || state.settings.firstRunDone)) return null
  return (
    <section className="card p-5 mb-6 flex flex-col gap-4" aria-label="Primeros pasos">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="t-title">Primeros pasos</h2>
          <div className="t-body c2 mt-1">Cuatro cosas para que tus Claude trabajen solos y sin pisarse. La app ya ha mirado lo que hay: {done} de {steps.length} {done === 1 ? 'hecha' : 'hechas'}.</div>
        </div>
        {state.projects.length > 0 && <button className="btn btn-ghost" onClick={() => void api('setSettings', { firstRunDone: true }).then(refresh)}>Ocultar</button>}
      </div>
      <ol className="flex flex-col gap-2.5 m-0 p-0 list-none">
        {steps.map((s, i) => (
          <li key={s.key} className="rounded-2xl px-4 py-3 flex items-start gap-3" style={{ background: s.done ? 'color-mix(in srgb, var(--green) 9%, transparent)' : 'var(--fill)' }}>
            <span className="icon-sq flex-none" style={{ width: 32, height: 32, borderRadius: 10, background: s.done ? 'var(--green)' : 'var(--accent)', color: 'white', fontWeight: 760 }}>{s.done ? <Check size={17} strokeWidth={2.6} /> : i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="t-body flex items-center gap-2" style={{ fontWeight: 650 }}><span className="c2 flex-none">{s.icon}</span>{s.title}</div>
              <div className="t-small c2 mt-0.5">{s.text}</div>
              {s.extra && s.extra.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="t-small c3">Donde ya ha trabajado algún Claude:</span>
                  {s.extra.map((x) => <button key={x.label} className="btn btn-sm" title={x.title} onClick={() => void x.run()}><FolderPlus size={13} /> {x.label}</button>)}
                </div>
              )}
            </div>
            {s.button && !s.done && <button className="btn btn-primary btn-sm flex-none self-center" onClick={() => void s.button!.run()}>{s.button.label}</button>}
            {s.button && s.done && s.key !== 'ganchos' && <button className="btn btn-sm btn-ghost flex-none self-center" onClick={() => void s.button!.run()}>{s.button.label}</button>}
          </li>
        ))}
      </ol>
    </section>
  )
}
