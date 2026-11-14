import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mergeSkills, parseFind, parseList, parseSkillMd, pickSuggestions, scanSkills, skillsStamp, skillsTally, termsFor } from '../src/core/skills'

describe('skills', () => {
  it('lee nombre y descripción del SKILL.md, también en bloque plegado', () => {
    expect(parseSkillMd('---\nname: blender-modeling\ndescription: Create and edit meshes\n---\nbody', 'x')).toEqual({ name: 'blender-modeling', description: 'Create and edit meshes' })
    expect(parseSkillMd('---\nname: a\ndescription: >\n  Line one\n  line two\nother: 1\n---', 'x').description).toBe('Line one line two')
    expect(parseSkillMd('sin cabecera', 'carpeta').name).toBe('carpeta')
  })

  it('entiende la salida de npx skills find', () => {
    const out = 'Install with npx skills add <owner/repo@skill>\n\n\x1b[1munity-technologies/skills@unity-cli\x1b[0m 9.9K installs\n└ https://skills.sh/unity-technologies/skills/unity-cli\n\nsmall/repo@tiny 120 installs\n└ https://skills.sh/small/repo/tiny\n'
    const f = parseFind(out, 'unity')
    expect(f[0]).toMatchObject({ id: 'unity-technologies/skills@unity-cli', skill: 'unity-cli', installs: 9900, url: 'https://skills.sh/unity-technologies/skills/unity-cli', term: 'unity' })
    expect(f[1].installs).toBe(120)
    // Only trusted ones, without what is installed, the best first.
    expect(pickSuggestions(f, []).map((x) => x.skill)).toEqual(['unity-cli'])
    expect(pickSuggestions(f, ['unity-cli'])).toEqual([])
    // A famous skill that does not name the topic is not suggested; each topic gets its turn.
    const mixed = [
      { id: 'mattpocock/skills@domain-modeling', source: 'mattpocock/skills', skill: 'domain-modeling', installs: 972000, term: 'blender' },
      { id: 'a/blender-kit@blender-modeling', source: 'a/blender-kit', skill: 'blender-modeling', installs: 5000, term: 'blender' },
      { id: 'u/x@unity-a', source: 'u/x', skill: 'unity-a', installs: 9000, term: 'unity' },
      { id: 'u/x@unity-b', source: 'u/x', skill: 'unity-b', installs: 8000, term: 'unity' }
    ]
    expect(pickSuggestions(mixed, []).map((x) => x.skill)).toEqual(['blender-modeling', 'unity-a', 'unity-b'])
    // A Unity project gets no other engine's skills.
    const engines = [{ id: 'g/x@godot-shaders', source: 'g/x', skill: 'godot-shaders', installs: 11000, term: 'shader' }, { id: 'u/s@shader-graph', source: 'u/s', skill: 'shader-graph', installs: 6000, term: 'shader' }]
    expect(pickSuggestions(engines, [], 18, 5, ['unity']).map((x) => x.skill)).toEqual(['shader-graph'])
  })

  it('lee la descripción de cada skill al listar su repositorio', () => {
    const out = '│\n◇  Available Skills\n│\n│    2d-pixel-perfect\n│\n│      Sets up pixel perfect 2D rendering.\n│\n│    audio-setup-mixers\n│\n│      Routes Audio Sources into Mixer Groups.\n│      Second line.\n'
    expect(parseList(out)).toEqual({ '2d-pixel-perfect': 'Sets up pixel perfect 2D rendering.', 'audio-setup-mixers': 'Routes Audio Sources into Mixer Groups. Second line.' })
  })

  it('busca por lo que es el proyecto', () => {
    expect(termsFor(['unity', 'blender'])).toContain('blender')
    expect(termsFor(['unity'])[0]).toBe('unity')
  })

  it('reúne lo instalado por cuenta y por proyecto', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-skills-'))
    const mk = (dir: string, name: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: d ${name}\n---\n`) }
    mk(join(root, 'acc1', 'skills'), 'research')
    mk(join(root, 'acc2', 'skills'), 'research')
    mk(join(root, 'proj', '.claude', 'skills'), 'mission-control')
    const list = scanSkills({ accounts: [{ id: 'claude1', configDir: join(root, 'acc1') }, { id: 'claude2', configDir: join(root, 'acc2') }], projects: [{ id: 'p', roots: [join(root, 'proj')] }] })
    expect(list.find((s) => s.name === 'research')).toMatchObject({ scope: 'cuenta', accounts: ['claude1', 'claude2'] })
    expect(list.find((s) => s.name === 'mission-control')).toMatchObject({ scope: 'proyecto', projects: ['p'] })
  })
  it('leer por partes y juntar da lo mismo que leer de una vez; la huella cambia al instalar una (EV144)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-skills-'))
    const mk = (dir: string, name: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: d ${name}\n---\n`) }
    mk(join(root, 'acc1', 'skills'), 'research'); mk(join(root, 'acc2', 'skills'), 'research'); mk(join(root, 'acc2', 'skills'), 'otra')
    mk(join(root, 'proj', '.claude', 'skills'), 'mission-control')
    const accounts = [{ id: 'claude1', configDir: join(root, 'acc1') }, { id: 'claude2', configDir: join(root, 'acc2') }]
    const projects = [{ id: 'p', roots: [join(root, 'proj')] }]
    const lockFile = join(root, 'lock.json')
    const whole = scanSkills({ accounts, projects, lockFile })
    const parts = [...accounts.map((a) => scanSkills({ accounts: [a], projects: [], lockFile })), ...projects.map((p) => scanSkills({ accounts: [], projects: [p], lockFile }))].flat()
    expect(mergeSkills(parts)).toEqual(whole)
    const before = skillsStamp({ accounts, projects, lockFile })
    expect(skillsStamp({ accounts, projects, lockFile })).toBe(before)
    // A new skill folder changes its parent folder's date: the stamp is no longer the same.
    const dir = join(root, 'proj', '.claude', 'skills')
    mk(dir, 'nueva')
    utimesSync(dir, new Date(), new Date(Date.now() + 5000))
    expect(skillsStamp({ accounts, projects, lockFile })).not.toBe(before)
  })

  it('cuenta para el Tablero las skills de un proyecto: las suyas, las de las cuentas y los plugins, cada nombre una vez (EV133)', () => {
    const mk = (name: string, scope: 'proyecto' | 'cuenta' | 'plugin', projects: string[] = []) => ({ name, description: '', scope, accounts: [], projects, dir: '' })
    const list = [mk('a', 'proyecto', ['p']), mk('b', 'proyecto', ['otro']), mk('c', 'cuenta'), mk('plug:a', 'plugin'), mk('d', 'plugin')]
    expect(skillsTally(list, 'p', 4, 1)).toEqual({ installed: 3, suggested: 4, at: 1 })
    expect(skillsTally(list, 'otro', undefined, 1)).toEqual({ installed: 4, suggested: undefined, at: 1 })
    expect(skillsTally([], 'p', 0, 1).installed).toBe(0)
  })
})
