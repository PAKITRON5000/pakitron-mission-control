// EV139: a task cannot be marked done in TASKS.md while its checks fail or were never run (the PreToolUse hook).
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/core/db'
import { guardUnverified, newlyDone, readVerified, writeVerified, type VerifiedFile } from '../src/core/verify'

const ROOT = 'C:\\proyectos\\app'
const file = { projects: { app: { roots: [ROOT, 'C:\\proyectos\\app\\.claude\\worktrees\\uno'], tasks: {
  A1: { outcome: 'bien', at: 1, summary: 'pruebas: bien' },
  A2: { outcome: 'falla', at: 1, summary: 'pruebas: 3 fallan' },
  A4: { outcome: 'aplazada', at: 1, summary: 'el usuario juega' }
} } } } as VerifiedFile
const edit = (old_string: string, new_string: string, path = `${ROOT}\\docs\\TASKS.md`) => ({ tool_name: 'Edit', tool_input: { file_path: path, old_string, new_string } })

describe('la puerta de las tareas hechas', () => {
  it('ve solo las que pasan de «[ ]» o «[~]» a «[x]», y no las que dicen «sin comprobación»', () => {
    expect(newlyDone('- [ ] A1 · uno\n- [~] A2 · dos\n- [x] A3 · tres', '- [x] A1 · uno\n- [x] A2 · dos\n- [x] A3 · tres')).toEqual(['A1', 'A2'])
    expect(newlyDone('- [ ] A1 · uno', '- [x] A1 · *Hecha, sin comprobación: es una nota de investigación* uno')).toEqual([])
    expect(newlyDone('texto suelto', '- [x] A9 · nueva ya hecha')).toEqual([])
  })

  it('deja marcar la que pasó, o se aplazó, y frena la que falla o no se comprobó', () => {
    expect(guardUnverified(edit('- [ ] A1 · uno', '- [x] A1 · uno'), file)).toBeUndefined()
    expect(guardUnverified(edit('- [ ] A4 · uno', '- [x] A4 · uno'), file)).toBeUndefined()
    expect(guardUnverified(edit('- [~] A2 · dos', '- [x] A2 · dos'), file)).toMatch(/A2 no pasa sus comprobaciones \(pruebas: 3 fallan\)/)
    expect(guardUnverified(edit('- [ ] A3 · tres', '- [x] A3 · tres'), file)).toMatch(/antes de marcar A3 como hecha, pasa pmc verifica A3/)
    // Also in a work copy of the project, and with several edits at once.
    expect(guardUnverified(edit('- [ ] A3 · tres', '- [x] A3 · tres', 'C:\\proyectos\\app\\.claude\\worktrees\\uno\\docs\\TASKS.md'), file)).toBeDefined()
    expect(guardUnverified({ tool_name: 'MultiEdit', tool_input: { file_path: `${ROOT}\\docs\\TASKS.md`, edits: [{ old_string: '- [ ] A1 · uno', new_string: '- [x] A1 · uno' }, { old_string: '- [ ] A3', new_string: '- [x] A3' }] } }, file)).toMatch(/A3/)
  })

  it('una escritura entera se compara con el archivo de antes', () => {
    const read = () => '- [ ] A1 · uno\n- [ ] A3 · tres\n'
    expect(guardUnverified({ tool_name: 'Write', tool_input: { file_path: `${ROOT}/docs/TASKS.md`, content: '- [x] A1 · uno\n- [ ] A3 · tres\n' } }, file, read)).toBeUndefined()
    expect(guardUnverified({ tool_name: 'Write', tool_input: { file_path: `${ROOT}/docs/TASKS.md`, content: '- [ ] A1 · uno\n- [x] A3 · tres\n' } }, file, read)).toMatch(/A3/)
  })

  it('no se mete en otros archivos ni en proyectos que nunca pasaron pmc verifica', () => {
    expect(guardUnverified(edit('- [ ] A3', '- [x] A3', `${ROOT}\\docs\\NOTAS.md`), file)).toBeUndefined()
    expect(guardUnverified(edit('- [ ] A3', '- [x] A3', 'D:\\otro\\docs\\TASKS.md'), file)).toBeUndefined()
    expect(guardUnverified({ tool_name: 'Bash', tool_input: { command: 'echo' } }, file)).toBeUndefined()
  })

  it('una pasada del proyecto entero reciente vale para una tarea sin la suya', () => {
    const now = 10 * 3600_000
    const f = { projects: { app: { roots: [ROOT], tasks: { '*': { outcome: 'bien', at: now - 3600_000, summary: '' } } } } } as VerifiedFile
    expect(guardUnverified(edit('- [ ] A3', '- [x] A3'), f, undefined, now)).toBeUndefined()
    expect(guardUnverified(edit('- [ ] A3', '- [x] A3'), f, undefined, now + 3 * 3600_000)).toBeDefined()
  })

  it('pmc verifica deja el último resultado de cada tarea en el archivo que lee el gancho', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-gate-'))
    const db = openDb(join(dir, 'm.db'))
    const put = (task: string | null, outcome: string, at: number) => db.prepare('INSERT INTO verifications(project_id, task_key, account, at, outcome, summary, commit_id, dirty, checks) VALUES(?,?,?,?,?,?,?,?,?)').run('app', task, 'claude1', at, outcome, `${outcome} ${at}`, null, null, '[]')
    put('A1', 'falla', 1); put('A1', 'bien', 2); put(null, 'bien', 3)
    const out = join(dir, 'verified.json')
    writeVerified(db, { id: 'app', root: ROOT, copies: [{ path: 'C:\\proyectos\\app-copia', label: 'copia' }] } as any, out)
    const v = readVerified(out)
    expect(v.projects.app.roots).toEqual([ROOT, 'C:\\proyectos\\app-copia'])
    expect(v.projects.app.tasks.A1).toMatchObject({ outcome: 'bien', at: 2 })
    expect(v.projects.app.tasks['*']).toMatchObject({ outcome: 'bien', at: 3 })
  })
})
