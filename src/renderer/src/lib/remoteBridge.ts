// In a browser (the phone) there is no Electron: the same calls go to Mission Control over the network.
import { phoneUrls } from './phoneUrls'

type Listener = (...args: unknown[]) => void

const listeners = new Map<string, Set<Listener>>()
let source: EventSource | undefined

function fire(channel: string, args: unknown[]) {
  for (const cb of listeners.get(channel) ?? []) cb(...args)
}

function connect() {
  if (source) return
  source = new EventSource('/events')
  for (const channel of ['state', 'assets', 'model-thumb']) {
    source.addEventListener(channel, (e) => fire(channel, phoneUrls(JSON.parse((e as MessageEvent).data || '[]'))))
  }
}

if (!(window as any).pmc) {
  ;(window as any).pmc = {
    platform: 'remote',
    call: async (method: string, ...args: unknown[]) => {
      const r = await fetch(`/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      // Its pictures, at the addresses the phone can open (MC4).
      return phoneUrls(j.ok)
    },
    on: (channel: string, cb: Listener) => {
      connect()
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(cb)
      return () => listeners.get(channel)!.delete(cb)
    }
  }
  // A phone puts the page to sleep: on coming back, the connection is new and everything is read again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    source?.close()
    source = undefined
    connect()
    fire('state', [])
  })
  if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('sw.js').catch(() => undefined)
}

export const isRemote = () => window.pmc.platform === 'remote'
