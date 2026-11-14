import { t } from '../../../core/i18n'
// EV131: the pieces every shape of the app shares (layouts/meta.ts): the screens by route, the title bar, one screen in a
// box with its fade, the way back with its «?», the marks of what waits, and what floats over any shape.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, Plus, RefreshCw, ChevronDown, Check, FolderPlus, ArrowLeft, Download } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { api } from '../lib/api'
import { NAV } from '../components/Sidebar'
import { Palette } from '../components/Palette'
import { Composer } from '../components/Composer'
import { AgentSheet } from '../components/AgentSheet'
import { Viewer } from '../components/Viewer'
import { ModelThumbnailer } from '../components/ModelThumbnailer'
import { Dock } from '../components/Dock'
import { AssistantBubble, AssistantButton } from '../components/AssistantBubble'
import { ProjectTabs } from '../components/TopNav'
import { SPRING } from '../components/ui'
import { ago } from '../lib/format'
import { Chats } from '../screens/Chats'
import { Home } from '../screens/Home'
import { Tasks } from '../screens/Tasks'
import { Gallery } from '../screens/Gallery'
import { Timeline } from '../screens/Timeline'
import { Reviews, Integration, Memory, SettingsScreen } from '../screens/Other'
import { Accounts } from '../screens/Accounts'
import { Decisions } from '../screens/Decisions'
import { Next } from '../screens/Next'
import { Relays } from '../screens/Relays'
import { Skills } from '../screens/Skills'
import { Assistant } from '../screens/Assistant'

export const SCREENS: Record<Route, ComponentType> = {
  chats: Chats, inicio: Home, asistente: Assistant, decisiones: Decisions, relevos: Relays, skills: Skills, proximo: Next, agentes: Accounts,
  tareas: Tasks, galeria: Gallery, revisiones: Reviews, cronologia: Timeline, integracion: Integration, memoria: Memory, ajustes: SettingsScreen, flotante: Home
}

/** Screens that fill their box themselves (their own scroll inside), instead of scrolling with it. */
export const FULL_HEIGHT: Route[] = ['tareas', 'asistente']

/** EV68: what each section is for, in one line (for anyone who opens the app for the first time). */
export const HELP: Partial<Record<Route, string>> = {
  get decisiones() { return t('Lo que los Claude te preguntan: contesta y les llega al momento') },
  get revisiones() { return t('Las correcciones que pediste sobre imágenes y vídeos, para aprobarlas') },
  get asistente() { return t('Pregunta lo que quieras o pide algo para un Claude, sin gastar uso') },
  get relevos() { return t('Quién trabaja en cada proyecto y quién sigue cuando se agote') },
  get proximo() { return t('Cuándo vuelve cada cuenta y qué hará después') },
  get chats() { return t('Las conversaciones de los Claude, abiertas y guardadas') },
  get agentes() { return t('Tus cuentas de Claude: uso, estado y ventanas') },
  get skills() { return t('Lo que saben hacer los Claude y lo que les vendría bien') },
  get tareas() { return t('Lo que queda por hacer en el proyecto, lo que se hace y lo hecho') },
  get galeria() { return t('Todas las imágenes, vídeos y modelos del proyecto') },
  get cronologia() { return t('Lo que ha pasado, día a día') },
  get integracion() { return t('Las ramas y copias de trabajo del proyecto') },
  get memoria() { return t('Lo que los Claude no deben olvidar y lo que has pedido') },
  get ajustes() { return t('Tamaño, colores, forma de la app, cuentas, avisos y copias de seguridad') }
}

export const keysHelp = () => t('Ctrl + K busca cualquier cosa · Ctrl + J abre el asistente · Ctrl + N, una instrucción nueva · Ctrl + 1…9, los apartados · Ctrl + Tab, el siguiente proyecto · Ctrl + / Ctrl −, el tamaño de la letra.')

/** The red marks of what waits for the user, by section (Decidir counts every project). */
export function useBadges(): Partial<Record<Route, number>> {
  const { state } = useStore()
  const allDecisions = Object.values(state?.pending ?? {}).reduce((n, x) => n + x.decisions, 0)
  return { tareas: state?.summary?.tasks.review || undefined, revisiones: state?.commentsToReview || undefined, decisiones: allDecisions || undefined }
}

/** One section's icon square, in its colour. */
export function NavIcon({ route, size = 22 }: { route: Route; size?: number }) {
  const n = NAV.find((x) => x.route === route)
  if (!n) return null
  const I = n.icon
  return <span className="icon-sq" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: n.color, color: n.color === 'var(--yellow)' ? '#3a2a00' : 'white' }}><I size={Math.round(size * 0.6)} strokeWidth={2.3} /></span>
}

/** The project in a menu, for the shapes without the tabs. */
export function ProjectSwitcher() {
  const { state, toast } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', f)
    return () => window.removeEventListener('mousedown', f)
  }, [open])
  const p = state?.projects.find((x) => x.id === state.activeProjectId)
  const waiting = Object.entries(state?.pending ?? {}).filter(([id]) => id !== state?.activeProjectId).reduce((n, [, x]) => n + x.decisions, 0)
  return (
    <div className="relative no-drag min-w-0" ref={ref}>
      <button className="btn btn-ghost btn-sm min-w-0" style={{ height: 30 }} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={t('Cambiar de proyecto (Ctrl + Tab)')}>
        <span className="dot flex-none" style={{ background: p?.color ?? 'var(--label-3)' }} />
        <span className="t-head truncate">{p?.name ?? t('Sin proyecto')}</span>
        {waiting > 0 && <span className="pill num flex-none" style={{ background: 'var(--red)', color: 'white', height: 18, padding: '0 6px' }} title={t('Preguntas en otros proyectos')}>{waiting}</span>}
        <ChevronDown size={13} className="c3 flex-none" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={SPRING}
            style={{ transformOrigin: 'top left' }} className="absolute left-0 top-9 z-50 w-72 p-1.5 card" role="menu">
            {state?.projects.map((x) => (
              <button key={x.id} className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg border-0 bg-transparent hover:bg-[var(--fill)]" onClick={() => { void api('setActiveProject', x.id); setOpen(false) }}>
                <span className="dot" style={{ background: x.color }} />
                <span className="min-w-0 flex-1"><span className="t-body block truncate" style={{ fontWeight: 560 }}>{x.name}</span><span className="t-small c3 block truncate">{x.root}</span></span>
                {state.pending?.[x.id]?.decisions ? <span className="pill num flex-none" style={{ background: 'var(--red)', color: 'white' }} title={t('Preguntas en Decidir')}>{state.pending[x.id].decisions}</span> : null}
                {x.id === state.activeProjectId && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
            <div className="hairline my-1" />
            <button className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg border-0 bg-transparent hover:bg-[var(--fill)] t-body" onClick={() => { setOpen(false); void api<any>('addProject').then((r) => r && toast(t('Proyecto añadido: {name}', { name: r.name }))) }}>
              <FolderPlus size={15} className="c3" />{t(' Añadir proyecto…')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** A newer version on GitHub (core/updates.ts): a button in the bar that opens its installer for this system. */
function UpdatePill() {
  const [u, setU] = useState<{ version: string } | undefined>()
  const [busy, setBusy] = useState(false)
  const { toast } = useStore()
  useEffect(() => {
    if (window.pmc?.platform === 'remote') return
    const look = () => { void api<any>('updateInfo').then((r) => setU(r?.update)).catch(() => undefined) }
    // The app asks GitHub 20 s after it starts; the bar looks a little later, then every half hour.
    const first = setTimeout(look, 25_000)
    const id = setInterval(look, 30 * 60_000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [])
  if (!u) return null
  return (
    <button className="btn btn-sm no-drag flex-none inline-flex items-center gap-1.5" style={{ background: 'var(--accent)', color: 'white', borderRadius: 99 }}
      title={t('Descarga el instalador. Se instala encima de esta versión y no pierdes nada.')} disabled={busy}
      onClick={() => { setBusy(true); toast(t('Descargando la versión {v0}…', { v0: u.version })); void api('installUpdate').catch((e: Error) => { toast(e.message); void api('openUpdate') }).finally(() => setBusy(false)) }}>
      <Download size={14} strokeWidth={2.4} /> {t('Versión {v0} disponible', { v0: u.version })}
    </button>
  )
}

/** The window's own bar: the mark, the projects (tabs or a menu), search, assistant, refresh and a new instruction. */
export function TitleBar({ tabs = true, middle }: { tabs?: boolean; middle?: ReactNode }) {
  const { state, setPalette, openComposer, refresh, now } = useStore()
  const [spin, setSpin] = useState(false)
  return (
    <header className="titlebar">
      <span className="flex-none rounded-[8px] ml-1 mr-1" style={{ width: 22, height: 22, background: 'linear-gradient(135deg, var(--indigo), var(--pink))' }} aria-hidden />
      {tabs ? <ProjectTabs /> : <ProjectSwitcher />}
      {middle}
      <div className="ml-auto flex items-center gap-2 flex-none">
        <UpdatePill />
        <button className="no-drag flex items-center justify-center min-[1200px]:justify-start gap-2 h-[30px] w-[34px] px-0 min-[1200px]:px-3 rounded-[8px] border-0 t-small c3 min-[1200px]:w-[min(260px,19vw)]" title={t('Buscar (Ctrl+K)')} style={{ background: 'var(--fill)' }} onClick={() => setPalette(true)} aria-label={t('Buscar (Ctrl+K)')}>
          <Search size={14} className="flex-none" /> <span className="truncate hidden min-[1200px]:inline">{t('Buscar')}</span> <span className="kbd ml-auto hidden min-[1200px]:inline">{t('Ctrl K')}</span>
        </button>
        <AssistantButton />
        <button className="btn btn-sm btn-icon btn-ghost hidden min-[1200px]:inline-flex" aria-label={t('Actualizar')} title={state?.refreshedAt?.agents ? t('Actualizado {v0}', { v0: ago(state.refreshedAt.agents, now) }) : t('Actualizar')} onClick={async () => { setSpin(true); await refresh(); setSpin(false) }}>
          <RefreshCw size={15} className={spin ? 'animate-spin' : ''} />
        </button>
        <button className="btn btn-sm btn-icon btn-primary rounded-full" style={{ borderRadius: 99, width: 30, height: 30 }} onClick={() => openComposer()} aria-label={t('Nueva instrucción (Ctrl+N)')} title={t('Nueva instrucción (Ctrl+N)')}><Plus size={17} strokeWidth={2.4} /></button>
      </div>
    </header>
  )
}

/** The way back and the «?» of a section, at the top of its box. `back` says where back goes. */
export function PanelBar({ route, back = t('Inicio'), onBack, extra }: { route: Route; back?: string; onBack: () => void; extra?: ReactNode }) {
  const [help, setHelp] = useState(false)
  useEffect(() => setHelp(false), [route])
  const n = NAV.find((x) => x.route === route)
  return (
    <div className="panel-bar">
      <button className="panel-back" onClick={onBack} title={t('Volver a {back}', { back })}><ArrowLeft size={15} strokeWidth={2.4} /> {back}</button>
      {extra}
      <span className="relative ml-auto flex-none">
        <button className="panel-back" style={{ width: 30, padding: 0, justifyContent: 'center' }} onClick={() => setHelp(!help)} aria-expanded={help} title={t('Ayuda de esta pantalla')}>?</button>
        {help && n && (
          <div className="card p-4 absolute right-0 top-9 z-20 flex flex-col gap-2" style={{ width: 320 }} onMouseLeave={() => setHelp(false)}>
            <b className="t-head">{n.label}</b>
            <span className="t-small c2">{HELP[route] ?? ''}</span>
            <span className="t-small c3">{keysHelp()}</span>
            <span className="t-small c3">{t('¿Dudas? Pregúntale al asistente: «¿para qué sirve ')}{n.label}?»</span>
          </div>
        )}
      </span>
    </div>
  )
}

/** One screen, faded in when it changes. `fill`: the screens with their own scroll fill the box. */
export function ScreenView({ route }: { route: Route }) {
  const { state } = useStore()
  const Screen = SCREENS[route] ?? Home
  const fill = FULL_HEIGHT.includes(route)
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={route + (state?.activeProjectId ?? '')} className={fill ? 'flex-1 min-h-0' : ''} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
        <Screen />
      </motion.div>
    </AnimatePresence>
  )
}

/** What floats over any shape: search, the composer, an account's sheet, the viewer, the dock, the assistant, the toast. */
export function Overlays({ dock = true }: { dock?: boolean }) {
  const { toastText } = useStore()
  return (
    <>
      <Palette />
      <Composer />
      <AgentSheet />
      <Viewer />
      <ModelThumbnailer />
      {dock && <Dock />}
      <AssistantBubble />
      <AnimatePresence>
        {toastText && (
          <motion.div className="toast" style={{ x: '-50%' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={SPRING} role="status">{toastText}</motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** A box that scrolls with one screen inside, as `.content` does in the tab shape. */
export function ScreenBox({ route, className = '', style, children }: { route: Route; className?: string; style?: React.CSSProperties; children?: ReactNode }) {
  const fill = FULL_HEIGHT.includes(route)
  const n = NAV.find((x) => x.route === route)
  return (
    <main className={`content ${route !== 'inicio' ? 'as-panel' : ''} ${className}`} style={{ ...(fill ? { overflow: 'hidden', display: 'flex', flexDirection: 'column' } : {}), ...(n && route !== 'inicio' ? { ['--panel-c' as any]: n.color } : {}), ...style }}>
      {children}
      <ScreenView route={route} />
    </main>
  )
}
