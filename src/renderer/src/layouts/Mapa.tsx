import { t } from '../../../core/i18n'
// EV131 · «Mapa»: the map of the Claudes going to their projects fills the window; the sections sit in a bar at the bottom
// and each opens in a drawer from the right, with the map still in sight beside it. The project's summary is one more
// (#/inicio/resumen). In a narrow window the drawer takes the whole width.
import { X } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { NAV } from '../components/Sidebar'
import { MissionMap } from '../components/MissionMap'
import { TitleBar, ScreenBox, PanelBar, Overlays, NavIcon, useBadges } from './common'
import './layouts.css'

export default function Mapa() {
  const { route, param, go, state } = useStore()
  const badges = useBadges()
  const open: Route | undefined = route !== 'inicio' ? route : param === 'resumen' ? 'inicio' : undefined
  const n = NAV.find((x) => x.route === open)
  return (
    <div className="app lay-mapa">
      <TitleBar />
      <div className={`map-stage ${open ? 'drawer-open' : ''}`}>
        <div className="map-area">
          {state?.projects.length ? <MissionMap /> : <div className="t-head c3 p-10">{t('Añade un proyecto para ver el mapa: el «+» de las pestañas de arriba.')}</div>}
        </div>
        {open && (
          <aside className="map-drawer" aria-label={n?.label ?? t('Resumen')}>
            <ScreenBox route={open}>
              <PanelBar route={open} back={t('Mapa')} onBack={() => go('inicio')} extra={<button className="btn btn-sm btn-icon btn-ghost" onClick={() => go('inicio')} aria-label={t('Cerrar')}><X size={15} /></button>} />
            </ScreenBox>
          </aside>
        )}
        <nav className="map-dock" aria-label={t('Apartados')}>
          {NAV.map((x) => {
            const on = x.route === 'inicio' ? open === 'inicio' : open === x.route
            return (
              <button key={x.route} className={`map-dock-item ${on ? 'on' : ''}`} onClick={() => (on ? go('inicio') : x.route === 'inicio' ? go('inicio', 'resumen') : go(x.route))} title={x.route === 'inicio' ? t('Resumen del proyecto') : x.label} aria-pressed={on}>
                <NavIcon route={x.route} size={30} />
                {badges[x.route] ? <span className="map-dock-badge pill num">{badges[x.route]}</span> : null}
              </button>
            )
          })}
        </nav>
      </div>
      <Overlays />
    </div>
  )
}
