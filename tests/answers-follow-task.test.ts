// EV147: the user's answer follows the task, not the account (13-11: #145 was answered at 20:01 while claude1, which had
// asked it, was out of usage; claude6 took EV134 over at 20:11 and asked the same thing again as #147).
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-answers-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('la respuesta del usuario sigue a la tarea (EV147)', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const { syncTasks } = await import('../src/core/engine')
  const coord = await import('../src/core/coord')
  const dec = await import('../src/core/decisions')
  const { listInstructions } = await import('../src/core/review')

  const setup = () => {
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const root = join(dir, 'mc-' + Math.random().toString(36).slice(2))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'TASKS.md'), '## Lista para todos\n- [~] EV134 · Normas de Anthropic antes de publicar\n- [ ] EV140 · Relevo apagado al instalar\n')
    const p = { id: 'mc', name: 'Mission Control', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p as any)
    syncTasks(db, p as any)
    return { db, p: p as any }
  }

  it('el texto dice el número y que solo dejó una nota (antes, «responde» se leía como una orden)', () => {
    const { db } = setup()
    const d = dec.addDecision(db, { projectId: 'mc', title: 'Normas y varias cuentas', askedBy: 'claude1', taskExtId: 'EV134', options: ['A: no publicar', 'B: publicar'] })
    const text = dec.answerText(d, undefined, 'No entiendo este punto')
    expect(text).toContain(`(#${d.id}, EV134)`)
    expect(text).toContain('contesta con una nota, sin elegir opción')
    expect(text).not.toMatch(/: responde\./)
  })

  it('pmc relevo pasa a quien recoge las respuestas que esperaban a la otra cuenta, y se las enseña', () => {
    const { db, p } = setup()
    const k = coord.taskKeyFor(db, 'mc', 'EV134').key
    coord.claimTask(db, 'mc', k, 'claude1')
    const d = dec.addDecision(db, { projectId: 'mc', title: 'Normas y varias cuentas', askedBy: 'claude1', taskExtId: 'EV134', options: ['A: no publicar', 'B: publicar'] })
    const answered = dec.answerDecision(db, p, d.id, { note: 'que funcione sea el plan que sea' })
    expect(listInstructions(db, 'mc').find((i) => i.id === answered.instructionId)?.target).toBe('claude1')
    const text = coord.takeOver(db, { project: p, from: 'claude1', to: 'claude6', enCurso: [], copies: [] })
    expect(text).toContain('Respuesta del usuario que esperaba a claude1')
    expect(text).toContain('que funcione sea el plan que sea')
    expect(text).toContain('no se la vuelvas a preguntar')
    const ins = listInstructions(db, 'mc').find((i) => i.id === answered.instructionId)
    expect(ins?.target).toBe('claude6')
    expect(ins?.status).toBe('recibida')
    // Delivered once: claude1, back, does not get it again, nor claude6 at its next step.
    expect(coord.deliverPending(db, p, 'claude1')).not.toContain('sea el plan que sea')
    expect(coord.deliverPending(db, p, 'claude6')).not.toContain('sea el plan que sea')
  })

  it('una respuesta que llega cuando ya lleva la tarea otra cuenta va a esa cuenta, y dice quién preguntó', () => {
    const { db, p } = setup()
    const k = coord.taskKeyFor(db, 'mc', 'EV134').key
    const d = dec.addDecision(db, { projectId: 'mc', title: 'Normas y varias cuentas', askedBy: 'claude1', taskExtId: 'EV134', options: ['A: no publicar', 'B: publicar'] })
    coord.claimTask(db, 'mc', k, 'claude6')
    const answered = dec.answerDecision(db, p, d.id, { choice: d.options[1].id })
    const ins = listInstructions(db, 'mc').find((i) => i.id === answered.instructionId)
    expect(ins?.target).toBe('claude6')
    expect(ins?.body).toContain('La preguntó claude1')
    // With nobody holding it, or the asker holding it, it goes to the asker as before.
    const e = dec.addDecision(db, { projectId: 'mc', title: '¿Aviso al instalar?', askedBy: 'claude3', taskExtId: 'EV140', options: ['A: sí', 'B: no'] })
    const e2 = dec.answerDecision(db, p, e.id, { choice: e.options[0].id })
    expect(listInstructions(db, 'mc').find((i) => i.id === e2.instructionId)?.target).toBe('claude3')
  })

  it('pmc decide avisa si la tarea ya tiene una pregunta de las últimas 12 h, con su respuesta', () => {
    const { db, p } = setup()
    const t0 = 2_000_000_000_000
    const d = dec.addDecision(db, { projectId: 'mc', title: 'Normas y varias cuentas', askedBy: 'claude1', taskExtId: 'EV134', options: ['A: no publicar', 'B: publicar'] }, t0)
    expect(dec.recentOnTask(db, 'mc', 'EV134', t0 + 60_000)?.id).toBe(d.id)
    expect(dec.alreadyAskedText(dec.recentOnTask(db, 'mc', 'EV134', t0 + 60_000)!)).toContain('aún sin contestar')
    dec.answerDecision(db, p, d.id, { note: 'que funcione sea el plan que sea' }, t0 + 120_000)
    const prev = dec.recentOnTask(db, 'mc', 'EV134', t0 + 15 * 60_000)!
    const text = dec.alreadyAskedText(prev)
    expect(text).toContain(`#${d.id}`)
    expect(text).toContain('sin elegir opción; su nota: que funcione sea el plan que sea')
    expect(text).toContain('--otra')
    // Other tasks, none, or more than 12 hours later: nothing.
    expect(dec.recentOnTask(db, 'mc', 'EV140', t0 + 60_000)).toBeUndefined()
    expect(dec.recentOnTask(db, 'mc', undefined, t0)).toBeUndefined()
    expect(dec.recentOnTask(db, 'mc', 'EV134', t0 + 13 * 3600_000)).toBeUndefined()
  })
})
