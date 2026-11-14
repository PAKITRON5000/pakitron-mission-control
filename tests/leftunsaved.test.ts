// EV94: what a Claude leaves unsaved when it closes, said in «Tus proyectos» with the list.
import { describe, it, expect } from 'vitest'
import { leftUnsaved, projectHealth, LEFT_UNSAVED_MS } from '../src/core/projecthealth'

const now = Date.parse('2026-11-13T07:30:00+01:00')
const copy = { label: 'rachas', path: 'C:\\Juego\\.claude\\worktrees\\rachas', headAt: now - 3 * 3600_000, changed: ['Assets/Scripts/Pig.cs', 'docs/TASKS.md', 'Assets/Nuevo/', 'Library/x.asset'] }
const w = (account: string, file: string, minAgo: number) => ({ account, file: `${copy.path}\\${file}`, at: now - minAgo * 60_000 })

describe('archivos sin guardar al cerrar (EV94)', () => {
  it('cuenta solo lo que escribió cada cuenta después del último commit y sigue sin guardar', () => {
    const out = leftUnsaved({ copies: [copy], working: [], now, writes: [
      w('claude3', 'Assets\\Scripts\\Pig.cs', 50),
      w('claude3', 'docs\\TASKS.md', 45),
      w('claude3', 'Assets\\Nuevo\\Rueda.cs', 40), // inside a new folder git lists as «Assets/Nuevo/»
      w('claude3', 'Assets\\Scripts\\Guardado.cs', 40), // already committed: not in git status
      { account: 'claude3', file: `${copy.path}\\docs\\viejo.md`, at: copy.headAt - 60_000 }, // before the commit
      w('claude6', 'docs\\TASKS.md', 200) // before the commit too (3 h = the commit)
    ] })
    expect(out).toHaveLength(1)
    expect(out[0].account).toBe('claude3')
    expect(out[0].files).toEqual(['Assets/Scripts/Pig.cs', 'docs/TASKS.md', 'Assets/Nuevo/Rueda.cs'])
  })
  it('nada mientras alguien trabaja o si lo último es de hace menos de media hora', () => {
    expect(leftUnsaved({ copies: [copy], working: ['claude1'], now, writes: [w('claude3', 'docs\\TASKS.md', 90)] })).toEqual([])
    expect(leftUnsaved({ copies: [copy], working: [], now, writes: [w('claude3', 'docs\\TASKS.md', LEFT_UNSAVED_MS / 60_000 - 5)] })).toEqual([])
  })
  it('sale en «Tus proyectos» primero, con la cuenta y la lista', () => {
    const h = projectHealth({ copies: [{ label: 'rachas', dirty: 4, untracked: 1, headAt: copy.headAt }], checksDeclared: true, counts: { pendiente: 1, enCurso: 0, revision: 0, esperan: 0 }, working: [], now,
      unsaved: [{ account: 'claude3', copy: 'rachas', files: ['a/Pig.cs', 'docs/TASKS.md', 'b/c.cs', 'd.cs'], lastAt: now - 50 * 60_000 }] })
    expect(h.level).toBe('aviso')
    expect(h.parts[0]).toContain('Claude 3 dejó 4 archivos suyos sin guardar en rachas')
    expect(h.parts[0]).toContain('Pig.cs, TASKS.md, c.cs…')
  })
})
