// EV145: a skill of the accounts taken to the one project that uses it, and back.
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitExcludeOf, readMoved, returnSkill, takeSkillToProject } from '../src/core/skillmove'

const mk = (dir: string, name: string, extra = '') => { mkdirSync(join(dir, name, 'references'), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${extra}`); writeFileSync(join(dir, name, 'references', 'r.md'), 'ref') }

describe('llevar una skill a su proyecto', () => {
  it('la copia a cada copia de trabajo, la aparta de las cuentas, la excluye de git y se puede devolver', () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-move-'))
    const acc1 = join(base, 'acc1', 'skills'), acc2 = join(base, 'acc2', 'skills')
    mk(acc1, 'unity-x'); mk(acc2, 'unity-x'); mk(acc1, 'otra')
    const root = join(base, 'juego'), copy = join(root, '.claude', 'worktrees', 'rachas')
    mkdirSync(join(root, '.git', 'info'), { recursive: true }); mkdirSync(copy, { recursive: true })
    writeFileSync(join(root, '.git', 'info', 'exclude'), '# git ls-files --others --exclude-from=.git/info/exclude')
    const ledger = join(base, 'llevadas.json')
    const m = takeSkillToProject({ name: 'unity-x', projectId: 'juego', accountSkillDirs: [acc1, acc2], copies: [root, copy, root], gitExclude: gitExcludeOf(root) }, ledger, 5)
    expect(m.placed).toEqual([join(root, '.claude', 'skills', 'unity-x'), join(copy, '.claude', 'skills', 'unity-x')])
    expect(readFileSync(join(copy, '.claude', 'skills', 'unity-x', 'references', 'r.md'), 'utf8')).toBe('ref')
    // Set aside in both accounts (two folders), next to their skills; the other skill stays.
    expect(existsSync(join(acc1, 'unity-x'))).toBe(false)
    expect(existsSync(join(base, 'acc2', 'skills-apartadas', 'unity-x', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(acc1, 'otra'))).toBe(true)
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain('\n.claude/skills/unity-x/\n')
    expect(readMoved(ledger)['unity-x']).toMatchObject({ projectId: 'juego', at: 5 })
    // Once only: a second time it is not in the accounts any more.
    expect(() => takeSkillToProject({ name: 'unity-x', projectId: 'juego', accountSkillDirs: [acc1, acc2], copies: [root] }, ledger)).toThrow(/no está/)
    returnSkill('unity-x', ledger)
    expect(existsSync(join(acc1, 'unity-x', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(acc2, 'unity-x', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(copy, '.claude', 'skills', 'unity-x'))).toBe(false)
    expect(readMoved(ledger)['unity-x']).toBeUndefined()
  })

  it('una que ya tenía el proyecto no se pisa ni se borra al devolver', () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-move-'))
    const acc = join(base, 'acc', 'skills')
    mk(acc, 'arte')
    const root = join(base, 'juego')
    mk(join(root, '.claude', 'skills'), 'arte', 'la del proyecto')
    const ledger = join(base, 'l.json')
    expect(takeSkillToProject({ name: 'arte', projectId: 'juego', accountSkillDirs: [acc], copies: [root] }, ledger).placed).toEqual([])
    returnSkill('arte', ledger)
    expect(readFileSync(join(root, '.claude', 'skills', 'arte', 'SKILL.md'), 'utf8')).toContain('la del proyecto')
    expect(existsSync(join(acc, 'arte', 'SKILL.md'))).toBe(true)
  })
})
