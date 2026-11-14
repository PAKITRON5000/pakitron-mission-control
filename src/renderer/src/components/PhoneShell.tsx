// The app on a phone: everything it is on the PC, with the navigation at the thumb instead of a sidebar.
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Bell, Download, LayoutGrid, MessageCircle, Gavel, ListChecks, MessageSquareText, Menu, X } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { api } from '../lib/api'
import { NAV } from './Sidebar'
import { t } from '../../../core/i18n'

/**
 * The phone layout is for the phone (the web view, narrower than 760 px). On the PC the app is zoomed (1.1 or 1.25), so
 * a window of 900 px was 720 px inside and turned into the phone, with Ajustes and Personalizar gone from the top bar
 * (EV106, the user, 13-11: «lo de ajustes y personalizar según cómo esté la ventana no se ve»). There, only a window
 * really too small for the bars (below 560 px inside) takes it.
 */
const phoneBelow = () => (window.pmc?.platform === 'remote' ? 760 : 560)
export function usePhone(): boolean {
  const [phone, setPhone] = useState(window.innerWidth < phoneBelow())
  useEffect(() => {
    const f = () => setPhone(window.innerWidth < phoneBelow())
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return phone
}

const TABS: { route: Route; label: string; icon: typeof Bell }[] = [
  { route: 'inicio', get label() { return t('Inicio') }, icon: LayoutGrid },
  { route: 'chats', get label() { return t('Chats') }, icon: MessageCircle },
  { route: 'decisiones', get label() { return t('Decidir') }, icon: Gavel },
  { route: 'tareas', get label() { return t('Tareas') }, icon: ListChecks },
  { route: 'revisiones', get label() { return t('Revisar') }, icon: MessageSquareText }
]

function base64ToKey(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '='))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true

// Android offers its own install; it comes once, before anyone asks, so it is kept for the button.
let androidInstall: any
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); androidInstall = e })

/** Apple lets no page install itself: the steps are the shortest there are, in the words Safari uses. */
function InstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="m-sheetBack" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheetTitle">{t('Instalar como app')}</div>
        <ol className="m-steps-install">
          <li>{t('Toca el botón ')}<b>≡</b>{t(' junto a la dirección, abajo. Si en tu Safari ves el botón ')}<b>{t('Compartir')}</b>{t(' (un cuadrado con una flecha), toca ese y salta al paso 3.')}</li>
          <li>{t('Elige ')}<b>{t('Compartir')}</b>.</li>
          <li>{t('Baja por la lista y toca ')}<b>{t('Añadir a pantalla de inicio')}</b>{t('. Si no sale, busca en ')}<b>{t('Más')}</b>.</li>
          <li>{t('Si ves ')}<b>{t('Abrir como app web')}</b>{t(', déjalo activado, y pulsa ')}<b>{t('Añadir')}</b>.</li>
          <li>{t('Cierra Safari y abre ')}<b>{t('Mission')}</b>{t(' desde su icono.')}</li>
        </ol>
        <button className="m-primary" onClick={onClose}>{t('Entendido')}</button>
      </div>
    </div>
  )
}

function useInstall() {
  const [guide, setGuide] = useState(false)
  const install = async () => {
    if (!androidInstall) return setGuide(true)
    androidInstall.prompt()
    androidInstall = undefined
  }
  return { install, sheet: guide ? <InstallSheet onClose={() => setGuide(false)} /> : null }
}

/** Offers the phone's notices; on an iPhone they only exist once the page is on the home screen, so it says so first. */
function PushOffer({ onInstall }: { onInstall: () => void }) {
  const { toast } = useStore()
  const standalone = isInstalled()
  const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [hidden, setHidden] = useState(() => localStorage.getItem('pmc.pushOffer') === 'no' || (can && Notification.permission === 'granted'))
  if (hidden) return null
  const close = () => { localStorage.setItem('pmc.pushOffer', 'no'); setHidden(true) }
  if (!standalone) {
    return (
      <div className="m-offer m-offer--go">
        <button className="flex items-center gap-2.5 flex-1 min-w-0 text-left" style={{ color: 'white', fontWeight: 600 }} onClick={onInstall}><Download size={18} className="flex-none" /><span className="flex-1">{t('Instalar como app, sin Safari y con avisos')}</span></button>
        <button onClick={close} aria-label={t('Cerrar')} style={{ color: 'white' }}><X size={16} /></button>
      </div>
    )
  }
  if (!can) return null
  const enable = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') return toast(t('Sin permiso no puedo avisarte'))
      const reg = await navigator.serviceWorker.ready
      const key = await api<string>('pushKey')
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToKey(key) })
      await api('pushAdd', sub.toJSON())
      toast(t('Avisos activados'))
      setHidden(true)
    } catch (e) { toast((e as Error).message) }
  }
  return <button className="m-offer m-offer--go" onClick={() => void enable()}><Bell size={18} className="flex-none" /><span className="flex-1 text-left">{t('Toca aquí para que te avise cuando necesite algo')}</span></button>
}

/**
 * EV158 (the user, 14-11 12:18: «añadir una forma de cambiar entre proyectos fácil para el móvil»): the projects along
 * the top, as on the PC's tabs, each with what waits for the user there; the active one is the one every screen shows.
 */
function PhoneProjects() {
  const { state, toast } = useStore()
  const bar = useRef<HTMLElement>(null)
  // The active one in sight: with four projects the fourth was off the edge, and nothing said which one was showing.
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>('button.on')
    if (el && bar.current) bar.current.scrollTo({ left: el.offsetLeft - (bar.current.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
  }, [state?.activeProjectId, state?.projects.length])
  if (!state || state.projects.length < 2) return null
  return (
    <nav ref={bar} className="m-projects" aria-label={t('Proyectos')}>
      {state.projects.map((p) => {
        const on = p.id === state.activeProjectId
        const x = state.pending?.[p.id]
        const waiting = (x?.decisions ?? 0) + (x?.review ?? 0) + (x?.comments ?? 0)
        return (
          <button key={p.id} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}
            onClick={() => { if (!on) void api('setActiveProject', p.id).catch((e) => toast((e as Error).message)) }}
            style={on ? { boxShadow: `inset 0 0 0 1.5px ${p.color}` } : undefined}>
            <span className="dot flex-none" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
            {waiting > 0 && <span className="m-badge" style={{ position: 'static', marginLeft: 2 }}>{waiting}</span>}
          </button>
        )
      })}
    </nav>
  )
}

export function PhoneShell({ Screen }: { Screen: ComponentType }) {
  const { route, go, state } = useStore()
  const [more, setMore] = useState(false)
  const count: Partial<Record<Route, number>> = { tareas: state?.summary?.tasks.review, revisiones: state?.commentsToReview, decisiones: state?.decisionsPending }
  const inTabs = TABS.some((t) => t.route === route)
  const { install, sheet } = useInstall()
  return (
    <div className="m-app">
      <PushOffer onInstall={() => void install()} />
      <PhoneProjects />
      <main className="content m-content"><Screen key={route} /></main>
      <nav className="m-tabs" aria-label={t('Navegación')}>
        {TABS.map((t) => (
          <button key={t.route} className={route === t.route ? 'on' : ''} onClick={() => go(t.route)}>
            <span className="relative"><t.icon size={23} />{count[t.route] ? <span className="m-badge">{count[t.route]}</span> : null}</span>
            {t.label}
          </button>
        ))}
        <button className={!inTabs ? 'on' : ''} onClick={() => setMore(true)}><Menu size={23} />{t('Más')}</button>
      </nav>
      {sheet}
      {more && (
        <div className="m-sheetBack" onClick={() => setMore(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            {!isInstalled() && <button className="m-primary" onClick={() => { setMore(false); void install() }}>{t('Instalar como app')}</button>}
            <div className="m-moreGrid">
              {NAV.filter((n) => !TABS.some((t) => t.route === n.route)).map((n) => (
                <button key={n.route} onClick={() => { go(n.route); setMore(false) }}>
                  <span className="icon-sq" style={{ background: n.color, color: 'white', width: 40, height: 40, borderRadius: 11 }}><n.icon size={21} /></span>
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
