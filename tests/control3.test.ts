import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db'
import { addAssignment, assignedTasks, listAssignments, moveAssignment, nextTasks, pruneAssignments, removeAssignment, setAssignmentOrder } from '../src/core/coord'
import { assetFacets, queryAssets } from '../src/core/gallery'
import { parseProgress } from '../src/core/jobs'
import { getTaskCard, setTaskCard, simpleText } from '../src/core/cards'

const P = 'p'
let db: DB

function task(extId: string, owner: string, status = 'pendiente', line = 1) {
  db.prepare(`INSERT INTO tasks (project_id, key, ext_id, title, detail, status, priority, owner, source, source_line, gone, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', ?, 2, ?, 'tasks', ?, 0, 1, 1)`).run(P, extId, extId, `Tarea ${extId}`, status, owner, line)
}

function asset(name: string, kind: string, size: number, path: string, gone = 0) {
  db.prepare(`INSERT INTO assets (project_id, path, rel, name, kind, category, size, mtime, gone, source, folder, first_seen)
    VALUES (?, ?, ?, ?, ?, 'otros', ?, 1, ?, 'pruebas', 'x', 1)`).run(P, path, name, name, kind, size, gone)
}

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db'))
})

describe('encargos', () => {
  beforeEach(() => {
    task('A1', 'claude2', 'pendiente', 1)
    task('A2', 'claude2', 'pendiente', 2)
    task('B1', 'claude1', 'pendiente', 3)
  })

  it('el encargo se guarda: no caduca como una reserva', () => {
    addAssignment(db, P, 'claude2', 'claude1')
    pruneAssignments(db, P, Date.now() + 30 * 86400_000)
    expect(listAssignments(db, P)).toHaveLength(1)
  })

  it('encargar dos veces lo mismo no lo duplica', () => {
    addAssignment(db, P, 'claude2', 'claude1')
    expect(addAssignment(db, P, 'claude2', 'claude1').created).toBe(false)
    expect(listAssignments(db, P)).toHaveLength(1)
  })

  it('al arrancar, primero lo encargado y luego lo suyo', () => {
    addAssignment(db, P, 'claude2', 'claude1')
    const list = nextTasks(db, P, 'claude1', 6)
    expect(list.map((t) => t.extId)).toEqual(['A1', 'A2', 'B1'])
    expect(list[0].assignedFrom).toBe('claude2')
    expect(list[2].assignedFrom).toBeUndefined()
  })

  it('el orden elegido por el usuario manda', () => {
    const { assignment } = addAssignment(db, P, 'claude2', 'claude1')
    setAssignmentOrder(db, assignment.id, ['A2', 'A1'])
    const fresh = listAssignments(db, P)[0]
    expect(assignedTasks(db, P, fresh).map((t) => t.extId)).toEqual(['A2', 'A1'])
    expect(nextTasks(db, P, 'claude1', 6).map((t) => t.extId).slice(0, 2)).toEqual(['A2', 'A1'])
  })

  it('una tarea con una pregunta pendiente en Decidir espera al usuario: no se ofrece hasta que contesta (EV121)', async () => {
    const { addDecision, answerDecision } = await import('../src/core/decisions')
    const d = addDecision(db, { projectId: P, title: '¿Así?', options: ['A: sí', 'B: no'], askedBy: 'claude1', taskExtId: 'B1' })
    expect(nextTasks(db, P, 'claude1', 6).map((t) => t.extId)).not.toContain('B1')
    // Whoever holds it still sees it (it may go on with other parts while the question waits).
    db.prepare('INSERT INTO claims(project_id, task_key, account, claimed_at, heartbeat_at, expires_at) VALUES(?,?,?,?,?,?)').run(P, 'B1', 'claude1', Date.now(), Date.now(), Date.now() + 3600_000)
    expect(nextTasks(db, P, 'claude1', 6).map((t) => t.extId)).toContain('B1')
    db.prepare('DELETE FROM claims').run()
    answerDecision(db, { id: P, name: 'p', root: 'C:\\p', docsDirs: [], copies: [] } as any, d.id, { choice: 'A' })
    expect(nextTasks(db, P, 'claude1', 6).map((t) => t.extId)).toContain('B1')
  })

  it('quitar el encargo devuelve la cola de siempre', () => {
    const { assignment } = addAssignment(db, P, 'claude2', 'claude1')
    removeAssignment(db, assignment.id)
    expect(nextTasks(db, P, 'claude1', 6)[0].extId).toBe('B1')
  })

  it('se puede cambiar qué encargo va antes', () => {
    task('C1', 'claude3', 'pendiente', 4)
    addAssignment(db, P, 'claude2', 'claude1')
    const second = addAssignment(db, P, 'claude3', 'claude1').assignment
    moveAssignment(db, P, second.id, -1)
    expect(listAssignments(db, P).map((a) => a.from)).toEqual(['claude3', 'claude2'])
  })

  it('terminadas sus tareas, el encargo desaparece solo', () => {
    addAssignment(db, P, 'claude2', 'claude1')
    db.prepare("UPDATE tasks SET status = 'terminada' WHERE owner = 'claude2'").run()
    pruneAssignments(db, P)
    expect(listAssignments(db, P)).toHaveLength(0)
  })
})

describe('galería: lo que dice coincide con lo que hay', () => {
  beforeEach(() => {
    asset('a.png', 'image', 10, 'C:/uno/a.png')
    asset('a.png', 'image', 10, 'C:/dos/a.png') // the same file in another copy
    asset('b.png', 'image', 20, 'C:/uno/b.png')
    asset('m.glb', 'model', 30, 'C:/uno/m.glb')
    asset('borrada.png', 'image', 40, 'C:/uno/borrada.png', 1)
  })

  it('el total cuenta cada archivo una vez y es lo que se puede recorrer entero', () => {
    const r = queryAssets(db, { projectId: P, limit: 1000 })
    expect(r.total).toBe(3)
    expect(r.items).toHaveLength(3)
  })

  it('las cifras por tipo suman el total y dice cuántas copias hay', () => {
    const f = assetFacets(db, { projectId: P })
    expect(f.total).toBe(3)
    expect(f.copies).toBe(1)
    expect(f.kinds.find((k) => k.kind === 'image')?.n).toBe(2)
    expect(f.kinds.find((k) => k.kind === 'model')?.n).toBe(1)
  })

  it('paginar no pierde ni repite nada', () => {
    const page1 = queryAssets(db, { projectId: P, limit: 2, offset: 0 }).items
    const page2 = queryAssets(db, { projectId: P, limit: 2, offset: 2 }).items
    expect(new Set([...page1, ...page2].map((a) => a.id)).size).toBe(3)
  })
})

describe('trabajos largos', () => {
  it('lee el progreso real del registro', () => {
    expect(parseProgress(' 32%|███ | 13/40 [1:00:44<2:20:52, 313.06s/it]')).toEqual({ done: 13, total: 40, leftSec: 8452 })
  })
  it('se queda con la última barra', () => {
    expect(parseProgress('1/40 [00:01<00:40]\n2/40 [00:02<00:38]').done).toBe(2)
  })
  it('ignora barras pequeñas de otros pasos', () => {
    expect(parseProgress('2/3 [00:01<00:01]')).toEqual({})
  })
})

describe('fichas de tarea', () => {
  it('guarda lo escrito con sus imágenes', () => {
    // The card's images are copied into the app's data folder: a temporary one here (13-11: 499 copies of this test's
    // one-byte «foto.png» had piled up in %LOCALAPPDATA%\PakitronMC\entregas).
    const before = process.env.PMC_DATA_DIR
    process.env.PMC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pmc-cards-data-'))
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-')), 'foto.png')
    writeFileSync(file, 'x')
    setTaskCard(db, { projectId: P, extId: 'A1', simple: 'Qué es', ask: 'Qué mirar', files: [{ path: file, caption: 'Una foto' }] })
    const c = getTaskCard(db, P, 'A1')
    expect(c?.simple).toBe('Qué es')
    expect(c?.ask).toBe('Qué mirar')
    expect(c?.media[0].caption).toBe('Una foto')
    if (before === undefined) delete process.env.PMC_DATA_DIR; else process.env.PMC_DATA_DIR = before
  })
  it('sin ficha, saca una frase legible quitando rutas y notas', () => {
    const t = simpleText('Fuente y reloj', '**Fuente y reloj:** la fuente gruesa de la referencia en `Assets/x.cs` y el reloj en su caja.')
    expect(t).not.toContain('Assets/')
    expect(t).not.toContain('**')
    expect(t).toContain('reloj')
  })
})
