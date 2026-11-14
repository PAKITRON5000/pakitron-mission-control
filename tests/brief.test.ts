// The work brief: a session starts from a couple of kilobytes, however long the project's hand-off file has grown.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-brief-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('work brief', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const { syncTasks } = await import('../src/core/engine')
  const coord = await import('../src/core/coord')
  const { briefText, taskText, liveRelevo, BRIEF_MAX } = await import('../src/core/brief')

  const history = Array.from({ length: 400 }, (_, i) => `## Latido: 2026-10-${String((i % 28) + 1).padStart(2, '0')} 10:00 (claude1)\n\n${'Historia larga de lo que se hizo aquel día. '.repeat(6)}\n`).join('\n')
  const relevo = [
    '# Por dónde vamos',
    '',
    '**En curso:** claude6, en `.claude/worktrees/rachas`, rama `rachas`. Nada pesado hasta que cierre Premiere.',
    '',
    `**Último latido:** 2026-11-11 19:50 · claude6. **Hecho esta tarde:** BZ6 escrito y compilado. **Para seguir:** 1) \`build\` y \`test\`; 2) el ejecutable. ${'Detalle del latido. '.repeat(200)}`,
    '',
    history
  ].join('\n')

  const setup = () => {
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const root = join(dir, 'game-' + Math.random().toString(36).slice(2))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'RELEVO.md'), relevo)
    writeFileSync(join(root, 'docs', 'TASKS.md'), [
      '## Rachas (asignado a claude1)',
      '- [~] AN1 · **Animaciones del guerrero.** Golpe, bloqueo y caída.',
      '  - Falta la caída desde altura.',
      '  - Las manos atraviesan el escudo.',
      '- [ ] AN2 · Animaciones del minero',
      '- [x] AN0 · Esqueleto común',
      '## Otra',
      '- [ ] BZ9 · Otra cosa'
    ].join('\n'))
    const p = { id: 'game', name: 'Game', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p)
    syncTasks(db, p)
    return { db, p }
  }

  it('takes only the two live paragraphs of a hand-off file', () => {
    const live = liveRelevo(relevo)
    expect(live.enCurso).toContain('claude6, en .claude/worktrees/rachas')
    expect(live.latest).toContain('2026-11-11 19:50')
    expect(live.latest).toContain('Para seguir')
    const heading = liveRelevo('# x\n\n## Último latido: 2026-11-01 01:29 (claude1, ronda de ropa)\n\nSe hizo la ropa.\n\n## Latido: 2026-10-31 20:39\n\nViejo.')
    expect(heading.latest).toContain('Se hizo la ropa')
    expect(heading.latest).not.toContain('Viejo')
  })

  it('stays small with a 100 KB hand-off file and says what comes next and what not to touch', () => {
    const { db, p } = setup()
    expect(relevo.length).toBeGreaterThan(100_000)
    coord.claimTask(db, 'game', coord.taskKeyFor(db, 'game', 'BZ9').key, 'claude2')
    const text = briefText(db, p, 'claude1', { teamFile: join(dir, 'no-team.json') })
    expect(text.length).toBeLessThanOrEqual(BRIEF_MAX)
    expect(text).toContain('EN CURSO: claude6')
    expect(text).toContain('ÚLTIMO LATIDO: 2026-11-11 19:50')
    expect(text).toContain('busca «Último latido»')
    expect(text).toContain('AN1 · Animaciones del guerrero [a medias]')
    expect(text).toContain('AN2')
    expect(text).not.toContain('AN0')
    expect(text).toContain('BZ9 (claude2)')
    expect(text).not.toMatch(/- BZ9/)
    expect(text).toContain('pmc tarea <ID>')
  })

  it('a project without a hand-off file is told to start one', () => {
    const { db, p } = setup()
    const bare = { ...p, docsDirs: [join(dir, 'nowhere')] }
    expect(briefText(db, bare, 'claude1', { teamFile: join(dir, 'no-team.json') })).toContain('no tiene docs/RELEVO.md')
  })

  it('one task: its line and what hangs from it, not the next task', () => {
    const { db, p } = setup()
    coord.claimTask(db, 'game', coord.taskKeyFor(db, 'game', 'AN1').key, 'claude3', { note: 'la caída' })
    const text = taskText(db, p, 'AN1')!
    expect(text).toContain('AN1 · en-desarrollo')
    expect(text).toContain('Reservada por claude3 (la caída)')
    expect(text).toContain('Las manos atraviesan el escudo')
    expect(text).not.toContain('minero')
    expect(taskText(db, p, 'ZZ99')).toBeUndefined()
  })
})

describe('a hand-off file kept short', async () => {
  const { allHeartbeats } = await import('../src/core/engine')
  it('its archived heartbeats are still read for the timeline, and «En curso» comes from the live file', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-archivo-'))
    mkdirSync(join(root, 'docs', 'archivo'), { recursive: true })
    writeFileSync(join(root, 'docs', 'RELEVO.md'), '**En curso:** claude6 en rachas.\n\n**Último latido:** 2026-11-12 01:05 · claude6. Parada.\n')
    writeFileSync(join(root, 'docs', 'archivo', 'RELEVO-hasta-2026-11-11.md'), '## Latido: 2026-10-31 20:39 (claude4 retoma tras claude1)\n\nRopa.\n')
    const p = { id: 'g', name: 'G', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    const hb = allHeartbeats([p])
    expect(hb.enCurso.get('g')).toContain('claude6 en rachas')
    expect(hb.byProject.get('g')!.map((h) => h.account)).toEqual(['claude6', 'claude4'])
  })
})
