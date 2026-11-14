// The verification gate: a task is "verified" only by what the project's own checks said.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-verify-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('verification gate', async () => {
  const { openDb } = await import('../src/core/db')
  const v = await import('../src/core/verify')
  const res = await import('../src/core/resources')
  const free = () => ({ userApps: [], unityEditors: 0, blender: 0 })
  const git = () => ({ commit: 'abc1234', dirty: 2 })
  const setup = () => {
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const root = join(dir, 'game-' + Math.random().toString(36).slice(2))
    mkdirSync(root, { recursive: true })
    const p = { id: 'game', name: 'Game', root, copies: [{ path: root, label: 'Copia principal' }, { path: join(root, 'wt', 'rachas'), label: 'rachas' }], docsDirs: [], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    return { db, p, root }
  }
  // Juego de prueba' tools\unity.ps1 always exits 0: the result is in what it prints.
  const unity: import('../src/core/verify').Check[] = [
    { nombre: 'compila', orden: 'unity build', recurso: 'unity', fallaSi: 'error CS\\d+|Scripts have compiler errors|another Unity instance is running' },
    { nombre: 'pruebas', orden: 'unity test', recurso: 'unity', pasaSi: 'Tests: total=\\d+ passed=\\d+ failed=0', resumen: 'Tests: total=.*' }
  ]
  const runner = (out: Record<string, string>): import('../src/core/verify').Runner => (orden) => ({ code: 0, output: out[orden] ?? '', timedOut: false })

  it('reads the checks a copy declares, and tells a project without them apart', () => {
    const { root, p } = setup()
    expect(v.readChecks(root)).toBeUndefined()
    writeFileSync(join(root, 'pmc.json'), '﻿' + JSON.stringify({ verifica: [{ nombre: 'pruebas', orden: 'npm test' }, { sin: 'orden' }] }))
    expect(v.readChecks(root)).toEqual([{ nombre: 'pruebas', orden: 'npm test' }])
    expect(v.copyRootFor(p, join(root, 'wt', 'rachas', 'Assets'))).toBe(join(root, 'wt', 'rachas'))
    expect(v.copyRootFor(p, join(root, 'docs'))).toBe(root)
  })

  it('passes on what the tool printed, keeps the summary, the commit and a log, and frees the resource', () => {
    const { db, p, root } = setup()
    const r = v.runVerification(db, p, root, 'claude1', 'BZ6', unity, { run: runner({ 'unity build': 'ExitCode=0', 'unity test': 'ExitCode=0\nTests: total=343 passed=340 failed=0' }), busy: free, git })
    expect(r.outcome).toBe('bien')
    expect(r.summary).toBe('compila: bien · pruebas: Tests: total=343 passed=340 failed=0')
    expect(readFileSync(r.checks[1].log!, 'utf8')).toContain('$ unity test')
    expect(res.heldResources(db)).toEqual([])
    expect(v.verificationLine(v.lastVerification(db, 'game', 'BZ6'))).toMatch(/^Verificada \(.* sobre abc1234 más 2 archivos sin guardar\): compila: bien/)
    expect(v.verificationLine(v.lastVerification(db, 'game', 'OTRA'))).toContain('Sin verificar')
  })

  it('a failed build stops there, and repeated failures change what the agent is told', () => {
    const { db, p, root } = setup()
    const bad = runner({ 'unity build': "Assets/_Juego/X.cs(10,5): error CS0103: The name 'foo' does not exist", 'unity test': 'Tests: total=1 passed=1 failed=0' })
    const r1 = v.runVerification(db, p, root, 'claude1', 'BZ6', unity, { run: bad, busy: free, git, now: 1000 })
    expect(r1.outcome).toBe('falla')
    expect(r1.checks.map((c) => c.nombre)).toEqual(['compila'])
    expect(v.verificationReport(r1, v.failStreak(db, 'game', 'BZ6'))).toContain('corrige la causa')
    v.runVerification(db, p, root, 'claude1', 'BZ6', unity, { run: bad, busy: free, git, now: 2000 })
    expect(v.verificationReport(r1, v.failStreak(db, 'game', 'BZ6'))).toContain('Segunda vez seguida')
    const r3 = v.runVerification(db, p, root, 'claude1', 'BZ6', unity, { run: runner({ 'unity build': '', 'unity test': 'Tests: total=343 passed=341 failed=2\nFAILED RaidTests.X' }), busy: free, git, now: 3000 })
    expect(r3.summary).toBe('pruebas: Tests: total=343 passed=341 failed=2')
    expect(v.verificationReport(r3, v.failStreak(db, 'game', 'BZ6'))).toContain('Van 3 fallos seguidos: para')
    // A pass ends the streak.
    v.runVerification(db, p, root, 'claude2', 'BZ6', unity, { run: runner({ 'unity build': '', 'unity test': 'Tests: total=343 passed=343 failed=0' }), busy: free, git, now: 4000 })
    expect(v.failStreak(db, 'game', 'BZ6')).toBe(0)
  })

  it('a heavy check is put off, not failed, while the user needs the machine or another account has the turn', () => {
    const { db, p, root } = setup()
    const never: import('../src/core/verify').Runner = () => { throw new Error('must not run') }
    const playing = v.runVerification(db, p, root, 'claude1', 'BZ6', unity, { run: never, busy: () => ({ ...free(), userApps: ['Premiere'] }), git })
    expect(playing.outcome).toBe('aplazada')
    expect(playing.summary).toContain('Premiere')
    res.holdResource(db, 'unity', 'claude6', 'ejecutable')
    const held = v.runVerification(db, p, root, 'claude1', 'BZ6', unity, { run: never, busy: free, git })
    expect(held.summary).toBe('compila: unity lo tiene claude6 (ejecutable)')
    // Put off is neither a pass nor a failure for the task.
    expect(v.lastVerification(db, 'game', 'BZ6')).toBeUndefined()
    expect(v.failStreak(db, 'game', 'BZ6')).toBe(0)
    expect(v.verificationReport(held, 0)).toContain('No es un fallo')
  })

  it('a plain command is judged by its exit code, and one that never ends is cut', () => {
    expect(v.judge({ nombre: 't', orden: 'x' }, { code: 1, output: '', timedOut: false }).outcome).toBe('falla')
    expect(v.judge({ nombre: 't', orden: 'x' }, { code: 0, output: '', timedOut: false }).outcome).toBe('bien')
    expect(v.judge({ nombre: 't', orden: 'x', minutos: 5 }, { code: null, output: '', timedOut: true }).summary).toContain('5 min')
    // Colour codes do not hide the summary (the routine's first run said «bien» instead of «Tests 200 passed», 12-11).
    expect(v.judge({ nombre: 't', orden: 'x', resumen: 'Tests +[0-9]+ passed.*' }, { code: 0, output: '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m200 passed\x1b[39m\x1b[22m', timedOut: false }).summary).toBe('Tests 200 passed')
  })
})
