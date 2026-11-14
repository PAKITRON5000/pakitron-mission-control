import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, onState, type DashboardState } from './api'
import { ACCOUNT_ALIAS, ACCOUNT_COLOR, ACCOUNT_NAME } from '../components/ui'

export type Route = 'chats' | 'inicio' | 'asistente' | 'decisiones' | 'relevos' | 'skills' | 'proximo' | 'agentes' | 'tareas' | 'galeria' | 'revisiones' | 'cronologia' | 'integracion' | 'memoria' | 'ajustes' | 'flotante'
export const ROUTES: Route[] = ['chats', 'inicio', 'asistente', 'decisiones', 'relevos', 'skills', 'proximo', 'agentes', 'tareas', 'galeria', 'revisiones', 'cronologia', 'integracion', 'memoria', 'ajustes', 'flotante']

/** What a search led to: the screen scrolls to it and makes it glow, so it never has to be looked for twice. */
export interface Focus { kind: 'task' | 'asset' | 'decision' | 'note'; id: number; q?: string; n: number }

interface Ctx {
  state?: DashboardState
  route: Route
  param?: string
  go: (r: Route, param?: string) => void
  refresh: () => Promise<void>
  toast: (text: string) => void
  toastText?: string
  composer: { open: boolean; preset?: { text?: string; kind?: string; target?: string } }
  openComposer: (preset?: { text?: string; kind?: string; target?: string }) => void
  closeComposer: () => void
  palette: boolean
  setPalette: (v: boolean) => void
  agentOpen?: string
  setAgentOpen: (id?: string) => void
  viewer?: number
  setViewer: (id?: number, list?: number[]) => void
  viewerList?: number[]
  now: number
  focus?: Focus
  jump: (r: Route, f: Omit<Focus, 'n'>) => void
  clearFocus: () => void
}

const C = createContext<Ctx>(null as unknown as Ctx)
export const useStore = () => useContext(C)

function parseHash(): { route: Route; param?: string } {
  const [r, p] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { route: (ROUTES as string[]).includes(r) ? (r as Route) : 'inicio', param: p ? decodeURIComponent(p) : undefined }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>()
  const [{ route, param }, setRoute] = useState(parseHash)
  const [toastText, setToast] = useState<string>()
  const [composer, setComposer] = useState<Ctx['composer']>({ open: false })
  const [palette, setPalette] = useState(false)
  const [agentOpen, setAgentOpen] = useState<string>()
  const [viewer, setViewerId] = useState<number>()
  const [viewerList, setViewerList] = useState<number[]>()
  // The list it was opened from (gallery with its filters, home mosaic, a day in the timeline): what ← → walks through.
  const setViewer = useCallback((id?: number, list?: number[]) => {
    setViewerId(id)
    if (id == null) setViewerList(undefined)
    else if (list) setViewerList(list)
  }, [])
  const [now, setNow] = useState(Date.now())
  const [focus, setFocus] = useState<Focus>()
  const focusN = useRef(0)
  const toastTimer = useRef<number>(undefined)
  const pending = useRef(false)

  const load = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    try {
      const s = await api<DashboardState>('state')
      // Accounts added in Ajustes bring their own colour.
      for (const a of s.accounts ?? []) { ACCOUNT_COLOR[a.id] = a.color; ACCOUNT_ALIAS[a.id] = a.alias; ACCOUNT_NAME[a.id] = a.name || undefined }
      setState(s)
    } finally {
      pending.current = false
    }
  }, [])

  useEffect(() => {
    void load()
    const off = onState(() => void load())
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    const tick = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      off()
      window.removeEventListener('hashchange', onHash)
      window.clearInterval(tick)
    }
  }, [load])

  const go = useCallback((r: Route, p?: string) => {
    window.location.hash = `#/${r}${p ? '/' + encodeURIComponent(p) : ''}`
  }, [])

  const jump = useCallback((r: Route, f: Omit<Focus, 'n'>) => {
    focusN.current++
    setFocus({ ...f, n: focusN.current })
    window.location.hash = `#/${r}`
  }, [])
  const clearFocus = useCallback(() => setFocus(undefined), [])

  const toast = useCallback((t: string) => {
    setToast(t)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(undefined), 3200)
  }, [])

  const refresh = useCallback(async () => {
    setState(await api<DashboardState>('refresh'))
  }, [])

  // Hook for the visual review mode (PMC_SHOT_STEPS): opens overlays from the main process.
  useEffect(() => {
    ;(window as any).__pmc = {
      setViewer, setAgentOpen, setPalette,
      openComposer: (preset?: Ctx['composer']['preset']) => setComposer({ open: true, preset }),
      reset: () => { setViewer(undefined); setAgentOpen(undefined); setPalette(false); setComposer({ open: false }) }
    }
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      state, route, param, go, refresh, toast, toastText, composer,
      openComposer: (preset) => setComposer({ open: true, preset }),
      closeComposer: () => setComposer({ open: false }),
      palette, setPalette, agentOpen, setAgentOpen, viewer, setViewer, viewerList, now, focus, jump, clearFocus
    }),
    [state, route, param, go, refresh, toast, toastText, composer, palette, agentOpen, viewer, viewerList, setViewer, now, focus, jump, clearFocus]
  )
  return <C.Provider value={value}>{children}</C.Provider>
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn().then(
      (d) => { if (alive) { setData(d); setLoading(false) } },
      () => { if (alive) setLoading(false) }
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { data, loading, reload: () => setN((x) => x + 1) }
}
