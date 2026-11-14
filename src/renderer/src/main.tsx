import './lib/remoteBridge'
import { lazy, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './looks.css'
import { App } from './App'
import { pickLang, setLang } from '../../core/i18n'
import { StoreProvider, useStore } from './lib/store'

const ModelThumbCanvas = lazy(() => import('./components/ModelThumbCanvas'))
const TerminalWindow = lazy(() => import('./components/EmbeddedGrid').then((m) => ({ default: m.TerminalWindow })))

// The hidden window that pictures one 3D model shows only that, not the app.
const thumb = /^#\/model-thumb\/(\d+)\/(.+)$/.exec(window.location.hash)
// EV156: a Claude popped out of Chats («Despegar») shows only its terminal.
const term = /^#\/terminal\/([\w-]+)$/.exec(window.location.hash)

// On a phone the app opens on the conversations.
if (!thumb && !term && !window.location.hash && window.pmc?.platform === 'remote' && window.innerWidth < 760) window.location.hash = '#/chats'

// macOS: the window's three buttons sit at the left of the app's bar (styles.css makes room for them there).
document.documentElement.dataset.os = window.pmc?.platform ?? ''

// EV156: «Traer delante» a Claude that lives inside the app: Chats, with its terminal in front.
if (!thumb && !term) window.pmc?.on?.('pty-focus', (id) => {
  // The sheet or overlay it was asked from closes, so the terminal is seen (store.tsx › __pmc.reset).
  ;(window as unknown as { __pmc?: { reset?: () => void } }).__pmc?.reset?.()
  window.location.hash = `#/chats/${encodeURIComponent('pty:' + String(id))}`
})

/** The popped-out terminal speaks the app's language too. */
function Lang({ children }: { children: ReactNode }) {
  const { state } = useStore()
  setLang(pickLang(state?.settings?.lang, navigator.language))
  return <>{children}</>
}

createRoot(document.getElementById('root')!).render(
  thumb
    ? <Suspense fallback={null}><ModelThumbCanvas id={Number(thumb[1])} name={decodeURIComponent(thumb[2])} /></Suspense>
    : term
      ? <StoreProvider><Lang><Suspense fallback={null}><TerminalWindow id={term[1]} /></Suspense></Lang></StoreProvider>
      : <App />
)
