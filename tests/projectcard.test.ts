import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProfile, prepareProject, projectCard, TO_FILL } from '../src/core/profile'

describe('the project card (EV109)', () => {
  it('says what the app can see and leaves marked what only a Claude reading it can write', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-card-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' }, devDependencies: { vitest: '1' } }))
    mkdirSync(join(root, 'src'))
    const p = detectProfile(root, [])
    const card = projectCard(p)
    expect(card).toContain('ficha del proyecto')
    expect(card).toContain('## Cómo se comprueba')
    expect(card).toContain('## Cómo trabajarlo mejor')
    expect(card.split(TO_FILL).length - 1).toBeGreaterThanOrEqual(3)
    expect(card.split('\n').length).toBeLessThan(45)
  })

  it('is written when preparing a project, and never over one that exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-card-'))
    writeFileSync(join(root, 'README.md'), '# Demo\n')
    const made = prepareProject(detectProfile(root, []), { agents: false })
    expect(made).toContain('docs/PROYECTO.md')
    writeFileSync(join(root, 'docs', 'PROYECTO.md'), 'mía')
    prepareProject(detectProfile(root, []), { agents: false })
    expect(readFileSync(join(root, 'docs', 'PROYECTO.md'), 'utf8')).toBe('mía')
    expect(detectProfile(root, []).docs.card).toBe(true)
  })
})
