import { Fragment, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { pickLang, setLang } from '../../core/i18n'
import { MotionConfig } from 'motion/react'
import { StoreProvider, useStore } from './lib/store'
import { api } from './lib/api'
import { NAV } from './components/Sidebar'
import { PhoneShell, usePhone } from './components/PhoneShell'
import { playDing } from './lib/ding'
import { setPanel, usePanel } from './lib/assistantChat'
import { SectionMenu } from './components/TopNav'
import { Dock } from './components/Dock'
import { paletteCss } from './lib/themes'
import { SCREENS, TitleBar, PanelBar, ScreenBox, Overlays } from './layouts/common'
import { LAYOUT_VIEWS } from './layouts'

function useTheme() {
  const { state } = useStore()
  const theme = state?.settings.theme ?? 'system'
  const rm = state?.settings.reduceMotion ?? 'system'
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [sysReduce, setSysReduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const a = window.matchMedia('(prefers-color-scheme: dark)')
    const b = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fa = () => setSysDark(a.matches)
    const fb = () => setSysReduce(b.matches)
    a.addEventListener('change', fa)
    b.addEventListener('change', fb)
    return () => { a.removeEventListener('change', fa); b.removeEventListener('change', fb) }
  }, [])
  const dark = theme === 'dark' || (theme === 'system' && sysDark)
  const reduce = rm === 'on' || (rm === 'system' && sysReduce)
  const look = state?.settings.look ?? 'sobria'
  useEffect(() => { document.documentElement.dataset.look = look }, [look])
  // EV87: the colour theme over the look; its CSS is made once from the list of palettes.
  const palette = state?.settings.palette ?? 'clasico'
  useEffect(() => {
    if (document.getElementById('pmc-palettes')) return
    const el = document.createElement('style')
    el.id = 'pmc-palettes'
    el.textContent = paletteCss()
    document.head.appendChild(el)
  }, [])
  useEffect(() => { document.documentElement.dataset.palette = palette }, [palette])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('reduce-motion', reduce)
  }, [dark, reduce])
  return { reduce }
}

/**
 * EV115 («que la app vaya ligera»): the endless animations (rings, pulses, the map's flowing lines) only run while someone
 * looks. Still when the window is hidden, 5 s after the mouse leaves it while it has no focus (the user in Premiere or
 * in a terminal), or after 90 s with no mouse or keys while it has focus. Any movement over it brings them back.
 */
const STILL_FOCUSED_MS = 90_000
const STILL_UNFOCUSED_MS = 5_000
function useStill() {
  useEffect(() => {
    const root = document.documentElement
    let last = Date.now()
    const update = () => {
      const idle = Date.now() - last
      root.classList.toggle('pmc-still', document.hidden || idle > (document.hasFocus() ? STILL_FOCUSED_MS : STILL_UNFOCUSED_MS))
    }
    const wake = () => { last = Date.now(); if (root.classList.contains('pmc-still')) update() }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focus'] as const
    for (const e of events) window.addEventListener(e, wake, { passive: true })
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    const t = window.setInterval(update, 2_000)
    update()
    return () => {
      for (const e of events) window.removeEventListener(e, wake)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
      window.clearInterval(t)
      root.classList.remove('pmc-still')
    }
  }, [])
}

function Shell() {
  const { route, state, setPalette, openComposer, go } = useStore()
  const stateRef = useRef(state)
  stateRef.current = state
  const { reduce } = useTheme()
  useStill()
  const phone = usePhone()
  const panelOpen = usePanel()
  const panelRef = useRef(panelOpen)
  panelRef.current = panelOpen
  const dingSettings = useRef<{ tone?: string; volume?: number }>({})
  dingSettings.current = { tone: state?.settings?.notifyTone, volume: state?.settings?.notifyVolume }
  useEffect(() => window.pmc.on('ding', () => playDing(dingSettings.current.tone, dingSettings.current.volume)), [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openComposer() }
      // EV85: the assistant, from anywhere.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setPanel(!panelRef.current) }
      // EV69: Ctrl+1…9, the sections in the order of the menu; Ctrl+Tab and Ctrl+Shift+Tab, the next or previous project.
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) { const n = NAV.filter((x) => x.group !== 'ajustes')[Number(e.key) - 1]; if (n) { e.preventDefault(); go(n.route) } }
      if (e.ctrlKey && e.key === 'Tab') {
        const ps = stateRef.current?.projects ?? []
        const i = ps.findIndex((x) => x.id === stateRef.current?.activeProjectId)
        if (ps.length > 1) { e.preventDefault(); void api('setActiveProject', ps[(i + (e.shiftKey ? ps.length - 1 : 1)) % ps.length].id) }
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [setPalette, openComposer, go])
  // EV131: the shape of the app, chosen in Ajustes › Apariencia; the tab shape is the base and loads with the window.
  const layout = state?.settings.layout ?? 'pestanas'
  useEffect(() => { document.documentElement.dataset.layout = layout }, [layout])
  const Screen = SCREENS[route] ?? SCREENS.inicio
  if (route === 'flotante') {
    // The always-on-top window: only the Claudes and the note box.
    return (
      <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
        <Dock floating />
        <Overlays dock={false} />
      </MotionConfig>
    )
  }
  if (phone) {
    return (
      <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
        <PhoneShell Screen={Screen} />
        <Overlays dock={false} />
      </MotionConfig>
    )
  }
  const Other = layout !== 'pestanas' ? LAYOUT_VIEWS[layout] : undefined
  if (Other) {
    return (
      <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
        {/* While its code arrives (a fraction of a second, the first time only), the tab shape keeps the window filled. */}
        <Suspense fallback={<TabsShape />}>
          <Other />
        </Suspense>
      </MotionConfig>
    )
  }
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
      <TabsShape />
    </MotionConfig>
  )
}

/** The base shape (Decidir #127): project tabs, the row of sections, and each section as a panel under them. */
function TabsShape() {
  const { route, go } = useStore()
  const section = route !== 'inicio' ? NAV.find((n) => n.route === route) : undefined
  return (
    <div className="app">
      <TitleBar />
      <SectionMenu />
      <div className="shell">
        {/* EV86 (Decidir #127, «apartados en panel»): every section opens as a panel under the bar, with «← Inicio». */}
        <ScreenBox route={route}>
          {section && <PanelBar route={route} onBack={() => go('inicio')} />}
        </ScreenBox>
      </div>
      <Overlays />
    </div>
  )
}

export function App() {
  return (
    <StoreProvider>
      <LangGate><Shell /></LangGate>
    </StoreProvider>
  )
}

/** EV161: the app's language (Ajustes › General › Idioma; with none chosen, the system's), set before anything draws. */
function LangGate({ children }: { children: ReactNode }) {
  const { state } = useStore()
  const lang = pickLang(state?.settings?.lang, navigator.language)
  setLang(lang)
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  // A new key draws everything again in the new language (texts made outside render, like the menu's, included).
  return <Fragment key={lang}>{children}</Fragment>
}
