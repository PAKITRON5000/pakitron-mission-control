// EV156: the sessions inside the app, end to end: the host holds a real pseudoconsole, the app's client starts one,
// types into it, reads its screen, draws it whole in a new view (snapshot + what came after) and closes it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHost, type Host } from '../src/ptyhost/server'
import { PtyClient } from '../src/core/ptyclient'
import { LineSplitter, cellsFor, decodeMsg, keyBytes, ptyPipeName, typedLine } from '../src/core/ptyproto'

const pipe = process.platform === 'win32'
  ? `\\\\.\\pipe\\pmc-pty-test-${randomBytes(4).toString('hex')}`
  : join(mkdtempSync(join(tmpdir(), 'pmc-pty-')), 's.sock')
const token = randomBytes(16).toString('hex')

let host: Host
beforeAll(async () => { host = await startHost({ pipe, token }) })
afterAll(async () => { await host?.close() })

const until = async (ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('no llegó a tiempo')
    await new Promise((r) => setTimeout(r, 25))
  }
}

// A small program that writes a line in colour, then repeats what it is sent, until it is sent «fin».
const ECHO = "process.stdout.write('\\x1b[32mhola desde dentro\\x1b[0m\\r\\n');process.stdin.setRawMode&&process.stdin.setRawMode(false);process.stdin.on('data',d=>{const s=String(d);process.stdout.write('eco:'+s.trim()+'\\r\\n');if(s.includes('fin'))process.exit(7)})"

describe('el proceso que guarda las sesiones de dentro de la app', () => {
  it('no habla con quien no trae la clave', async () => {
    const c = new PtyClient()
    await expect(c.connect(pipe, 'otra-clave-que-no-es', 1500)).rejects.toThrow()
  })

  it('abre una, le escribe, lee su pantalla, la dibuja entera en otra vista y la cierra', async () => {
    const got: { seq: number; data: string }[] = []
    let exitCode: number | undefined
    const c = new PtyClient({ data: (_id, seq, data) => got.push({ seq, data }), exit: (_id, code) => { exitCode = code } })
    await c.connect(pipe, token)
    expect(c.hostPid).toBe(process.pid)
    const env = { ...process.env } as Record<string, string>
    const info = await c.spawn({ id: 's1', file: process.execPath, args: ['-e', ECHO], cwd: process.cwd(), env, cols: 90, rows: 20, meta: { account: 'claude1', cwd: process.cwd(), title: 'prueba' } })
    expect(info.pid).toBeGreaterThan(0)
    expect(info.alive).toBe(true)
    await until(() => got.map((g) => g.data).join('').includes('hola desde dentro'))
    expect((await c.screen('s1', 10))).toContain('hola desde dentro')

    // A view that opens now: what it has drawn, and only what comes later after it.
    const snap = await c.snapshot('s1')
    expect(snap.data).toContain('hola desde dentro')
    expect(snap.cols).toBe(90)
    expect(snap.seq).toBeGreaterThan(0)
    expect(got.some((g) => g.seq <= snap.seq)).toBe(true)

    c.write('s1', 'algo\r')
    await until(() => got.map((g) => g.data).join('').includes('eco:algo'))
    // Accents and «ñ» arrive as typed (what the user writes in Spanish).
    c.write('s1', 'canción ñandú\r')
    await until(() => got.map((g) => g.data).join('').includes('eco:canción ñandú'))
    c.resize('s1', 100, 25)
    expect((await c.list()).find((s) => s.id === 's1')?.cols).toBe(100)

    c.write('s1', 'fin\r')
    await until(() => exitCode !== undefined)
    expect(exitCode).toBe(7)
    const after = (await c.list()).find((s) => s.id === 's1')
    expect(after?.alive).toBe(false)
    // Its last screen can still be read after it ends.
    expect(await c.screen('s1', 10)).toContain('eco:algo')
    c.close()
  }, 20_000)

  it('sigue viva si la app se va: otra conexión la encuentra', async () => {
    const a = new PtyClient()
    await a.connect(pipe, token)
    await a.spawn({ id: 's2', file: process.execPath, args: ['-e', 'setTimeout(()=>{},60000)'], cwd: process.cwd(), env: { ...process.env } as Record<string, string>, cols: 80, rows: 20, meta: { account: 'claude3', cwd: process.cwd(), title: 'larga' } })
    a.close()
    const b = new PtyClient()
    await b.connect(pipe, token)
    const s2 = (await b.list()).find((s) => s.id === 's2')
    expect(s2?.alive).toBe(true)
    expect(s2?.meta.account).toBe('claude3')
    expect(await b.kill('s2')).toBe(true)
    b.close()
  }, 20_000)
})

describe('ptyproto', () => {
  it('parte lo que llega en líneas enteras', () => {
    const s = new LineSplitter()
    expect(s.push('{"op":"a"}\n{"op"')).toEqual(['{"op":"a"}'])
    expect(s.push(':"b"}\n')).toEqual(['{"op":"b"}'])
    expect(decodeMsg('no es json')).toBeUndefined()
    expect(decodeMsg('{"x":1}')).toBeUndefined()
  })
  it('una tubería por carpeta de datos', () => {
    expect(ptyPipeName('C:\\A', 'win32')).toMatch(/^\\\\\.\\pipe\\pakitron-mc-pty-[0-9a-f]{12}$/)
    expect(ptyPipeName('C:\\A', 'win32')).toBe(ptyPipeName('c:\\a', 'win32'))
    expect(ptyPipeName('C:\\A', 'win32')).not.toBe(ptyPipeName('C:\\B', 'win32'))
    expect(ptyPipeName('/u/x', 'darwin')).toBe(join('/u/x', 'pty.sock'))
  })
  it('las teclas y el texto como los manda una terminal', () => {
    expect(keyBytes('esc')).toBe('\x1b')
    expect(keyBytes('enter')).toBe('\r')
    expect(keyBytes('2')).toBe('2')
    expect(keyBytes('borrar todo')).toBeUndefined()
    expect(typedLine('  hola\r\n  mundo ')).toBe('hola mundo')
  })
  it('un tamaño que Claude Code pueda dibujar', () => {
    expect(cellsFor(900, 400, 9, 18)).toEqual({ cols: 100, rows: 22 })
    expect(cellsFor(100, 50, 9, 18)).toEqual({ cols: 40, rows: 8 })
    expect(cellsFor(0, 0, 0, 0)).toEqual({ cols: 80, rows: 24 })
  })
})
