// EV156 (the user, 14-11 ~12:10: «poder añadir el claude dentro de la app, para verlo, igual que lo veo en el cmd, pero
// anclado dentro de la app, y poder soltar su ventana… como si fueran chats dentro de la app»): the Claude sessions that
// live inside the app. They run in the process of src/ptyhost (started here the first time, detached, from its own copy
// in the data folder and with the PC's Node.js when there is one), so closing or updating the app leaves them running;
// the app only draws them: in Chats, all together, or one in a window of its own («Despegar» / «Anclar»).
import { app, BrowserWindow, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../core/paths'
import { PtyClient, type PtySnapshot } from '../core/ptyclient'
import { keyBytes, ptyPipeName, typedLine, type PtyInfo, type PtyMeta } from '../core/ptyproto'

export interface EmbeddedDeps {
  /** Node.js of this PC, or the app's own program as Node (core/shim.ts) when it has none. */
  nodeArgs: (args: string[]) => { file: string; args: string[]; env: NodeJS.ProcessEnv }
  log: (line: string) => void
  changed: () => void
  /** Opens a window of the app on `hash` (the popped-out terminal). */
  openWindow: (w: BrowserWindow, hash: string) => void
  preload: string
  icon: string
  zoom: () => number
  /** Shows the main window on Chats with that session in front. */
  showInApp: (id: string) => void
}

let deps: EmbeddedDeps | undefined
let client: PtyClient | undefined
let connecting: Promise<PtyClient | undefined> | undefined
const sessions = new Map<string, PtyInfo>()
/** Views drawing each session (the main window, a popped-out one, the phone never). */
const viewers = new Map<string, Set<WebContents>>()
/** The last pieces of each session, for a view that asks for its screen while more is arriving. */
const recent = new Map<string, { seq: number; data: string }[]>()
const popped = new Map<string, BrowserWindow>()
/** Windows already watched for closing (attachView). */
const watched = new WeakSet<WebContents>()

export function initEmbedded(d: EmbeddedDeps): void { deps = d }

const hostDir = () => join(paths.root(), 'ptyhost')
const tokenFile = () => join(hostDir(), 'token')
const pipe = () => ptyPipeName(paths.root())

function token(): string {
  mkdirSync(hostDir(), { recursive: true })
  try {
    const t = readFileSync(tokenFile(), 'utf8').trim()
    if (t.length >= 32) return t
  } catch { /* first time */ }
  const t = randomBytes(24).toString('hex')
  writeFileSync(tokenFile(), t, { mode: 0o600 })
  return t
}

/** Where the host's files come from: the installed app's resources, or the build and node_modules when developing. */
function sourceFiles(): { host: string; pty: string } {
  if (app.isPackaged) return { host: join(process.resourcesPath, 'ptyhost', 'host.cjs'), pty: join(process.resourcesPath, 'ptyhost', 'node_modules', 'node-pty') }
  const root = app.getAppPath()
  return { host: join(root, 'out', 'ptyhost', 'host.cjs'), pty: join(root, 'node_modules', 'node-pty') }
}

/**
 * The host's own copy, one folder per version of the app: an update replaces the installed files while the host of the
 * previous version may still be running from its copy, holding sessions.
 */
function runtime(): string {
  const src = sourceFiles()
  if (!existsSync(src.host) || !existsSync(src.pty)) throw new Error('falta el programa de las terminales de la app (vuelve a instalarla)')
  const dir = join(hostDir(), app.getVersion())
  const host = join(dir, 'host.cjs')
  const stale = !existsSync(host) || statSync(host).size !== statSync(src.host).size || (!app.isPackaged && statSync(host).mtimeMs < statSync(src.host).mtimeMs)
  if (stale) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    cpSync(src.host, host)
    const ptyDir = join(dir, 'node_modules', 'node-pty')
    if (!existsSync(join(ptyDir, 'package.json'))) {
      const keep = `${process.platform}-${process.arch}`
      cpSync(src.pty, ptyDir, {
        recursive: true,
        // Only what runs here: its code and this system's native part, without debugging files or sources.
        filter: (f) => {
          const rel = f.slice(src.pty.length).replace(/\\/g, '/')
          if (/\.pdb$/i.test(rel) || /^\/(src|deps|third_party|scripts|typings)(\/|$)/.test(rel)) return false
          const pre = /^\/prebuilds\/([^/]+)/.exec(rel)
          return !pre || pre[1] === keep
        }
      })
    }
  }
  return host
}

async function connectTo(): Promise<PtyClient> {
  const c = new PtyClient({
    data: (id, seq, data) => {
      const list = recent.get(id) ?? []
      list.push({ seq, data })
      if (list.length > 80) list.splice(0, list.length - 80)
      recent.set(id, list)
      const info = sessions.get(id)
      if (info) info.lastDataAt = Date.now()
      for (const w of viewers.get(id) ?? []) { if (!w.isDestroyed()) w.send('pmc:pty', id, data) }
    },
    exit: (id, code) => {
      const info = sessions.get(id)
      if (info) { info.alive = false; info.exitCode = code; info.endedAt = Date.now() }
      for (const w of viewers.get(id) ?? []) { if (!w.isDestroyed()) w.send('pmc:pty-exit', id, code) }
      deps?.log(`terminal de la app: terminó ${info?.meta.title ?? id} (código ${code})`)
      deps?.changed()
    },
    close: () => {
      if (client !== c) return
      client = undefined
      deps?.log('terminal de la app: se cerró la conexión con sus sesiones')
      // Until it is found again they are not shown as alive: with the host gone (closed from the Task Manager, the PC
      // short of memory) they ended with it, and the app must not type into them or count them as open.
      const now = Date.now()
      for (const s of sessions.values()) if (s.alive) { s.alive = false; s.exitCode = s.exitCode ?? -1; s.endedAt = now }
      deps?.changed()
      // A pipe that broke with the host still running: found again in a moment (nothing is started for it).
      setTimeout(() => void ensureClient(false).catch(() => undefined), 2000).unref?.()
    }
  })
  await c.connect(pipe(), token())
  return c
}

/** Connected to the host, starting it when it is not running (and `start`). */
async function ensureClient(start = true): Promise<PtyClient | undefined> {
  if (client?.connected) return client
  // A capture run opens none (PMC_SHOT_PTY=1 is for trying them out there, on its own pipe and data).
  if (process.env.PMC_SHOT_DIR && !process.env.PMC_SHOT_PTY) return undefined
  if (connecting) return connecting
  connecting = (async () => {
    try {
      const c = await connectTo()
      client = c
      deps?.log(`terminal de la app: conectada con sus sesiones (pid ${c.hostPid})`)
    } catch {
      if (!start) return undefined
      const host = runtime()
      const r = deps!.nodeArgs([host, pipe(), tokenFile(), join(hostDir(), 'host.log')])
      const child = spawn(r.file, r.args, { cwd: hostDir(), env: r.env, detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', (e) => deps?.log(`terminal de la app: no arrancó (${e.message})`))
      child.unref()
      let last: Error | undefined
      for (let i = 0; i < 40 && !client; i++) {
        await new Promise((res) => setTimeout(res, 150))
        try { client = await connectTo() } catch (e) { last = e as Error }
      }
      if (!client) throw new Error(`no arrancan las terminales de la app${last ? ` (${last.message})` : ''}`)
      deps?.log(`terminal de la app: arrancado su proceso (pid ${client.hostPid}, con ${r.file})`)
    }
    // What the host has is the truth: the ones it no longer knows leave (ended long ago, or a host that started anew).
    const known = await client!.list()
    for (const id of [...sessions.keys()]) if (!known.some((s) => s.id === id)) { sessions.delete(id); recent.delete(id) }
    for (const s of known) sessions.set(s.id, s)
    deps?.changed()
    return client!
  })().finally(() => { connecting = undefined })
  return connecting
}

/** At start: the sessions that kept running while the app was closed, without starting anything. */
export async function findEmbedded(): Promise<void> {
  try { await ensureClient(false) } catch { /* none */ }
}

export interface StartEmbedded {
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  meta: PtyMeta
  cols?: number
  rows?: number
}

export async function startEmbedded(o: StartEmbedded): Promise<PtyInfo> {
  const c = await ensureClient(true)
  if (!c) throw new Error('las terminales de la app no están disponibles aquí')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(o.env)) if (typeof v === 'string') env[k] = v
  // What a terminal says it is: Claude Code draws in colour and with its box.
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  const id = `t${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const info = await c.spawn({ id, file: o.file, args: o.args, cwd: o.cwd, env, cols: o.cols ?? 110, rows: o.rows ?? 32, meta: o.meta })
  sessions.set(id, info)
  deps?.log(`terminal de la app: abierta ${o.meta.title} (pid ${info.pid})`)
  deps?.changed()
  return info
}

/** One that ended this long ago leaves the list by itself (the wheel closes many; «Retomar aquí» is for the recent). */
const ENDED_KEEP_MS = 30 * 60_000

export function embeddedList(now = Date.now()): PtyInfo[] {
  for (const s of [...sessions.values()]) if (!s.alive && s.endedAt && now - s.endedAt > ENDED_KEEP_MS) forgetEmbedded(s.id)
  return [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt)
}

export const embeddedByPid = (pid: number | undefined): PtyInfo | undefined => (pid ? [...sessions.values()].find((s) => s.pid === pid && s.alive) : undefined)
export const isEmbeddedPid = (pid: number | undefined): boolean => Boolean(embeddedByPid(pid))

/** A view starts drawing a session: its screen as it is now, then everything new through `pmc:pty`. */
export async function attachView(id: string, view: WebContents): Promise<PtySnapshot & { alive: boolean }> {
  const c = await ensureClient(false)
  if (!c) throw new Error('esa terminal ya no está')
  const snap = await c.snapshot(id)
  const set = viewers.get(id) ?? new Set<WebContents>()
  set.add(view)
  viewers.set(id, set)
  // One listener per window, not one per view drawn (Chats draws them again each time it opens).
  if (!watched.has(view)) {
    watched.add(view)
    view.once('destroyed', () => { for (const s of viewers.values()) s.delete(view) })
  }
  // What arrived after the screen was taken, so nothing is drawn twice or lost.
  const after = (recent.get(id) ?? []).filter((r) => r.seq > snap.seq).map((r) => r.data).join('')
  return { ...snap, data: snap.data + after, alive: sessions.get(id)?.alive ?? false }
}

export function detachView(id: string, view: WebContents): void {
  viewers.get(id)?.delete(view)
}

export function inputEmbedded(id: string, data: string): void {
  if (typeof data === 'string' && data.length <= 1 << 20) client?.write(id, data)
}

export function resizeEmbedded(id: string, cols: number, rows: number): void {
  try { client?.resize(id, cols, rows) } catch { /* no connection */ }
  const info = sessions.get(id)
  if (info) { info.cols = cols; info.rows = rows }
}

export async function killEmbedded(id: string): Promise<boolean> {
  const c = await ensureClient(false)
  return c ? c.kill(id) : false
}

/** A finished one out of the list. */
export function forgetEmbedded(id: string): void {
  const info = sessions.get(id)
  if (!info || info.alive) return
  sessions.delete(id)
  recent.delete(id)
  try { client?.forget(id) } catch { /* no connection */ }
  popped.get(id)?.close()
  deps?.changed()
}

// ---- what the rest of the app does with a Claude, when it lives here (consoleTyper.ts asks first) -------------------

/** Text then Enter, apart, as a person types it (together, Claude Code reads it as a pasted line break). */
export async function typeEmbedded(pid: number, text: string): Promise<void> {
  const info = embeddedByPid(pid)
  if (!info || !client) throw new Error('esa terminal ya no está')
  client.write(info.id, typedLine(text))
  await new Promise((r) => setTimeout(r, 450))
  client.write(info.id, '\r')
}

export async function keyEmbedded(pid: number, key: string): Promise<void> {
  const info = embeddedByPid(pid)
  const bytes = keyBytes(key)
  if (!info || !client) throw new Error('esa terminal ya no está')
  if (!bytes) throw new Error('tecla no válida')
  client.write(info.id, bytes)
}

/** «Traer delante»: its own window if it has one, else the app on Chats with it in front. */
export function frontEmbedded(pid: number): void {
  const info = embeddedByPid(pid)
  if (!info) throw new Error('esa terminal ya no está')
  const w = popped.get(info.id)
  if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); return }
  deps?.showInApp(info.id)
}

export async function screenEmbedded(pid: number, lines = 40): Promise<string> {
  const info = embeddedByPid(pid)
  if (!info || !client) throw new Error('esa terminal ya no está')
  return client.screen(info.id, lines)
}

// ---- «Despegar» / «Anclar» ---------------------------------------------------------------------------------------

export const poppedIds = (): string[] => [...popped.keys()]

/** «Despegar»: the session in a window of its own (it keeps running; closing that window docks it again). */
export function popOut(id: string): void {
  const open = popped.get(id)
  if (open && !open.isDestroyed()) { open.show(); open.focus(); return }
  const info = sessions.get(id)
  if (!info || !deps) throw new Error('esa terminal ya no está')
  const w = new BrowserWindow({
    width: 980, height: 680, minWidth: 520, minHeight: 320,
    title: info.meta.title,
    backgroundColor: '#0c0c0f',
    autoHideMenuBar: true,
    icon: deps.icon,
    webPreferences: { preload: deps.preload, sandbox: false, contextIsolation: true, nodeIntegration: false, zoomFactor: deps.zoom() }
  })
  popped.set(id, w)
  w.on('closed', () => { popped.delete(id); deps?.changed() })
  deps.openWindow(w, `/terminal/${id}`)
  deps.changed()
}

/** «Anclar»: back inside the main window. */
export function dock(id: string): void {
  popped.get(id)?.close()
}
