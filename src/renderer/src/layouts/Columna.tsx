// EV131 · «Columna»: the whole app in one narrow column, like on the phone, with its tabs at the bottom and «Más» for the
// rest. For keeping it at one side of the screen while working on the other.
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { NAV } from '../components/Sidebar'
import { TitleBar, ScreenBox, PanelBar, Overlays, NavIcon, useBadges } from './common'
import './layouts.css'

const TABS: Route[] = ['inicio', 'decisiones', 'chats', 'tareas']

export default function Columna() {
  const { route, go } = useStore()
  const badges = useBadges()
  const [more, setMore] = useState(false)
  const inTabs = TABS.includes(route)
  const moreBadge = NAV.filter((n) => !TABS.includes(n.route)).reduce((s, n) => s + (badges[n.route] ?? 0), 0)
  return (
    <div className="app lay-columna">
      <TitleBar tabs={false} />
      <div className="col-stage">
        <div className="col-frame">
          <ScreenBox route={route} className="col-content">{!inTabs && <PanelBar route={route} onBack={() => go('inicio')} />}</ScreenBox>
          <nav className="col-tabs" aria-label="Apartados">
            {TABS.map((r) => {
              const n = NAV.find((x) => x.route === r)!
              return (
                <button key={r} className={`col-tab ${route === r ? 'on' : ''}`} onClick={() => go(r)} aria-current={route === r ? 'page' : undefined}>
                  <NavIcon route={r} size={26} />
                  <span>{n.label}</span>
                  {badges[r] ? <span className="col-badge pill num">{badges[r]}</span> : null}
                </button>
              )
            })}
            <button className={`col-tab ${!inTabs ? 'on' : ''}`} onClick={() => setMore(true)} aria-haspopup="dialog">
              <span className="icon-sq" style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--fill-2)', color: 'var(--label)' }}><Menu size={15} /></span>
              <span>Más</span>
              {moreBadge ? <span className="col-badge pill num">{moreBadge}</span> : null}
            </button>
          </nav>
          {more && (
            <div className="col-more" onClick={() => setMore(false)}>
              <div className="col-more-sheet" role="dialog" aria-label="Todos los apartados" onClick={(e) => e.stopPropagation()}>
                {NAV.filter((n) => !TABS.includes(n.route)).map((n) => (
                  <button key={n.route} className="col-more-item" onClick={() => { go(n.route); setMore(false) }}>
                    <NavIcon route={n.route} size={40} />
                    <span>{n.label}</span>
                    {badges[n.route] ? <span className="col-badge pill num">{badges[n.route]}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Overlays />
    </div>
  )
}
