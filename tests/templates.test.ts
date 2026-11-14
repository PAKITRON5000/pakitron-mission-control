// «Crear proyecto» with a kind (EV45): rules, first tasks and the helpers that fit, in an empty folder.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEMPLATES, templateClaudeMd, templateOf, templateTasks } from '../src/core/templates'
import { prepareProject, profileAs } from '../src/core/profile'
import { parseTasks } from '../src/core/parse/tasks'
import { taskTags } from '../src/core/coord'
import { parseRelevo } from '../src/core/parse/relevo'
import { setLang } from '../src/core/i18n'

describe('project templates', () => {
  it('every template starts with the plan, and its tasks carry order, model and resource that pmc reads', () => {
    for (const t of TEMPLATES) {
      const tasks = parseTasks(templateTasks(t, 'X'))
      expect(tasks[0].extId).toBe('P1')
      for (const x of tasks) expect(taskTags(`${x.title} ${x.detail ?? ''}`).model, `${t.id} ${x.extId}`).toBeTruthy()
    }
    const unity = parseTasks(templateTasks(templateOf('juego-unity'), 'X'))
    const tags = taskTags(`${unity[2].title} ${unity[2].detail ?? ''}`)
    expect(tags.after).toEqual(['P2'])
    expect(tags.needs).toEqual(['unity'])
    expect(templateOf('nada').id).toBe('libre')
  })

  it('an empty folder created as a Unity game gets its rules, its tasks and the game reviewer from the start', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-tpl-'))
    const t = templateOf('juego-unity')
    writeFileSync(join(root, 'CLAUDE.md'), templateClaudeMd(t, 'Cerditos', 'Un juego de cerdos que corren.'))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'TASKS.md'), templateTasks(t, 'Cerditos'))
    prepareProject(profileAs(root, t.kinds, t.heavy, []))
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    expect(claude).toMatch(/^# Cerditos\n\nUn juego de cerdos que corren\.\n\n## Cómo es este proyecto\n\n- Juego en Unity/)
    expect(claude).toContain('## Cada sesión')
    expect(readFileSync(join(root, 'docs', 'TASKS.md'), 'utf8')).toContain('- [ ] P3 · Primera escena jugable')
    expect(readdirSync(join(root, '.claude', 'agents')).sort()).toContain('jugabilidad.md')
  })

  it('a project prepared with the language in English is written in English and the readers still understand it', () => {
    setLang('en')
    try {
      const root = mkdtempSync(join(tmpdir(), 'pmc-tpl-en-'))
      const t = templateOf('juego-unity')
      writeFileSync(join(root, 'CLAUDE.md'), templateClaudeMd(t, 'Starfall', 'A game about falling stars.'))
      mkdirSync(join(root, 'docs'))
      writeFileSync(join(root, 'docs', 'TASKS.md'), templateTasks(t, 'Starfall'))
      const made = prepareProject(profileAs(root, t.kinds, t.heavy, []))
      const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
      expect(claude).toContain('## What this project is like')
      expect(claude).toContain('- Unity game.')
      expect(claude).toContain('## Every session')
      expect(claude).not.toContain('Cada sesión')
      expect(made).not.toContain('CLAUDE.md')
      const tasks = readFileSync(join(root, 'docs', 'TASKS.md'), 'utf8')
      expect(tasks).toContain('# Tasks of Starfall')
      const parsed = parseTasks(tasks)
      expect(parsed.map((x) => x.extId)).toEqual(['P1', 'P2', 'P3', 'P4'])
      expect(taskTags(`${parsed[2].title} ${parsed[2].detail ?? ''}`).after).toEqual(['P2'])
      const relevo = readFileSync(join(root, 'docs', 'RELEVO.md'), 'utf8')
      expect(relevo).toContain('**In progress:** nobody.')
      expect(relevo).toContain('**Last heartbeat:**')
      expect(parseRelevo(relevo, 'RELEVO.md').enCurso).toMatch(/nobody/)
      expect(readFileSync(join(root, '.claude', 'agents', 'explorador.md'), 'utf8')).toContain('You are the project explorer')
      expect(readFileSync(join(root, '.claude', 'skills', 'mission-control', 'SKILL.md'), 'utf8')).toContain('How to work on a project')
      // The project card's gap mark and heading come in English too; brief.ts and pmc read both (docwords.ts).
      const card = readFileSync(join(root, 'docs', 'PROYECTO.md'), 'utf8')
      expect(card).toContain('(to fill)')
      expect(card).toContain('## How to work it best')
    } finally {
      setLang('es')
    }
  })
})
