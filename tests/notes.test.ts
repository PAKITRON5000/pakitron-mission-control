import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db'
import { deliverPending, notesText, pendingInstructions } from '../src/core/coord'
import { addInstruction } from '../src/core/review'
import { confirmTyped, markOpening, markTyped, noteStatus, parkedAccount, pickNoteRoute, sentNotes, typedNoteText } from '../src/core/notes'

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

  it('si todos trabajan, «para todos»: la leen todos los que trabajan, también en otro proyecto (EV178)', () => {
    const r = pickNoteRoute({ projectId: P, agents: [agent('claude1', 'trabajando', [win({ status: 'busy' })]), agent('claude3', 'disponible'), agent('claude6', 'trabajando', [win({ status: 'busy', projectId: 'fp' })], 10)] })
    expect(r).toEqual({ kind: 'todos', accounts: ['claude6', 'claude1'] })
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

  it('con rueda en el proyecto, una nota «para todos» no espera al relevo; sin nadie trabajando, no abre a nadie (EV178)', () => {
    // 14-11 19:29: Mi Juego with its wheel, the turn of Claude 1 working in Mission Control: the note waited «a la rueda».
    const chains = { [P]: { on: true, order: ['claude1', 'claude3'] as never, holder: 'claude1' as never } }
    const agents = [agent('claude1', 'trabajando', [win({ status: 'busy', projectId: 'mc2' })]), agent('claude3', 'trabajando', [win({ status: 'busy', projectId: 'mc2' })])]
    expect(pickNoteRoute({ projectId: P, agents, chains })).toEqual({ kind: 'todos', accounts: ['claude1', 'claude3'] })
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude3', 'disponible')], chains }).kind).toBe('espera')
    // To someone by name, with the wheel: only that one, after its step.
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude1', 'trabajando', [win({ status: 'busy' })])], chains, target: 'claude1' as never })).toEqual({ kind: 'paso', account: 'claude1' })
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

describe('«para todos» llega al momento a cada Claude que trabaja, esté donde esté (EV178)', () => {
  let db: DB
  beforeEach(() => { db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db')) })
  const elsewhere = { id: 'mc', name: 'Mission Control', root: 'C:\mc', copies: [] } as never

  it('una nota escrita en otro proyecto llega en el siguiente paso, una vez a cada cuenta, y se sabe quién la leyó', () => {
    // 14-11 19:29: written in Mi Juego (its wheel waiting for Claude 1), while Claude 1 and Claude 3 worked in Mission Control.
    const n = addInstruction(db, { projectId: 'fp', kind: 'general', body: 'Los demás, terminad Mission Control' })
    const at = Date.now()
    const first = deliverPending(db, elsewhere, 'claude3' as never, at + 1000)
    expect(first).toContain('para todos los Claude')
    expect(first).toContain('escrito en fp')
    expect(first).toContain(`Los demás, terminad Mission Control (MC-${n.id})`)
    expect(deliverPending(db, elsewhere, 'claude3' as never, at + 2000)).toBe('')
    expect(deliverPending(db, elsewhere, 'claude1' as never, at + 3000)).toContain('(MC-')
    const sent = sentNotes(db, 'fp', 0)[0]
    expect(sent.readers).toEqual(['claude3', 'claude1'])
    expect(noteStatus(sent).text).toContain('Leída por Claude 3 y Claude 1')
  })

  it('en su propio proyecto dice «en este proyecto»; una nota para alguien concreto no va a los demás', () => {
    addInstruction(db, { projectId: 'mc', kind: 'general', body: 'Para todos' })
    addInstruction(db, { projectId: 'fp', kind: 'general', body: 'Solo para Claude 6', target: 'claude6' as never })
    const text = deliverPending(db, elsewhere, 'claude1' as never)
    expect(text).toContain('en este proyecto')
    expect(text).not.toContain('Solo para Claude 6')
  })

  it('una nota de hace más de unas horas ya no se reparte a quien empieza después', () => {
    const n = addInstruction(db, { projectId: 'fp', kind: 'general', body: 'Vieja' })
    db.prepare('UPDATE instructions SET created_at = ? WHERE id = ?').run(Date.now() - 5 * 3600_000, n.id)
    expect(deliverPending(db, elsewhere, 'claude1' as never)).not.toContain('Vieja')
  })
})

describe('una nota escrita a un Claude por su nombre lo pone a trabajar aunque esté apartado (EV182)', () => {
  // 15-11 03:10: three notes to Claude 5 (the backup account of Video Dos, no window open) waited until the user opened it by hand.
  const reserves = [{ account: 'claude5' as never, projectId: 'iv', on: true }]
  it('sin ventana y apartada (de reserva de otro proyecto o «No usar»): se abre solo para la nota', () => {
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude5', 'desconectado')], target: 'claude5' as never, reserves })).toEqual({ kind: 'solo', account: 'claude5' })
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude4', 'apartada')], target: 'claude4' as never, excluded: { claude4: 'pausada' } })).toEqual({ kind: 'solo', account: 'claude4' })
  })

  it('con su ventana quieta aquí, se le escribe en ella; trabajando aquí o en otro proyecto, la lee al acabar su paso', () => {
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude4', 'apartada', [win({ pid: 4 })])], target: 'claude4' as never, excluded: { claude4: 'pausada' } })).toMatchObject({ kind: 'ventana', pid: 4 })
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude5', 'trabajando', [win({ status: 'busy', projectId: 'iv' })])], target: 'claude5' as never, reserves })).toEqual({ kind: 'paso', account: 'claude5' })
  })

  it('una cuenta normal sin ventana se abre como cualquier libre; la que no tiene uso, de baja o de la rueda fuera de turno, espera', () => {
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude3', 'desconectado')], target: 'claude3' as never })).toEqual({ kind: 'abrir', account: 'claude3' })
    const gone = pickNoteRoute({ projectId: P, agents: [agent('claude2', 'baja')], target: 'claude2' as never, excluded: { claude2: 'baja' } })
    expect((gone as { why: string }).why).toContain('de baja')
    const chains = { [P]: { on: true, order: ['claude1', 'claude3'] as never, holder: 'claude1' as never } }
    const wait = pickNoteRoute({ projectId: P, agents: [agent('claude3', 'desconectado')], target: 'claude3' as never, chains })
    expect((wait as { why: string }).why).toContain('Claude 1')
    // Not a member of that wheel: opened all the same.
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude5', 'desconectado')], target: 'claude5' as never, chains, reserves }).kind).toBe('solo')
  })

  it('una nota «para todos» sigue sin abrir a una apartada ni a una sin ventana', () => {
    expect(pickNoteRoute({ projectId: P, agents: [agent('claude5', 'desconectado'), agent('claude4', 'apartada')], excluded: { claude4: 'pausada' }, reserves }).kind).toBe('espera')
  })

  it('el texto bajo la nota dice que la está abriendo', () => {
    const n = { id: 1, body: 'x', status: 'guardada', createdAt: 0, updatedAt: 0, target: 'claude5' as never }
    expect(noteStatus(n, { kind: 'solo', account: 'claude5' as never }).text).toContain('Abriendo a Claude 5')
  })
})

describe('lo escrito a un Claude por su nombre le llega aunque esté en otro proyecto (EV182)', () => {
  let db: DB
  beforeEach(() => { db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db')) })
  const iv = { id: 'iv', name: 'Video Dos', root: 'C:\iv', copies: [] } as never

  it('en su siguiente paso, como suya y con dónde hacerla, una sola vez; a los demás no', () => {
    const n = addInstruction(db, { projectId: 'mc', kind: 'general', body: 'Mira por qué no me llegan', target: 'claude5' as never })
    const text = deliverPending(db, iv, 'claude5' as never)
    expect(text).toContain('te ha escrito a ti desde otro proyecto')
    expect(text).toContain(`en mc] Mira por qué no me llegan (MC-${n.id})`)
    expect(text).not.toContain('para todos los Claude')
    expect(deliverPending(db, iv, 'claude5' as never)).toBe('')
    expect(deliverPending(db, iv, 'claude3' as never)).toBe('')
    expect(sentNotes(db, 'mc', 0)[0].status).toBe('recibida')
  })

  it('en el propio proyecto le llega como siempre, por sus notas', () => {
    addInstruction(db, { projectId: 'mc', kind: 'general', body: 'Aquí mismo', target: 'claude5' as never })
    const text = deliverPending(db, project, 'claude5' as never)
    expect(text).toContain('Aquí mismo')
    expect(text).not.toContain('desde otro proyecto')
  })
})

describe('una cuenta apartada no sigue con la cola al acabar (EV182, MC-276)', () => {
  let db: DB
  beforeEach(() => { db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db')) })
  const ui = (v: unknown) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ui', ?)").run(JSON.stringify(v))

  it('«No usar», de baja o de reserva de otro proyecto: apartada; en su proyecto de reserva, no', () => {
    expect(parkedAccount(db, 'claude5', 'mc')).toBe(false)
    ui({ accountStatus: { claude4: 'pausada' }, reserves: [{ account: 'claude5', projectId: 'iv', on: true }, { account: 'claude6', projectId: 'iv', on: false }] })
    expect(parkedAccount(db, 'claude4', 'mc')).toBe(true)
    expect(parkedAccount(db, 'claude5', 'mc')).toBe(true)
    expect(parkedAccount(db, 'claude5', 'iv')).toBe(false)
    expect(parkedAccount(db, 'claude6', 'mc')).toBe(false)
    expect(parkedAccount(db, 'claude1', 'mc')).toBe(false)
  })

  it('«No usar» con los tiempos muertos encendidos: en su proyecto sigue como cualquiera; fuera, apartada; de baja, siempre', () => {
    ui({ accountStatus: { claude4: 'pausada', claude2: 'baja' }, reserves: [{ account: 'claude4', projectId: 'iv', on: true }, { account: 'claude2', projectId: 'iv', on: true }] })
    expect(parkedAccount(db, 'claude4', 'iv')).toBe(false)
    expect(parkedAccount(db, 'claude4', 'mc')).toBe(true)
    expect(parkedAccount(db, 'claude2', 'iv')).toBe(true)
  })
})
