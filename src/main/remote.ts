// Mission Control on the phone: the same app, served to a browser. It listens only on this PC; Tailscale carries it to the
// user's own devices over HTTPS, from anywhere, and nothing is open to the internet. Requests whose address or origin is
// not that private one are refused, so a web page open on this PC cannot reach it either.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import QRCode from 'qrcode'
import webpush from 'web-push'
import { paths } from '../core/paths'

export const REMOTE_PORT = 8377
// Tailscale's command: in its folder on Windows; on a Mac inside the app from the App Store or its website, or Homebrew's.
const TAILSCALE = process.platform === 'win32'
  ? 'C:\\Program Files\\Tailscale\\tailscale.exe'
  : ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale'].find((p) => existsSync(p)) ?? '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ttf': 'font/ttf'
}

interface Saved { vapid?: { publicKey: string; privateKey: string }; subs: webpush.PushSubscription[] }

/** EV197: what the phone's terminal is sent as it draws it (main/embedded.ts › PtyView). */
export interface RemotePtyView { send(channel: string, ...args: unknown[]): void; isDestroyed(): boolean }

export interface RemoteDeps {
  rootDir: string
  call: (method: string, args: unknown[]) => Promise<unknown>
  media: (req: Request) => Promise<Response>
  /** EV197: the Claudes inside the app, drawn on the phone too: their screen now, then what they write (`/pty?id=…`). */
  pty?: {
    attach: (id: string, view: RemotePtyView) => Promise<unknown>
    detach: (id: string, view: RemotePtyView) => void
  }
}

export function createRemote(deps: RemoteDeps) {
  const file = () => join(paths.root(), 'remote.json')
  const load = (): Saved => { try { return { subs: [], ...JSON.parse(readFileSync(file(), 'utf8')) } } catch { return { subs: [] } } }
  const save = (s: Saved) => writeFileSync(file(), JSON.stringify(s))
  const listeners = new Set<ServerResponse>()
  /** EV197: the phone's terminals open now (they get the same heartbeat as /events). */
  const ptyStreams = new Set<ServerResponse>()

  const allowed = (req: IncomingMessage): boolean => {
    const host = String(req.headers.host ?? '').split(':')[0].toLowerCase()
    if (host !== '127.0.0.1' && host !== 'localhost' && !host.endsWith('.ts.net')) return false
    const origin = req.headers.origin
    if (!origin) return true
    try { return new URL(origin).hostname.toLowerCase() === host } catch { return false }
  }

  const staticFile = (url: string, res: ServerResponse) => {
    const clean = normalize(decodeURIComponent(url.split('?')[0])).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '')
    let f = join(deps.rootDir, clean || 'index.html')
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(deps.rootDir, 'index.html')
    const ext = extname(f).toLowerCase()
    res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || url.includes('sw.js') ? 'no-cache' : 'public, max-age=3600' })
    createReadStream(f).pipe(res)
  }

  const server = createServer(async (req, res) => {
    try {
      if (!allowed(req)) { res.writeHead(403); res.end('no'); return }
      const url = req.url ?? '/'
      if (url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write('event: state\ndata: []\n\n')
        listeners.add(res)
        req.on('close', () => listeners.delete(res))
        return
      }
      // EV197 (the user, 15-11 13:20: «en el móvil poder ver la pestaña de chats como la veo aquí en el pc, con los cmd»):
      // one Claude inside the app, drawn on the phone: its screen as it is now («snap»), then each piece it writes
      // («data») and its end («exit»), as the app's windows get them. Typing goes through /api (ptyInput, ptyKey…).
      if (url.startsWith('/pty?') && req.method === 'GET' && deps.pty) {
        const id = new URL(url, 'http://pmc').searchParams.get('id') ?? ''
        if (!/^[a-z0-9]{4,40}$/i.test(id)) { res.writeHead(400); res.end(); return }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
        let gone = false
        let ready = false
        const early: string[] = []
        const out = (event: string, data: unknown) => { if (gone) return; const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; if (ready) res.write(s); else early.push(s) }
        const view: RemotePtyView = {
          send: (channel, ...args) => { if (channel === 'pmc:pty') out('data', args[1]); else if (channel === 'pmc:pty-exit') out('exit', args[1]); else if (channel === 'pmc:pty-size') out('size', [args[1], args[2]]) },
          isDestroyed: () => gone
        }
        req.on('close', () => { gone = true; ptyStreams.delete(res); deps.pty?.detach(id, view) })
        try {
          const snap = await deps.pty.attach(id, view)
          // Closed while its screen was being read: nobody to send it to, and it must not stay among the views.
          if (gone) { deps.pty.detach(id, view); return }
          res.write(`event: snap\ndata: ${JSON.stringify(snap)}\n\n`)
          ready = true
          for (const s of early) res.write(s)
          early.length = 0
          ptyStreams.add(res)
        } catch (e) {
          res.write(`event: fail\ndata: ${JSON.stringify((e as Error).message)}\n\n`)
          res.end()
        }
        return
      }
      if (url.startsWith('/api/') && req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/json') { res.writeHead(415); res.end(); return }
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const args = JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]')
        try {
          const out = await deps.call(url.slice(5), args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: out ?? null }))
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: (e as Error).message }))
        }
        return
      }
      if (url.startsWith('/media/')) {
        const headers: Record<string, string> = {}
        if (req.headers.range) headers.range = String(req.headers.range)
        const answer = await deps.media(new Request('pmc://' + url.slice(7), { headers }))
        res.writeHead(answer.status, Object.fromEntries(answer.headers))
        if (answer.body) Readable.fromWeb(answer.body as any).pipe(res)
        else res.end()
        return
      }
      staticFile(url, res)
    } catch (e) {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(e))
    }
  })

  const tailscale = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(TAILSCALE, args, { windowsHide: true, timeout: 15_000 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message))) : resolve(String(out))))
  })

  return {
    start: () => { server.on('error', () => undefined); server.listen(REMOTE_PORT, '127.0.0.1'); setInterval(() => { for (const l of listeners) l.write(': latido\n\n'); for (const l of ptyStreams) l.write(': latido\n\n') }, 25_000).unref() },
    emit: (channel: string, ...args: unknown[]) => { for (const l of listeners) l.write(`event: ${channel}\ndata: ${JSON.stringify(args)}\n\n`) },

    /** Where things stand, for the setup card: every step it can do by itself, it does. */
    status: async (): Promise<{ installed: boolean; running: boolean; loginUrl?: string; url?: string; qr?: string; problem?: string }> => {
      if (!existsSync(TAILSCALE)) return { installed: false, running: false }
      try {
        const s = JSON.parse(await tailscale(['status', '--json']))
        const dns = String(s.Self?.DNSName ?? '').replace(/\.$/, '')
        if (s.BackendState !== 'Running' || !dns) return { installed: true, running: false, loginUrl: s.AuthURL || undefined }
        const url = `https://${dns}/`
        let problem: string | undefined
        try { await tailscale(['serve', '--bg', String(REMOTE_PORT)]) } catch (e) { problem = (e as Error).message.slice(0, 400) }
        return { installed: true, running: true, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360 }), problem }
      } catch (e) {
        return { installed: true, running: false, problem: (e as Error).message.slice(0, 300) }
      }
    },
    /** Opens the Tailscale sign-in in the browser. */
    login: async () => { execFile(TAILSCALE, ['login'], { windowsHide: true, timeout: 120_000 }, () => undefined); return true },

    pushKey: (): string => {
      const s = load()
      if (!s.vapid) { s.vapid = webpush.generateVAPIDKeys(); save(s) }
      return s.vapid.publicKey
    },
    pushAdd: (sub: webpush.PushSubscription): boolean => {
      const s = load()
      if (!s.subs.some((x) => x.endpoint === sub.endpoint)) s.subs.push(sub)
      save(s)
      return true
    },
    /** A notice on the user's phones. One that is gone (uninstalled, turned off) is forgotten. */
    push: async (title: string, body: string, route: string): Promise<void> => {
      const s = load()
      if (!s.vapid || !s.subs.length) return
      webpush.setVapidDetails('mailto:mission-control@example.com', s.vapid.publicKey, s.vapid.privateKey)
      const alive: webpush.PushSubscription[] = []
      for (const sub of s.subs) {
        try { await webpush.sendNotification(sub, JSON.stringify({ title, body, route })); alive.push(sub) } catch (e: any) { if (e?.statusCode !== 404 && e?.statusCode !== 410) alive.push(sub) }
      }
      if (alive.length !== s.subs.length) save({ ...s, subs: alive })
    }
  }
}
