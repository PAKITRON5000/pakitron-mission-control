// Flows from the brief (pruebas D, E, H) on a throwaway database and a throwaway project folder.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-flow-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('persistence and review flow', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject, loadProjects } = await import('../src/core/projects')
  const { syncTasks, listTasks } = await import('../src/core/engine')
  const { addComment, deliverToBuzon, checkBuzonReceipts, listInstructions, listComments } = await import('../src/core/review')

  it('D + H: projects and tasks survive closing the database; each project keeps its own tasks', () => {
    const root = join(dir, 'game')
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'TASKS.md'), '# T\n## A\n- [ ] A1 · Uno\n- [~] A2 · Dos\n- [x] A3 · Tres\n')
    writeFileSync(join(root, 'docs', 'Buzón.md'), '# Buzón\n\n## Apuntes nuevos\n\n-\n')
    const other = join(dir, 'web')
    mkdirSync(join(other, 'docs'), { recursive: true })
    writeFileSync(join(other, 'docs', 'TASKS.md'), '- [ ] W1 · Web\n')
    const file = join(dir, 'data', 'mission.db')
    let db = openDb(file)
    const base = { copies: [], mediaDirs: [], color: '#fff', createdAt: Date.now(), readOnly: true, allowBuzon: false }
    saveProject(db, { ...base, id: 'game', name: 'Game', root, docsDirs: [join(root, 'docs')], copies: [{ path: root, label: 'Copia principal' }] })
    saveProject(db, { ...base, id: 'web', name: 'Web', root: other, docsDirs: [join(other, 'docs')] })
    for (const p of loadProjects(db)) syncTasks(db, p)
    db.close()
    db = openDb(file)
    const projects = loadProjects(db)
    expect(projects.map((p) => p.id)).toEqual(['game', 'web'])
    expect(listTasks(db, 'game').map((t) => t.extId)).toEqual(['A1', 'A2', 'A3'])
    expect(listTasks(db, 'web').map((t) => t.extId)).toEqual(['W1'])
    // A change in the file becomes a real event, not a guess.
    writeFileSync(join(root, 'docs', 'TASKS.md'), '# T\n## A\n- [x] A1 · Uno\n- [~] A2 · Dos\n- [x] A3 · Tres\n')
    const r = syncTasks(db, projects[0])
    expect(r.changed).toBe(1)
    const ev = db.prepare("SELECT title FROM events WHERE kind = 'tarea-hecha'").all() as any[]
    expect(ev[0].title).toContain('A1')
    db.close()
  })

  it('F: a new video shows up in the gallery index with its metadata, once, and duplicates share a fingerprint', async () => {
    const { scanMedia, hashPending } = await import('../src/core/media')
    const db = openDb(join(dir, 'data', 'mission.db'))
    const root = join(dir, 'game')
    const logs = join(root, 'Logs', 'gameplay')
    mkdirSync(logs, { recursive: true })
    writeFileSync(join(logs, 'a.png'), Buffer.alloc(3000, 1))
    const p = { ...loadProjects(db)[0], mediaDirs: [join(root, 'Logs')] }
    expect(scanMedia(db, p).added).toBe(1)
    writeFileSync(join(logs, 'pelea.mp4'), Buffer.alloc(5000, 2))
    writeFileSync(join(logs, 'copia.png'), Buffer.alloc(3000, 1))
    const r = scanMedia(db, p)
    expect(r.added).toBe(2)
    expect(scanMedia(db, p).added).toBe(0)
    const v = db.prepare("SELECT * FROM assets WHERE name = 'pelea.mp4'").get() as any
    expect(v.kind).toBe('video')
    expect(v.category).toBe('Vídeos')
    expect(v.size).toBe(5000)
    expect(v.rel).toBe('Logs/gameplay/pelea.mp4')
    // With its time already spent it leaves everything for the next round (EV115, 13-11).
    expect(hashPending(db, p.id, 200, Date.now() - 1)).toBe(0)
    hashPending(db, p.id)
    const h = db.prepare("SELECT hash FROM assets WHERE name IN ('a.png', 'copia.png')").all() as any[]
    expect(h[0].hash).toBe(h[1].hash)
    db.close()
  })

  it('E: a comment on a capture becomes a recoverable instruction, delivered only with permission, received when the agent files it', () => {
    const db = openDb(join(dir, 'data', 'mission.db'))
    const p = loadProjects(db)[0]
    const { comment, instruction } = addComment(db, { projectId: 'game', assetId: 7, x: 0.42, y: 0.31, body: 'Las pestañas están demasiado arriba.', target: 'claude3' }, 'arquera.png')
    expect(comment.status).toBe('pendiente')
    expect(instruction.status).toBe('guardada')
    expect(instruction.kind).toBe('correccion')
    // Not allowed yet: stays saved, nothing written.
    expect(() => deliverToBuzon(db, p, instruction.id)).toThrow()
    expect(readFileSync(join(p.root, 'docs', 'Buzón.md'), 'utf8')).not.toContain('pestañas')
    const allowed = { ...p, allowBuzon: true }
    const d = deliverToBuzon(db, allowed, instruction.id)
    expect(d.status).toBe('entregada')
    const buzon = readFileSync(join(p.root, 'docs', 'Buzón.md'), 'utf8')
    expect(buzon).toContain('Las pestañas están demasiado arriba.')
    expect(buzon).toContain(`(MC-${instruction.id})`)
    expect(buzon.split('\n').filter((l) => l.trim() === '-')).toHaveLength(0)
    // Still there: not received.
    expect(checkBuzonReceipts(db, allowed)).toBe(0)
    // The agent files it (removes the line) -> received.
    writeFileSync(join(p.root, 'docs', 'Buzón.md'), '# Buzón\n\n## Apuntes nuevos\n\n-\n')
    expect(checkBuzonReceipts(db, allowed)).toBe(1)
    expect(listInstructions(db, 'game')[0].status).toBe('recibida')
    expect(listComments(db, 'game', 7)[0].status).toBe('recibido')
    db.close()
    // Recoverable after reopening.
    const again = openDb(join(dir, 'data', 'mission.db'))
    expect(listComments(again, 'game', 7)[0].x).toBeCloseTo(0.42)
    again.close()
  })
})
