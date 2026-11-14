// EV131 · «Mosaico»: four big panels at once, each with the section you choose in its corner (Decidir, Chats, Tareas and
// Cuentas to start with). The arrow of a panel opens it whole, with «← Mosaico» to come back. In a narrow window the four
// go one under another.
import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { NAV } from '../components/Sidebar'
import { TitleBar, ScreenBox, PanelBar, Overlays, NavIcon, useBadges, ScreenView, FULL_HEIGHT } from './common'
import './layouts.css'

const KEY = 'pmc.mosaico'
const START: Route[] = ['decisiones', 'chats', 'tareas', 'agentes']

function Tile({ route, onPick, onOpen }: { route: Route; onPick: (r: Route) => void; onOpen: () => void }) {
  const badges = useBadges()
  const fill = FULL_HEIGHT.includes(route)
  const n = NAV.find((x) => x.route === route)
  return (
    <section className="mos-tile" style={{ ['--panel-c' as any]: n?.color }} aria-label={n?.label}>
      <div className="mos-head">
        <NavIcon route={route} size={24} />
        <select className="mos-pick" value={route} onChange={(e) => onPick(e.target.value as Route)} aria-label="Apartado de este panel">
          {NAV.map((x) => <option key={x.route} value={x.route}>{x.label}{badges[x.route] ? ` (${badges[x.route]})` : ''}</option>)}
        </select>
        {badges[route] ? <span className="pill num" style={{ background: 'var(--red)', color: 'white', height: 18, padding: '0 6px' }}>{badges[route]}</span> : null}
        <button className="btn btn-sm btn-icon btn-ghost ml-auto flex-none" onClick={onOpen} title="Abrir este panel entero" aria-label="Abrir entero"><Maximize2 size={14} /></button>
      </div>
      <main className="content mos-body" style={fill ? { overflow: 'hidden', display: 'flex', flexDirection: 'column' } : undefined}>
        <ScreenView route={route} />
      </main>
    </section>
  )
}

export default function Mosaico() {
  const { route, param, go } = useStore()
  const [tiles, setTiles] = useState<Route[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) ?? '') as Route[]; if (Array.isArray(v) && v.length === 4 && v.every((r) => NAV.some((n) => n.route === r))) return v } catch { /* none yet */ }
    return START
  })
  const pick = (i: number, r: Route) => {
    const next = tiles.map((x, k) => (k === i ? r : x))
    setTiles(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private */ }
  }
  // «inicio» is the mosaic; any other section is one of them opened whole (or reached by a link or Ctrl + number), and
  // the project's summary opened whole is #/inicio/resumen.
  const open: Route | undefined = route !== 'inicio' ? route : param === 'resumen' ? 'inicio' : undefined
  return (
    <div className="app lay-mosaico">
      <TitleBar />
      <div className="shell">
        {open ? (
          <ScreenBox route={open}><PanelBar route={open} back="Mosaico" onBack={() => go('inicio')} /></ScreenBox>
        ) : (
          <div className="mosaic">
            {tiles.map((r, i) => <Tile key={i} route={r} onPick={(x) => pick(i, x)} onOpen={() => (r === 'inicio' ? go('inicio', 'resumen') : go(r))} />)}
          </div>
        )}
      </div>
      <Overlays />
    </div>
  )
}
