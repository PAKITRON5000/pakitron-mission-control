import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db'
import { askChange, finishChange, linkRecentCorrections, removeChange, responsibleFor, updateChange } from '../src/core/changes'
import { addAssignment, deliverPending, nextTasks, notesText, pendingInstructions } from '../src/core/coord'
import { listTasks } from '../src/core/engine'
import { addInstruction } from '../src/core/review'
import { lineNote } from '../src/core/taskdiff'

const P = 'p'
let db: DB

function task(extId: string, owner = 'claude2', status = 'terminada', line = 1) {
  db.prepare(`INSERT INTO tasks (project_id, key, ext_id, title, detail, status, priority, owner, source, source_line, mark, gone, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'a falta de que lo vea el usuario', ?, 2, ?, 'tasks', ?, 'x', 0, 1, 1)`).run(P, extId, extId, `Tarea ${extId}`, status, owner, line)
}
const read = (id: number) => db.prepare("UPDATE instructions SET status = 'recibida', delivered_at = ? WHERE id = ?").run(Date.now(), id)
const view = (extId: string) => listTasks(db, P).find((t) => t.extId === extId)!
const ask = (over = {}) => askChange(db, { projectId: P, taskKey: 'A1', note: 'Más grande', target: 'claude1', ...over })

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db'))
  task('A1')
})

describe('una nota de revisión', () => {
  it('saca la tarea de «para revisar» y se queda en ella', () => {
    expect(view('A1').waitingLook).toBe(true)
    ask()
    const t = view('A1')
    expect(t.waitingLook).toBe(false)
    expect(t.change?.note).toBe('Más grande')
    expect(t.change?.target).toBe('claude1')
  })

  it('escribir otra vez en la misma tarea la edita, no acumula', () => {
    ask()
    ask({ note: 'Mucho más grande' })
    expect(view('A1').change?.note).toBe('Mucho más grande')
    expect(pendingInstructions(db, P, 'claude1')).toHaveLength(1)
  })

  it('por defecto va a quien tiene la tarea encargada', () => {
    expect(responsibleFor(db, P, 'claude2')).toBe('claude2')
    addAssignment(db, P, 'claude2', 'claude1')
    expect(responsibleFor(db, P, 'claude2')).toBe('claude1')
  })

  it('«a la cola» no es prioridad; «ya» sí', () => {
    ask()
    expect(pendingInstructions(db, P, 'claude1')[0].kind).toBe('correccion')
    updateChange(db, view('A1').change!.id, { urgent: true })
    expect(pendingInstructions(db, P, 'claude1')[0].kind).toBe('prioridad')
  })
})

describe('editarla', () => {
  it('sin leer, reescribe el mismo mensaje y se puede cambiar de destinatario', () => {
    const c = ask()
    updateChange(db, c.id, { note: 'Otra cosa', target: 'claude3' })
    expect(pendingInstructions(db, P, 'claude1')).toHaveLength(0)
    const ins = pendingInstructions(db, P, 'claude3')
    expect(ins).toHaveLength(1)
    expect(ins[0].body).toContain('Otra cosa')
    expect(ins[0].body).not.toContain('Más grande')
  })

  it('ya leída, le llega un mensaje nuevo que dice qué cambia', () => {
    const c = ask()
    read(c.instructionId!)
    updateChange(db, c.id, { note: 'Otra cosa' })
    const ins = pendingInstructions(db, P, 'claude1')
    expect(ins).toHaveLength(1)
    expect(ins[0].body).toContain('Cambia lo que pidió antes («Más grande»)')
    expect(ins[0].body).toContain('Otra cosa')
    expect(view('A1').change?.readAt).toBeUndefined()
  })

  it('ya leída y pasada a otro, al primero se le dice que ya no hace falta', () => {
    const c = ask()
    read(c.instructionId!)
    updateChange(db, c.id, { target: 'claude3' })
    expect(pendingInstructions(db, P, 'claude1')[0].body).toContain('Ya no hace falta')
    expect(pendingInstructions(db, P, 'claude3')[0].body).toContain('Más grande')
  })

  it('sin cambios no manda nada', () => {
    const c = ask()
    read(c.instructionId!)
    updateChange(db, c.id, { note: 'Más grande', target: 'claude1' })
    expect(pendingInstructions(db, P, 'claude1')).toHaveLength(0)
  })
})

describe('quitarla', () => {
  it('sin leer, no llega nunca y la tarea vuelve a «para revisar»', () => {
    const c = ask()
    removeChange(db, c.id)
    expect(pendingInstructions(db, P, 'claude1')).toHaveLength(0)
    expect(view('A1').change).toBeUndefined()
    expect(view('A1').waitingLook).toBe(true)
  })

  it('ya leída, se le dice que la olvide', () => {
    const c = ask()
    read(c.instructionId!)
    removeChange(db, c.id)
    expect(pendingInstructions(db, P, 'claude1')[0].body).toContain('Olvida')
  })
})

describe('cuándo se hace', () => {
  it('lo revisado va antes que los encargos y que lo suyo', () => {
    task('B1', 'claude1', 'pendiente', 2)
    task('C1', 'claude3', 'pendiente', 3)
    addAssignment(db, P, 'claude3', 'claude1')
    ask()
    const list = nextTasks(db, P, 'claude1', 6)
    expect(list.map((t) => t.extId)).toEqual(['A1', 'C1', 'B1'])
    expect(list[0].change).toBe('Más grande')
  })

  it('una nota para otra cuenta no le aparece a esta', () => {
    ask({ target: 'claude3' })
    expect(nextTasks(db, P, 'claude1', 6).map((t) => t.extId)).not.toContain('A1')
  })

  it('una nota para «el primero» le aparece a cualquiera', () => {
    ask({ target: undefined })
    expect(nextTasks(db, P, 'claude4', 6)[0].extId).toBe('A1')
  })

  it('«el primero» pasa a ser de quien la recibe: a los demás deja de aparecerles', () => {
    ask({ target: undefined })
    deliverPending(db, { id: P, name: 'Juego' } as never, 'claude1')
    expect(view('A1').change?.target).toBe('claude1')
    expect(view('A1').change?.readAt).toBeDefined()
    expect(nextTasks(db, P, 'claude4', 6).map((t) => t.extId)).not.toContain('A1')
    expect(nextTasks(db, P, 'claude1', 6)[0].extId).toBe('A1')
  })

  it('el aviso no le dice que no es su tarea principal', () => {
    ask()
    const text = notesText('Juego', pendingInstructions(db, P, 'claude1'), false).join('\n')
    expect(text).toContain('antes de empezar nada nuevo')
    expect(text).not.toContain('No son tu tarea principal')
  })
})

describe('al entregarla', () => {
  it('sin haberla leído, no se da por hecha', () => {
    ask()
    expect(finishChange(db, P, 'A1')).toBe(0)
    expect(view('A1').change).toBeDefined()
  })

  it('leída, vuelve a «para revisar» con lo que pediste', () => {
    const c = ask()
    read(c.instructionId!)
    expect(finishChange(db, P, 'A1')).toBe(1)
    const t = view('A1')
    expect(t.change).toBeUndefined()
    expect(t.waitingLook).toBe(true)
    expect(t.changeDone?.note).toBe('Más grande')
  })

  it('aunque su texto ya no diga que falta verla', () => {
    db.prepare("UPDATE tasks SET detail = 'hecho' WHERE ext_id = 'A1'").run()
    const c = ask()
    read(c.instructionId!)
    finishChange(db, P, 'A1')
    expect(view('A1').waitingLook).toBe(true)
  })

  it('con tu visto bueno se acaba', () => {
    const c = ask()
    read(c.instructionId!)
    finishChange(db, P, 'A1')
    db.prepare("UPDATE tasks SET verified = 1 WHERE ext_id = 'A1'").run()
    expect(view('A1').changeDone).toBeUndefined()
    expect(view('A1').waitingLook).toBe(false)
  })
})

describe('las notas ya enviadas', () => {
  it('se enlazan a su tarea, una sola vez, y van a quien la tiene ahora', () => {
    addAssignment(db, P, 'claude2', 'claude1')
    addInstruction(db, { projectId: P, kind: 'correccion', target: 'claude2', body: 'Sobre A1 («Tarea A1»): Cambia el reloj' })
    expect(linkRecentCorrections(db, P)).toBe(1)
    expect(view('A1').change?.note).toBe('Cambia el reloj')
    expect(view('A1').change?.target).toBe('claude1')
    expect(pendingInstructions(db, P, 'claude2')).toHaveLength(0)
    expect(pendingInstructions(db, P, 'claude1')[0].body).toContain('Revisión del usuario')
    expect(linkRecentCorrections(db, P)).toBe(0)
  })

  it('las antiguas no se tocan: ya se habrán resuelto', () => {
    addInstruction(db, { projectId: P, kind: 'correccion', target: 'claude2', body: 'Sobre A1 («Tarea A1»): Vieja' })
    expect(linkRecentCorrections(db, P, Date.now() + 3 * 86400_000)).toBe(0)
    expect(view('A1').change).toBeUndefined()
  })
})

describe('un comentario en una línea del código (EV138)', () => {
  it('llega a la cola del Claude como cambio que pidió el usuario, con el archivo, la línea y lo que pone', () => {
    const note = `Comentarios en el código:\n${lineNote({ path: 'src/a.ts', commit: 'abcdef1234', line: { kind: 'add', text: 'const tope = 400', newNo: 81 }, text: 'Que no haya tope' })}`
    askChange(db, { projectId: P, taskKey: 'A1', note, target: 'claude1' })
    const queue = pendingInstructions(db, P, 'claude1')
    expect(queue).toHaveLength(1)
    expect(queue[0].body).toMatch(/^Revisión del usuario de A1/)
    expect(queue[0].body).toContain('src/a.ts, línea 81 (commit abcdef1): «const tope = 400». Que no haya tope')
    expect(nextTasks(db, P, 'claude1', 6)[0]).toMatchObject({ extId: 'A1', change: note })
  })
})
