// EV156: what holds the Claude sessions living inside the app (see core/ptyproto.ts). It runs apart from the app
// (host.ts), from its own copy in the data folder (never from where the app is installed, which an update replaces), and
// with the PC's Node.js when there is one: closing or updating the app leaves every session running. Each session's
// screen is kept here too (a terminal without a window), so a view that opens later draws it whole, and the app can read
// its last lines.
import { createServer, type Server, type Socket } from 'node:net'
import { createRequire } from 'node:module'
import { appendFileSync, chmodSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { PTY_PROTO, LineSplitter, decodeMsg, encodeMsg, type FromHost, type PtyInfo, type PtyMeta, type ToHost } from '../core/ptyproto'

export const HOST_VERSION = '1'
/** A finished session stays listed this long, so its last screen can still be read. */
const KEEP_ENDED_MS = 10 * 60_000
const FLUSH_MS = 12

// node-pty is native: it is not bundled, it sits next to host.cjs in node_modules (loaded when the first one starts).
const req = createRequire(import.meta.url)
let ptyMod: typeof import('node-pty') | undefined
const loadPty = (): typeof import('node-pty') => {
  if (ptyMod) return ptyMod
  // macOS and Linux: node-pty starts each session through its small `spawn-helper`, which comes without permission to run
  // when its install step did not run (package.json › allowScripts): «posix_spawnp failed» (14-11, the tests on a Mac).
  if (process.platform !== 'win32') {
    try {
      const dir = dirname(req.resolve('node-pty/package.json'))
      for (const f of [join(dir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'), join(dir, 'build', 'Release', 'spawn-helper')]) {
        try { if (existsSync(f) && !(statSync(f).mode & 0o111)) chmodSync(f, 0o755) } catch { /* read-only: it may already run */ }
      }
    } catch { /* not found: node-pty says why below */ }
  }
  ptyMod = req('node-pty') as typeof import('node-pty')
  return ptyMod
}

interface Session {
  info: PtyInfo
  pty?: import('node-pty').IPty
  term: Terminal
  ser: SerializeAddon
  pending: string
  timer?: NodeJS.Timeout
  /** The last piece sent; `written` the last one the screen here has finished drawing. */
  seq: number
  written: number
}

export interface HostOptions {
  pipe: string
  token: string
  logFile?: string
  /** With no session alive and nobody connected this long, `onIdle` is called (the process then ends). */
  idleMs?: number
  onIdle?: () => void
}

export interface Host {
  server: Server
  sessionCount: () => number
  close: () => Promise<void>
}

export function startHost(o: HostOptions): Promise<Host> {
  const sessions = new Map<string, Session>()
  const clients = new Set<Socket>()
  let lastClientAt = Date.now()
  const log = (line: string): void => {
    try { if (o.logFile) appendFileSync(o.logFile, `${new Date().toISOString()} ${line}\n`) } catch { /* no log */ }
  }

  const send = (sock: Socket, m: FromHost): void => { if (!sock.destroyed) sock.write(encodeMsg(m)) }
  const broadcast = (m: FromHost): void => {
    const line = encodeMsg(m)
    for (const c of clients) if (!c.destroyed) c.write(line)
  }

  const flush = (s: Session): void => {
    if (s.timer) { clearTimeout(s.timer); s.timer = undefined }
    if (!s.pending) return
    const data = s.pending
    s.pending = ''
    const seq = ++s.seq
    s.term.write(data, () => { s.written = Math.max(s.written, seq) })
    broadcast({ op: 'data', id: s.info.id, seq, data })
  }
  /** Runs once everything already sent has been drawn on the screen kept here. */
  const drawn = (s: Session, fn: () => void): void => { flush(s); s.term.write('', fn) }

  const spawnSession = (m: Extract<ToHost, { op: 'spawn' }>): PtyInfo => {
    if (sessions.get(m.id)?.info.alive) throw new Error('ya hay una sesión con ese nombre')
    const cols = Math.max(20, Math.min(400, Math.floor(m.cols) || 100))
    const rows = Math.max(5, Math.min(200, Math.floor(m.rows) || 30))
    const term = new Terminal({ cols, rows, scrollback: 3000, allowProposedApi: true })
    const ser = new SerializeAddon()
    term.loadAddon(ser as never)
    const pty = loadPty().spawn(m.file, m.args, { name: 'xterm-256color', cols, rows, cwd: m.cwd, env: m.env, useConpty: true })
    const now = Date.now()
    const s: Session = {
      info: { id: m.id, pid: pty.pid, meta: m.meta as PtyMeta, startedAt: now, alive: true, cols, rows, lastDataAt: now },
      pty, term, ser, pending: '', seq: 0, written: 0
    }
    sessions.get(m.id)?.term.dispose()
    sessions.set(m.id, s)
    pty.onData((d) => {
      s.pending += d
      s.info.lastDataAt = Date.now()
      if (s.pending.length > 64 << 10) flush(s)
      else if (!s.timer) s.timer = setTimeout(() => flush(s), FLUSH_MS)
    })
    pty.onExit(({ exitCode }) => {
      flush(s)
      s.info.alive = false
      s.info.exitCode = exitCode
      s.info.endedAt = Date.now()
      s.pty = undefined
      log(`terminó ${m.id} (pid ${s.info.pid}, código ${exitCode})`)
      broadcast({ op: 'exit', id: m.id, code: exitCode })
    })
    log(`abierta ${m.id} (pid ${pty.pid}) en ${m.cwd}: ${m.meta.title}`)
    return s.info
  }

  const screenText = (s: Session, lines: number): string => {
    // The last `lines` that have something, ending at the lowest written row: a screen that is half empty (what was just
    // drawn sits at the top) gives its text, not its empty bottom.
    const buf = s.term.buffer.active
    let bottom = buf.baseY + s.term.rows - 1
    while (bottom > 0 && !(buf.getLine(bottom)?.translateToString(true) ?? '').trim()) bottom--
    const top = Math.max(0, bottom - Math.max(1, Math.min(500, lines)) + 1)
    const out: string[] = []
    for (let y = top; y <= bottom; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '')
    return out.join('\n').replace(/\s+$/, '') + '\n'
  }

  const handle = (sock: Socket, m: ToHost): void => {
    const reply = (r: number, value?: unknown, error?: string) => send(sock, { op: 'reply', req: r, ok: !error, value, error })
    switch (m.op) {
      case 'spawn':
        try { reply(m.req, spawnSession(m)) } catch (e) { reply(m.req, undefined, (e as Error).message) }
        return
      case 'write': {
        const s = sessions.get(m.id)
        if (s?.pty && typeof m.data === 'string') s.pty.write(m.data)
        return
      }
      case 'resize': {
        const s = sessions.get(m.id)
        const cols = Math.max(20, Math.min(400, Math.floor(m.cols)))
        const rows = Math.max(5, Math.min(200, Math.floor(m.rows)))
        if (!s || !Number.isFinite(cols) || !Number.isFinite(rows) || (cols === s.info.cols && rows === s.info.rows)) return
        s.info.cols = cols
        s.info.rows = rows
        flush(s)
        try { s.pty?.resize(cols, rows) } catch { /* it has just ended */ }
        s.term.resize(cols, rows)
        return
      }
      case 'kill': {
        const s = sessions.get(m.id)
        if (!s) return reply(m.req, false)
        try { s.pty?.kill() } catch { /* already gone */ }
        return reply(m.req, true)
      }
      case 'forget': {
        const s = sessions.get(m.id)
        if (s && !s.info.alive) { s.term.dispose(); sessions.delete(m.id) }
        return
      }
      case 'list':
        return reply(m.req, [...sessions.values()].map((s) => s.info))
      case 'snapshot': {
        const s = sessions.get(m.id)
        if (!s) return reply(m.req, undefined, 'esa sesión ya no está')
        return drawn(s, () => reply(m.req, { data: s.ser.serialize({ scrollback: 1500 }), seq: s.written, cols: s.info.cols, rows: s.info.rows }))
      }
      case 'screen': {
        const s = sessions.get(m.id)
        if (!s) return reply(m.req, undefined, 'esa sesión ya no está')
        return drawn(s, () => reply(m.req, screenText(s, m.lines)))
      }
    }
  }

  const server = createServer((sock) => {
    sock.setEncoding('utf8')
    let authed = false
    const split = new LineSplitter()
    sock.on('data', (chunk: string) => {
      for (const line of split.push(chunk)) {
        const m = decodeMsg<ToHost>(line)
        if (!m) continue
        if (!authed) {
          // Nothing is said to whoever does not bring the key first (the pipe is the user's; the key makes sure).
          if (m.op !== 'hello' || m.token !== o.token) { sock.destroy(); return }
          authed = true
          clients.add(sock)
          lastClientAt = Date.now()
          send(sock, { op: 'hello', v: PTY_PROTO, pid: process.pid, version: HOST_VERSION })
          continue
        }
        try { handle(sock, m) } catch (e) { log(`fallo en ${m.op}: ${(e as Error).message}`) }
      }
    })
    const gone = () => { if (clients.delete(sock)) lastClientAt = Date.now() }
    sock.on('close', gone)
    sock.on('error', gone)
  })

  const tick = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of sessions) {
      if (!s.info.alive && now - (s.info.endedAt ?? now) > KEEP_ENDED_MS && !clients.size) { s.term.dispose(); sessions.delete(id) }
    }
    const alive = [...sessions.values()].some((s) => s.info.alive)
    if (o.onIdle && !alive && !clients.size && now - lastClientAt > (o.idleMs ?? 90_000)) {
      log('sin sesiones ni nadie conectado: termina')
      o.onIdle()
    }
  }, 15_000)

  const close = async (): Promise<void> => {
    clearInterval(tick)
    for (const s of sessions.values()) { try { s.pty?.kill() } catch { /* gone */ } s.term.dispose() }
    sessions.clear()
    for (const c of clients) c.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return new Promise((resolve, reject) => {
    server.once('error', (e) => { log(`no se pudo abrir la tubería: ${e.message}`); reject(e) })
    if (process.platform !== 'win32') { try { unlinkSync(o.pipe) } catch { /* none left */ } }
    server.listen(o.pipe, () => {
      log(`escuchando (pid ${process.pid}, versión ${HOST_VERSION})`)
      resolve({ server, sessionCount: () => [...sessions.values()].filter((s) => s.info.alive).length, close })
    })
  })
}
