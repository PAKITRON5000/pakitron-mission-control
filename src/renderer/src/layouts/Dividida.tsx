// EV131 · «Dos paneles»: two sections at once, side by side (the Chats while answering in Decidir, the Tasks next to the
// Gallery). The left one is the app's own place (links and Ctrl + number move it); the right one keeps its own choice.
// In a window too narrow for two, only the left one, and «⇄» swaps them.
import { useEffect, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { NAV } from '../components/Sidebar'
import { TitleBar, Overlays, NavIcon, useBadges, ScreenView, FULL_HEIGHT } from './common'
import './layouts.css'

function PaneHead({ route, onPick, extra }: { route: Route; onPick: (r: Route) => void; extra?: React.ReactNode }) {
  const badges = useBadges()
  const n = NAV.find((x) => x.route === route)
  return (
    <div className="pane-head">
      <span className="pane-title">{n?.label ?? 'Inicio'}</span>
      <div className="pane-picks" role="tablist" aria-label="Apartado de este panel">
        {NAV.map((x) => (
          <button key={x.route} role="tab" aria-selected={x.route === route} className={`pane-pick ${x.route === route ? 'on' : ''}`} onClick={() => onPick(x.route)} title={x.label}>
            <NavIcon route={x.route} size={24} />
            {badges[x.route] ? <span className="pane-dot" /> : null}
          </button>
        ))}
      </div>
      {extra}
    </div>
  )
}

function Pane({ route }: { route: Route }) {
  const fill = FULL_HEIGHT.includes(route)
  const n = NAV.find((x) => x.route === route)
  return (
    <main className={`content pane-body ${route !== 'inicio' ? 'as-panel' : ''}`} style={{ ...(fill ? { overflow: 'hidden', display: 'flex', flexDirection: 'column' } : {}), ...(n ? { ['--panel-c' as any]: n.color } : {}) }}>
      <ScreenView route={route} />
    </main>
  )
}

const KEY = 'pmc.dividida'

export default function Dividida() {
  const { route, go } = useStore()
  const [right, setRight] = useState<Route>(() => { try { return (localStorage.getItem(KEY) as Route) || 'chats' } catch { return 'chats' } })
  const [two, setTwo] = useState(window.innerWidth >= 1100)
  useEffect(() => {
    const f = () => setTwo(window.innerWidth >= 1100)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const pickRight = (r: Route) => { setRight(r); try { localStorage.setItem(KEY, r) } catch { /* private */ } }
  // The same section on both sides says nothing twice: the right one moves to another.
  const shown: Route = right === route ? (route === 'chats' ? 'decisiones' : 'chats') : right
  const swap = () => { const l = route; go(shown); pickRight(l) }
  const swapBtn = <button className="btn btn-sm btn-icon btn-ghost flex-none" onClick={swap} title="Cambiar de lado los dos paneles" aria-label="Cambiar de lado"><ArrowLeftRight size={15} /></button>
  return (
    <div className="app lay-dividida">
      <TitleBar />
      <div className={`split ${two ? 'two' : ''}`}>
        <section className="pane" aria-label="Panel izquierdo">
          <PaneHead route={route} onPick={(r) => go(r)} extra={!two && swapBtn} />
          <Pane route={route} />
        </section>
        {two && (
          <section className="pane" aria-label="Panel derecho">
            <PaneHead route={shown} onPick={pickRight} extra={swapBtn} />
            <Pane route={shown} />
          </section>
        )}
      </div>
      <Overlays />
    </div>
  )
}
