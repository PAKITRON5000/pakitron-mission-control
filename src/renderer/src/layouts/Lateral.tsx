import { t } from '../../../core/i18n'
// EV131 · «Barra lateral»: a desktop app as always: the sections and the Claudes down the left, the project in a menu at
// the top, the screen beside. The menu folds to icons (by hand, or by itself in a narrow window).
import { useEffect, useState } from 'react'
import { PanelLeft } from 'lucide-react'
import { useStore } from '../lib/store'
import { Sidebar } from '../components/Sidebar'
import { TitleBar, ScreenBox, PanelBar, Overlays } from './common'
import './layouts.css'

export default function Lateral() {
  const { route, go } = useStore()
  const [narrow, setNarrow] = useState(window.innerWidth < 1100)
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem('pmc.lateral') === 'min' } catch { return false } })
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 1100)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const collapsed = narrow || folded
  const fold = () => { const v = !folded; setFolded(v); try { localStorage.setItem('pmc.lateral', v ? 'min' : 'open') } catch { /* private */ } }
  return (
    <div className="app lay-lateral">
      <TitleBar tabs={false} middle={!narrow && <button className="btn btn-sm btn-icon btn-ghost no-drag flex-none" onClick={fold} title={folded ? t('Abrir el menú') : t('Plegar el menú')} aria-label={folded ? t('Abrir el menú') : t('Plegar el menú')}><PanelLeft size={15} /></button>} />
      <div className="shell">
        <Sidebar width={collapsed ? 62 : 236} collapsed={collapsed} />
        <ScreenBox route={route}>{route !== 'inicio' && <PanelBar route={route} onBack={() => go('inicio')} />}</ScreenBox>
      </div>
      <Overlays />
    </div>
  )
}
