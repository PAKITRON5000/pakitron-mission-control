// EV131 · «Consola»: dense and in fixed-width letters, for working with the keyboard. The sections as numbered orders down
// the left (Ctrl + their number), where you are as a prompt line, and a status line at the bottom with every Claude.
import { useStore } from '../lib/store'
import { NAV } from '../components/Sidebar'
import { STATE_META, accName } from '../components/ui'
import { clock } from '../lib/format'
import { TitleBar, ScreenBox, Overlays, useBadges } from './common'
import './layouts.css'

export default function Consola() {
  const { state, route, go, now, setPalette, setAgentOpen } = useStore()
  const badges = useBadges()
  const project = state?.projects.find((p) => p.id === state.activeProjectId)
  const here = NAV.find((n) => n.route === route)
  const numbered = NAV.filter((n) => n.group !== 'ajustes')
  const agents = (state?.agents ?? []).filter((a) => a.state !== 'baja' && a.state !== 'apartada' && (a.identity.hasLogin || a.sessions.length))
  const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-')
  return (
    <div className="app lay-consola">
      <TitleBar tabs={false} middle={<span className="con-prompt no-drag truncate" title="Ctrl + K para buscar o ir a cualquier sitio" onClick={() => setPalette(true)}>~/{slug(project?.name ?? 'sin-proyecto')} <b>›</b> {here ? slug(here.label) : 'inicio'}<span className="con-caret" aria-hidden /></span>} />
      <div className="con-body">
        <nav className="con-nav" aria-label="Órdenes">
          {numbered.map((n, i) => (
            <button key={n.route} className={`con-item ${route === n.route ? 'on' : ''}`} onClick={() => go(n.route)} aria-current={route === n.route ? 'page' : undefined} title={`${n.label}${i < 9 ? ` · Ctrl + ${i + 1}` : ''}`}>
              <span className="con-key">{i < 9 ? i + 1 : '·'}</span>
              <span className="truncate">{slug(n.label)}</span>
              {badges[n.route] ? <span className="con-badge">{badges[n.route]}</span> : null}
            </button>
          ))}
          <div className="con-sep" />
          <button className={`con-item ${route === 'ajustes' ? 'on' : ''}`} onClick={() => go('ajustes')}><span className="con-key">,</span><span>ajustes</span></button>
          <button className="con-item" onClick={() => setPalette(true)}><span className="con-key">K</span><span>buscar…</span></button>
        </nav>
        <ScreenBox route={route} className="con-content" />
      </div>
      <footer className="con-status" aria-label="Estado de los Claude">
        {agents.map((a) => (
          <button key={a.id} className="con-agent" onClick={() => setAgentOpen(a.id)} title={a.stateReason}>
            <span style={{ color: STATE_META[a.state].color }}>{a.state === 'trabajando' ? '●' : '○'}</span> {accName(a.id).toLowerCase().replace(/\s+/g, '')} <span className="c3">{STATE_META[a.state].label.toLowerCase()}</span>
          </button>
        ))}
        <span className="ml-auto c3 flex-none">{badges.decisiones ? <span style={{ color: 'var(--red)' }}>{badges.decisiones} por decidir · </span> : null}{clock(now)}</span>
      </footer>
      {/* The status line already has every Claude: the floating «Claudes» would sit on it. */}
      <Overlays dock={false} />
    </div>
  )
}
