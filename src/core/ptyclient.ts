// EV156: the app's side of the pipe to the process that holds the sessions living inside the app (ptyproto.ts).
import { connect, type Socket } from 'node:net'
import { LineSplitter, PTY_PROTO, decodeMsg, encodeMsg, type FromHost, type PtyInfo, type PtyMeta, type ToHost } from './ptyproto'

export interface PtySnapshot { data: string; seq: number; cols: number; rows: number }

export interface PtyEvents {
  data?: (id: string, seq: number, data: string) => void
  exit?: (id: string, code: number) => void
  close?: () => void
}

export class PtyClient {
  private sock?: Socket
  private nextReq = 1
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  hostPid?: number
  hostVersion?: string

  constructor(private ev: PtyEvents = {}) {}

  get connected(): boolean {
    return Boolean(this.sock && !this.sock.destroyed && this.hostPid)
  }

  /** Connects and says the key; rejects when nobody listens there or the other side is not one we understand. */
  connect(pipe: string, token: string, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect(pipe)
      sock.setEncoding('utf8')
      const split = new LineSplitter()
      let settled = false
      const fail = (e: Error) => { if (!settled) { settled = true; clearTimeout(timer); sock.destroy(); reject(e) } }
      const timer = setTimeout(() => fail(new Error('sin respuesta')), timeoutMs)
      sock.on('error', (e) => fail(e))
      sock.on('connect', () => sock.write(encodeMsg({ op: 'hello', token, v: PTY_PROTO })))
      sock.on('data', (chunk: string) => {
        for (const line of split.push(chunk)) {
          const m = decodeMsg<FromHost>(line)
          if (!m) continue
          if (!settled) {
            if (m.op !== 'hello' || m.v !== PTY_PROTO) { fail(new Error('otra versión')); return }
            settled = true
            clearTimeout(timer)
            this.sock = sock
            this.hostPid = m.pid
            this.hostVersion = m.version
            resolve()
            continue
          }
          this.onMessage(m)
        }
      })
      sock.on('close', () => {
        if (!settled) return fail(new Error('cerrada'))
        if (this.sock !== sock) return
        this.sock = undefined
        this.hostPid = undefined
        for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error('se cerró la conexión')) }
        this.waiting.clear()
        this.ev.close?.()
      })
    })
  }

  private onMessage(m: FromHost): void {
    if (m.op === 'reply') {
      const w = this.waiting.get(m.req)
      if (!w) return
      this.waiting.delete(m.req)
      clearTimeout(w.timer)
      if (m.ok) w.resolve(m.value)
      else w.reject(new Error(m.error || 'falló'))
    } else if (m.op === 'data') this.ev.data?.(m.id, m.seq, m.data)
    else if (m.op === 'exit') this.ev.exit?.(m.id, m.code)
  }

  private post(m: ToHost): void {
    if (!this.sock || this.sock.destroyed) throw new Error('sin conexión con las sesiones de la app')
    this.sock.write(encodeMsg(m))
  }

  private ask<T>(build: (req: number) => ToHost, timeoutMs = 10_000): Promise<T> {
    const req = this.nextReq++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(req); reject(new Error('sin respuesta')) }, timeoutMs)
      this.waiting.set(req, { resolve: resolve as (v: unknown) => void, reject, timer })
      try { this.post(build(req)) } catch (e) { clearTimeout(timer); this.waiting.delete(req); reject(e as Error) }
    })
  }

  spawn(o: { id: string; file: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number; meta: PtyMeta }): Promise<PtyInfo> {
    return this.ask((req) => ({ op: 'spawn', req, ...o }))
  }
  list(): Promise<PtyInfo[]> { return this.ask((req) => ({ op: 'list', req })) }
  snapshot(id: string): Promise<PtySnapshot> { return this.ask((req) => ({ op: 'snapshot', req, id })) }
  screen(id: string, lines = 40): Promise<string> { return this.ask((req) => ({ op: 'screen', req, id, lines })) }
  kill(id: string): Promise<boolean> { return this.ask((req) => ({ op: 'kill', req, id })) }
  write(id: string, data: string): void { this.post({ op: 'write', id, data }) }
  resize(id: string, cols: number, rows: number): void { this.post({ op: 'resize', id, cols, rows }) }
  forget(id: string): void { this.post({ op: 'forget', id }) }
  close(): void { this.sock?.destroy() }
}
