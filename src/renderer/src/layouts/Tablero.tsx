// EV131 · «Tablero»: big cards, one per section, each with what matters in it right now (how many questions wait, who
// works, when the next account is back…). The one you press opens whole, with «← Tablero» to come back.
import { t, tn } from '../../../core/i18n'
import { useStore, type Route } from '../lib/store'
import { NAV } from '../components/Sidebar'
import { accName } from '../components/ui'
import { ago, clock, plural } from '../lib/format'
import { TitleBar, ScreenBox, PanelBar, Overlays, NavIcon, useBadges } from './common'
import { LAYOUTS } from './meta'
import './layouts.css'

interface Tile { route: Route; big: string; sub?: string; hot?: boolean }

function useTiles(): Tile[] {
  const { state, now } = useStore()
  const badges = useBadges()
  if (!state) return []
  const tally = state.summary?.tasks
  const inUse = state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada' && (a.identity.hasLogin || a.sessions.length))
  const working = inUse.filter((a) => a.state === 'trabajando')
  const out = inUse.filter((a) => a.state === 'sin-uso')
  const back = out.map((a) => ({ a, at: a.usage.activeLimit?.resetsAt })).filter((x) => x.at && x.at > now).sort((x, y) => x.at! - y.at!)[0]
  const windows = inUse.reduce((n, a) => n + a.sessions.filter((s) => s.pid && s.kind !== 'background').length, 0)
  const copies = state.summary?.copies ?? []
  const dirty = copies.reduce((n, c) => n + c.dirty + c.untracked, 0)
  const last = state.summary?.heartbeats?.[0]
  const project = state.projects.find((p) => p.id === state.activeProjectId)
  const day = state.day
  const sk = state.skills
  const form = LAYOUTS.find((l) => l.id === (state.settings.layout ?? 'pestanas'))?.name
  const decisions = badges.decisiones ?? 0
  return [
    { route: 'inicio', big: tally ? t('{done} de {total}', { done: tally.done, total: tally.total }) : project?.name ?? t('Sin proyecto'), sub: tally ? t('tareas hechas · el resumen del proyecto') : t('Añade un proyecto para empezar') },
    { route: 'decisiones', big: decisions ? tn(decisions, '{n} pregunta', '{n} preguntas') : t('Nada que decidir'), sub: decisions ? t('te esperan para seguir') : t('Los Claude no te preguntan nada ahora'), hot: decisions > 0 },
    { route: 'revisiones', big: badges.revisiones ? tn(badges.revisiones, '{n} corrección', '{n} correcciones') : t('Al día'), sub: badges.revisiones ? t('hechas, para que las apruebes') : t('Nada que revisar'), hot: Boolean(badges.revisiones) },
    { route: 'asistente', big: t('Pregunta'), sub: t('Lo que quieras de tus proyectos, sin gastar uso') },
    { route: 'relevos', big: working.length ? tn(working.length, '{n} trabajando', '{n} trabajando') : t('Nadie trabaja'), sub: working.length ? working.map((a) => accName(a.id)).join(', ') : t('Quién sigue cuando una se agote') },
    { route: 'proximo', big: back ? t('A las {v0}', { v0: clock(back.at!) }) : out.length ? t('Sin hora') : t('Todas con uso'), sub: back ? t('vuelve {v0}', { v0: accName(back.a.id) }) : out.length ? t('{v0} sin uso', { v0: tn(out.length, '{n} cuenta', '{n} cuentas') }) : t('Ninguna cuenta espera') },
    { route: 'chats', big: windows ? tn(windows, '{n} ventana', '{n} ventanas') : t('Ninguna abierta'), sub: t('Las conversaciones de los Claude') },
    { route: 'agentes', big: tn(inUse.length, '{n} cuenta', '{n} cuentas'), sub: out.length ? t('{length} sin uso ahora', { length: out.length }) : t('Todas con uso') },
    // EV133: counted in the background and kept (main/index.ts › tallySkills): opening the board reads no skill folder.
    { route: 'skills', big: sk ? tn(sk.installed, '{n} skill', '{n} skills') : t('Skills'), sub: sk?.suggested ? t('{suggested} más le vendrían bien', { suggested: sk.suggested }) : sk?.suggested === 0 ? t('Tiene las que le vendrían bien') : t('Busca las que le vendrían bien') },
    { route: 'tareas', big: tally ? t('{n} por hacer', { n: tally.open + tally.doing }) : t('Tareas'), sub: tally ? t('{doing} en marcha{v0}', { doing: tally.doing, v0: tally.review ? t(' · {review} para revisar', { review: tally.review }) : '' }) : undefined, hot: Boolean(tally?.review) },
    // EV133: what came today, from the day's summary the window already has (no slow read to open the board).
    { route: 'galeria', big: day?.media ? tn(day.media, '{n} nueva hoy', '{n} nuevas hoy') : t('Nada nuevo hoy'), sub: t('Imágenes, vídeos y modelos del proyecto') },
    { route: 'cronologia', big: last ? ago(last.at, now) : t('Cronología'), sub: `${last ? t('último relevo{v0}', { v0: last.account ? t(', de {v0}', { v0: accName(last.account) }) : '' }) : t('Lo que ha pasado, día a día')}${day?.commits ? tn(day.commits, ' · {n} commit hoy', ' · {n} commits hoy') : ''}` },
    { route: 'integracion', big: dirty ? tn(dirty, '{n} cambio', '{n} cambios') : tn(copies.length, '{n} copia', '{n} copias'), sub: dirty ? t('sin guardar en git') : t('Ramas y copias de trabajo, al día') },
    { route: 'memoria', big: day?.requests ? tn(day.requests, '{n} petición', '{n} peticiones') : state.memories != null ? tn(state.memories, '{n} recuerdo', '{n} recuerdos') : t('Memoria'), sub: day?.requests ? t('las de hoy{v0}', { v0: state.memories != null ? t(' · {v0} que no olvidan', { v0: tn(state.memories, '{n} recuerdo', '{n} recuerdos') }) : '' }) : t('Lo que no deben olvidar y lo que has pedido') },
    { route: 'ajustes', big: form ? t('Forma «{form}»', { form: form }) : t('Ajustes'), sub: t('Tamaño, colores, forma, cuentas y avisos') }
  ]
}

export default function Tablero() {
  const { route, param, go } = useStore()
  const tiles = useTiles()
  // «inicio» is the board itself; the project's summary (Home) opens from its own card (#/inicio/resumen), as any other.
  const open: Route | undefined = route !== 'inicio' ? route : param === 'resumen' ? 'inicio' : undefined
  return (
    <div className="app lay-tablero">
      <TitleBar />
      <div className="shell">
        {open ? (
          <ScreenBox route={open}><PanelBar route={open} back={t('Tablero')} onBack={() => go('inicio')} /></ScreenBox>
        ) : (
          <main className="content">
            <div className="content-inner">
              <div className="board">
                {tiles.map((tally) => {
                  const n = NAV.find((x) => x.route === tally.route)!
                  return (
                    <button key={tally.route} className={`board-tile ${tally.hot ? 'hot' : ''}`} style={{ ['--tile-c' as any]: n.color }} onClick={() => go(tally.route === 'inicio' ? 'inicio' : tally.route, tally.route === 'inicio' ? 'resumen' : undefined)}>
                      <span className="flex items-center gap-2.5"><NavIcon route={tally.route} size={34} /><span className="board-name">{tally.route === 'inicio' ? t('Resumen') : n.label}</span></span>
                      <span className="board-big">{tally.big}</span>
                      {tally.sub && <span className="board-sub">{tally.sub}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </main>
        )}
      </div>
      <Overlays />
    </div>
  )
}
