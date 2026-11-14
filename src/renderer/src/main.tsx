import './lib/remoteBridge'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './looks.css'
import { App } from './App'

const ModelThumbCanvas = lazy(() => import('./components/ModelThumbCanvas'))

// The hidden window that pictures one 3D model shows only that, not the app.
const thumb = /^#\/model-thumb\/(\d+)\/(.+)$/.exec(window.location.hash)

// On a phone the app opens on the conversations.
if (!thumb && !window.location.hash && window.pmc?.platform === 'remote' && window.innerWidth < 760) window.location.hash = '#/chats'

// macOS: the window's three buttons sit at the left of the app's bar (styles.css makes room for them there).
document.documentElement.dataset.os = window.pmc?.platform ?? ''

createRoot(document.getElementById('root')!).render(
  thumb
    ? <Suspense fallback={null}><ModelThumbCanvas id={Number(thumb[1])} name={decodeURIComponent(thumb[2])} /></Suspense>
    : <App />
)
