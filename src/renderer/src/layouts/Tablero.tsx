// EV131 · «Tablero»: big cards, one per section, each with what matters in it right now (how many questions wait, who
// works, when the next account is back…). The one you press opens whole, with «← Tablero» to come back.
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
  const t = state.summary?.tasks
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
    { route: 'inicio', big: t ? `${t.done} de ${t.total}` : project?.name ?? 'Sin proyecto', sub: t ? 'tareas hechas · el resumen del proyecto' : 'Añade un proyecto para empezar' },
    { route: 'decisiones', big: decisions ? plural(decisions, 'pregunta', 'preguntas') : 'Nada que decidir', sub: decisions ? 'te esperan para seguir' : 'Los Claude no te preguntan nada ahora', hot: decisions > 0 },
    { route: 'revisiones', big: badges.revisiones ? plural(badges.revisiones, 'corrección', 'correcciones') : 'Al día', sub: badges.revisiones ? 'hechas, para que las apruebes' : 'Nada que revisar', hot: Boolean(badges.revisiones) },
    { route: 'asistente', big: 'Pregunta', sub: 'Lo que quieras de tus proyectos, sin gastar uso' },
    { route: 'relevos', big: working.length ? plural(working.length, 'trabajando', 'trabajando') : 'Nadie trabaja', sub: working.length ? working.map((a) => accName(a.id)).join(', ') : 'Quién sigue cuando una se agote' },
    { route: 'proximo', big: back ? `A las ${clock(back.at!)}` : out.length ? 'Sin hora' : 'Todas con uso', sub: back ? `vuelve ${accName(back.a.id)}` : out.length ? `${plural(out.length, 'cuenta', 'cuentas')} sin uso` : 'Ninguna cuenta espera' },
    { route: 'chats', big: windows ? plural(windows, 'ventana', 'ventanas') : 'Ninguna abierta', sub: 'Las conversaciones de los Claude' },
    { route: 'agentes', big: plural(inUse.length, 'cuenta', 'cuentas'), sub: out.length ? `${out.length} sin uso ahora` : 'Todas con uso' },
    // EV133: counted in the background and kept (main/index.ts › tallySkills): opening the board reads no skill folder.
    { route: 'skills', big: sk ? plural(sk.installed, 'skill', 'skills') : 'Skills', sub: sk?.suggested ? `${sk.suggested} más le vendrían bien` : sk?.suggested === 0 ? 'Tiene las que le vendrían bien' : 'Busca las que le vendrían bien' },
    { route: 'tareas', big: t ? `${t.open + t.doing} por hacer` : 'Tareas', sub: t ? `${t.doing} en marcha${t.review ? ` · ${t.review} para revisar` : ''}` : undefined, hot: Boolean(t?.review) },
    // EV133: what came today, from the day's summary the window already has (no slow read to open the board).
    { route: 'galeria', big: day?.media ? `${day.media} ${day.media === 1 ? 'nueva' : 'nuevas'} hoy` : 'Nada nuevo hoy', sub: 'Imágenes, vídeos y modelos del proyecto' },
    { route: 'cronologia', big: last ? ago(last.at, now) : 'Cronología', sub: `${last ? `último relevo${last.account ? `, de ${accName(last.account)}` : ''}` : 'Lo que ha pasado, día a día'}${day?.commits ? ` · ${plural(day.commits, 'commit', 'commits')} hoy` : ''}` },
    { route: 'integracion', big: dirty ? plural(dirty, 'cambio', 'cambios') : plural(copies.length, 'copia', 'copias'), sub: dirty ? 'sin guardar en git' : 'Ramas y copias de trabajo, al día' },
    { route: 'memoria', big: day?.requests ? plural(day.requests, 'petición', 'peticiones') : state.memories != null ? plural(state.memories, 'recuerdo', 'recuerdos') : 'Memoria', sub: day?.requests ? `las de hoy${state.memories != null ? ` · ${plural(state.memories, 'recuerdo', 'recuerdos')} que no olvidan` : ''}` : 'Lo que no deben olvidar y lo que has pedido' },
    { route: 'ajustes', big: form ? `Forma «${form}»` : 'Ajustes', sub: 'Tamaño, colores, forma, cuentas y avisos' }
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
          <ScreenBox route={open}><PanelBar route={open} back="Tablero" onBack={() => go('inicio')} /></ScreenBox>
        ) : (
          <main className="content">
            <div className="content-inner">
              <div className="board">
                {tiles.map((t) => {
                  const n = NAV.find((x) => x.route === t.route)!
                  return (
                    <button key={t.route} className={`board-tile ${t.hot ? 'hot' : ''}`} style={{ ['--tile-c' as any]: n.color }} onClick={() => go(t.route === 'inicio' ? 'inicio' : t.route, t.route === 'inicio' ? 'resumen' : undefined)}>
                      <span className="flex items-center gap-2.5"><NavIcon route={t.route} size={34} /><span className="board-name">{t.route === 'inicio' ? 'Resumen' : n.label}</span></span>
                      <span className="board-big">{t.big}</span>
                      {t.sub && <span className="board-sub">{t.sub}</span>}
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
