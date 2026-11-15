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

const call = async (method: string, ...args: unknown[]) => {
  const r = await fetch(`/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  // Its pictures, at the addresses the phone can open (MC4).
  return phoneUrls(j.ok)
}

// EV197: the Claudes inside the app, drawn on the phone as on the PC (AppTerminal.tsx). Each one drawn has its own stream
// (/pty?id=…, main/remote.ts): its screen first, then what it writes. Keys go in order, one after the other: sent all at
// once, they could arrive shuffled.
interface PtySnap { cols: number; rows: number; data: string; seq: number; alive: boolean }
const ptys = new Map<string, EventSource>()
const sending = new Map<string, Promise<unknown>>()
const inOrder = (id: string, method: string, ...args: unknown[]): Promise<unknown> => {
  const run = (sending.get(id) ?? Promise.resolve()).then(() => call(method, id, ...args))
  sending.set(id, run.catch(() => undefined))
  return run
}
function openPty(id: string, first?: { resolve: (s: PtySnap) => void; reject: (e: Error) => void }) {
  ptys.get(id)?.close()
  const es = new EventSource(`/pty?id=${encodeURIComponent(id)}`)
  ptys.set(id, es)
  let waiting = first
  es.addEventListener('snap', (e) => {
    const snap = JSON.parse((e as MessageEvent).data) as PtySnap
    if (waiting) { waiting.resolve(snap); waiting = undefined }
    // Connected again (the phone slept, the network changed): the screen drawn anew from what it is now.
    else { fire('pty-size', [id, snap.cols, snap.rows]); fire('pty', [id, '\x1bc' + snap.data]); window.dispatchEvent(new CustomEvent('pmc-pty-back', { detail: id })) }
  })
  es.addEventListener('data', (e) => fire('pty', [id, JSON.parse((e as MessageEvent).data)]))
  // EV202: the size Claude Code draws for now (another view took it, or gave it back).
  es.addEventListener('size', (e) => { const [c, r] = JSON.parse((e as MessageEvent).data) as [number, number]; fire('pty-size', [id, c, r]) })
  es.addEventListener('exit', (e) => fire('pty-exit', [id, JSON.parse((e as MessageEvent).data)]))
  es.addEventListener('fail', (e) => {
    es.close()
    if (ptys.get(id) === es) ptys.delete(id)
    if (waiting) { waiting.reject(new Error(JSON.parse((e as MessageEvent).data))); waiting = undefined }
  })
  es.onerror = () => { if (waiting && es.readyState === EventSource.CLOSED) { waiting.reject(new Error('Sin conexión con el PC')); waiting = undefined } }
}

if (!(window as any).pmc) {
  ;(window as any).pmc = {
    platform: 'remote',
    call,
    pty: {
      attach: (id: string) => new Promise<PtySnap>((resolve, reject) => openPty(id, { resolve, reject })),
      detach: (id: string) => { ptys.get(id)?.close(); ptys.delete(id) },
      input: (id: string, data: string) => { void inOrder(id, 'ptyInput', data).catch(() => undefined) },
      resize: (id: string, cols: number, rows: number) => { void inOrder(id, 'ptyResize', cols, rows).catch(() => undefined) }
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
    // A terminal whose stream the phone closed while asleep opens again (and draws its screen anew).
    for (const [id, es] of ptys) if (es.readyState === EventSource.CLOSED) openPty(id)
  })
  if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('sw.js').catch(() => undefined)
}

export const isRemote = () => window.pmc.platform === 'remote'
/** EV197: a line or a key into a Claude inside the app, from the phone's bar, in order with what was typed before. */
export const ptyType = (id: string, text: string) => inOrder(id, 'ptyType', text)
export const ptyKey = (id: string, key: string) => inOrder(id, 'ptyKey', key)
