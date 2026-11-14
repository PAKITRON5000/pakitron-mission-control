import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db'
import { deliverPending, notesText, pendingInstructions } from '../src/core/coord'
import { addInstruction } from '../src/core/review'
import { confirmTyped, markOpening, markTyped, noteStatus, pickNoteRoute, sentNotes, typedNoteText } from '../src/core/notes'

const P = 'mc'
const project = { id: P, name: 'Mission Control', root: 'C:\\x', copies: [] } as never

type S = { sessionId: string; projectId?: string; pid?: number; kind: 'interactive' | 'background'; status?: string; state?: string; rateLimited?: boolean }
const win = (over: Partial<S> = {}): S => ({ sessionId: 's' + Math.random(), projectId: P, pid: 100, kind: 'interactive', status: 'idle', ...over })
const agent = (id: string, state: string, sessions: S[] = [], five = 20) =>
  ({ id, state, sessions, usage: { history: [], snapshot: { fiveHour: { usedPct: five, resetsAt: 0 } } }, identity: { hasLogin: true } }) as never

describe('a dónde va una nota del cuadro (EV154)', () => {
  it('a la ventana de un Claude quieto del proyecto antes que al que trabaja', () => {
    const r = pickNoteRoute({ projectId: P, agents: [agent('claude1', 'trabajando', [win({ status: 'busy', pid: 1 })]), agent('claude3', 'disponible', [win({ pid: 3 })])] })
    expect(r).toMatchObject({ kind: 'ventana', account: 'claude3', pid: 3 })
  })

  it('si todos trabajan, al que trabaja, en su próximo paso', () => {
    const r = pickNoteRoute({ projectId: P, agents: [agent('claude1', 'trabajando', [win({ status: 'busy' })]), agent('claude3', 'disponible')] })
    expect(r).toEqual({ kind: 'paso', account: 'claude1' })
  })

  it('una ventana quieta en otro proyecto no cuenta; sin nadie aquí se abre una libre', () => {
    const r = pickNoteRoute({ projectId: P, agents: [agent('claude1', 'disponible', [win({ projectId: 'otro' })]), agent('claude3', 'disponible', [], 60)] })
    expect(r).toEqual({ kind: 'abrir', account: 'claude1' })
  })

  it('nunca a una apartada, de baja o sin uso, ni a una ventana que se quedó sin uso', () => {
    const agents = [agent('claude4', 'apartada', [win()]), agent('claude2', 'baja'), agent('claude5', 'sin-uso', [win()]), agent('claude6', 'disponible', [win({ rateLimited: true })])]
    const r = pickNoteRoute({ projectId: P, agents, excluded: { claude6: 'pausada' } })
    expect(r.kind).toBe('espera')
  })

  it('no abre una cuenta de la rueda de otro proyecto (perdería su turno allí)', () => {
    const chains = { fp: { on: true, order: ['claude3', 'claude6'] as never, holder: 'claude6' as never } }
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude3', 'disponible')], chains }).kind).toBe('espera')
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude3', 'disponible'), agent('claude1', 'disponible')], chains })).toEqual({ kind: 'abrir', account: 'claude1' })
  })

  it('con rueda en el proyecto, solo a quien tiene el turno; y no abre a nadie', () => {
    const chains = { [P]: { on: true, order: ['claude1', 'claude3'] as never, holder: 'claude1' as never } }
    const agents = [agent('claude1', 'trabajando', [win({ status: 'busy' })]), agent('claude3', 'disponible', [win()])]
    expect(pickNoteRoute({ projectId: P, agents, chains })).toEqual({ kind: 'paso', account: 'claude1' })
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude3', 'disponible')], chains }).kind).toBe('espera')
  })

  it('para una cuenta concreta, solo esa', () => {
    const agents = [agent('claude1', 'disponible', [win({ pid: 1 })]), agent('claude3', 'trabajando', [win({ status: 'busy', pid: 3 })])]
    expect(pickNoteRoute({ projectId: P, agents, target: 'claude3' as never })).toEqual({ kind: 'paso', account: 'claude3' })
    const away = pickNoteRoute({ projectId: P, agents: [agent('claude3', 'sin-uso')], target: 'claude3' as never })
    expect(away).toMatchObject({ kind: 'espera' })
    expect((away as { why: string }).why).toContain('no tiene uso')
  })

  it('lo que se escribe es una sola línea con su marca', () => {
    const t = typedNoteText('Mission Control', 12, 'arregla\nel muñeco')
    expect(t).not.toContain('\n')
    expect(t).toContain('(MC-12)')
    expect(t).toContain('«arregla el muñeco»')
  })
})

describe('lo que el usuario ve de cada nota (EV154)', () => {
  let db: DB
  beforeEach(() => { db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db')) })
  const note = (body = 'Hola') => addInstruction(db, { projectId: P, kind: 'general', body })
  const one = () => sentNotes(db, P, 0)[0]

  it('escrita en una ventana: no se le vuelve a dar por el gancho, y su siguiente paso la da por leída', () => {
    const n = note()
    markTyped(db, n.id, 'claude3' as never, 1000)
    expect(noteStatus(one()).tone).toBe('enviada')
    expect(pendingInstructions(db, P, 'claude3' as never)).toHaveLength(0)
    expect(pendingInstructions(db, P, 'claude1' as never)).toHaveLength(0)
    expect(deliverPending(db, project, 'claude3' as never, 2000)).toBe('')
    expect(one().status).toBe('recibida')
    expect(noteStatus(one()).text).toContain('Leída por Claude 3')
  })

  it('el gancho de otra cuenta no la da por leída', () => {
    const n = note()
    markTyped(db, n.id, 'claude3' as never, 1000)
    expect(confirmTyped(db, P, 'claude1' as never, 2000)).toBe(0)
    expect(one().status).toBe('entregada')
  })

  it('«para todos», leída en el próximo paso de uno: se sabe quién', () => {
    note()
    const text = deliverPending(db, project, 'claude1' as never)
    expect(text).toContain('(MC-')
    expect(one().reader).toBe('claude1')
    expect(one().target).toBeUndefined()
    expect(noteStatus(one()).text).toContain('Claude 1')
  })

  it('apuntada en TASKS con su marca, y hecha cuando la tarea se cierra', () => {
    const n = note('El muñeco se ve raro')
    const add = (status: string) => db.prepare(`INSERT OR REPLACE INTO tasks (project_id, key, ext_id, title, detail, status, priority, owner, source, gone, created_at, updated_at)
      VALUES (?, 'EV155', 'EV155', 'El muñeco de Claude se ve raro', ?, ?, 2, 'claude1', 'tasks', 0, 1, 1)`).run(P, `nota (MC-${n.id})`, status)
    add('pendiente')
    expect(noteStatus(one())).toEqual({ tone: 'apuntada', text: 'Apuntada como EV155, para Claude 1' })
    add('terminada')
    expect(noteStatus(one()).tone).toBe('hecha')
  })

  it('MC-1 no se confunde con MC-12', () => {
    const n = note()
    db.prepare(`INSERT INTO tasks (project_id, key, ext_id, title, detail, status, priority, source, gone, created_at, updated_at)
      VALUES (?, 'X1', 'X1', 'Otra', ?, 'pendiente', 2, 'tasks', 0, 1, 1)`).run(P, `(MC-${n.id}2)`)
    expect(one().task).toBeUndefined()
  })

  it('en espera, dice por qué; abriendo una cuenta, cuál', () => {
    const n = note()
    expect(noteStatus(one(), { kind: 'paso', account: 'claude6' as never }).text).toContain('Claude 6 la leerá al acabar su paso')
    expect(noteStatus(one(), { kind: 'espera', why: 'no hay ningún Claude libre' }).text).toBe('En espera: no hay ningún Claude libre')
    markOpening(db, n.id, 'claude3' as never)
    expect(noteStatus(one()).text).toBe('Abriendo a Claude 3 para dársela')
  })

  it('no enseña los mensajes de la propia app ni las notas sobre imágenes', () => {
    addInstruction(db, { projectId: P, kind: 'mensaje', body: 'Decisión del usuario sobre algo' })
    addInstruction(db, { projectId: P, kind: 'correccion', body: 'Más grande — sobre a.png', commentId: 3 })
    note('Mío')
    expect(sentNotes(db, P, 0).map((n) => n.body)).toEqual(['Mío'])
  })

  it('al Claude le llega la nota con su marca y cómo dejarla en TASKS', () => {
    const text = notesText('MC', [{ id: 7, kind: 'general', body: 'Hola' }], false).join('\n')
    expect(text).toContain('Hola (MC-7)')
    expect(text).toContain('con su marca (MC-…)')
  })
})
