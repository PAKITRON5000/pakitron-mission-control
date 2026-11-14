import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-decdef-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('decisiones que no paran el trabajo (EV79)', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const dec = await import('../src/core/decisions')
  const { listInstructions } = await import('../src/core/review')

  it('sin respuesta a tiempo se toma la opción por defecto y le llega al Claude que preguntó', () => {
    const db = openDb(join(dir, 'data', 'm.db'))
    const root = join(dir, 'game')
    mkdirSync(join(root, 'docs'), { recursive: true })
    const p = { id: 'game', name: 'Game', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p as any)
    const t0 = 1_000_000
    const d = dec.addDecision(db, { projectId: 'game', title: '¿Color?', askedBy: 'claude6', options: ['A: azul', 'B: rojo'], defaultChoice: 'B', waitHours: 2 }, t0)
    expect(d.defaultChoice).toBe(d.options[1].id)
    expect(d.waitUntil).toBe(t0 + 2 * 3600_000)
    // Before the time nothing happens; after it, the default is taken and sent.
    expect(dec.expireDecisions(db, [p as any], t0 + 3600_000)).toEqual([])
    const done = dec.expireDecisions(db, [p as any], t0 + 2 * 3600_000 + 1)
    expect(done.map((x) => [x.id, x.status, x.choice])).toEqual([[d.id, 'decidida', d.options[1].id]])
    expect(done[0].note).toContain('Sin respuesta en 2 h')
    expect(listInstructions(db, 'game').some((i) => i.id === done[0].instructionId && i.target === 'claude6')).toBe(true)
    // Without a default it waits for the user, as before.
    const w = dec.addDecision(db, { projectId: 'game', title: '¿Forma?', options: ['A: redonda', 'B: cuadrada'] }, t0)
    expect(w.waitUntil).toBeUndefined()
    expect(dec.expireDecisions(db, [p as any], t0 + 100 * 3600_000)).toEqual([])
  })

  it('reconoce la opción por su letra, su nombre o su id', () => {
    const opts = dec.parseOptions(['A: Sí, así', 'B: No'])
    expect(dec.resolveOption(opts, 'a')).toBe(opts[0].id)
    expect(dec.resolveOption(opts, 'B')).toBe(opts[1].id)
    expect(dec.resolveOption(opts, opts[1].id)).toBe(opts[1].id)
    expect(dec.resolveOption(opts, 'Z')).toBeUndefined()
  })
})
