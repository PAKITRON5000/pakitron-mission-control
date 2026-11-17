// EV205: the skills that go into a project alone, the button «Instalar las que le sirven», and pmc skills-instala.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTO_MAX, AUTO_MIN_INSTALLS, excludeFromGit, noteInstalled, noteRemoved, pickAutoInstall, pickForSearch, readAuto, refuseInstall } from '../src/core/skillauto'
import { MIN_INSTALLS, type FoundSkill } from '../src/core/skills'

const f = (id: string, installs: number, term = 'unity'): FoundSkill => ({ id, skill: id.split('@')[1], source: id.split('@')[0], installs, term })

describe('skills que se ponen solas (EV205)', () => {
  it('solo las muy usadas, en el orden de las sugerencias, como mucho tres', () => {
    const sug = [f('a/r@unity-ui', 9000), f('b/r@unity-poco', 1500), f('c/r@unity-shaders', 120_000), f('d/r@unity-tests', 5000), f('e/r@unity-net', 40_000)]
    expect(AUTO_MAX).toBe(3)
    expect(pickAutoInstall(sug, []).map((x) => x.skill)).toEqual(['unity-ui', 'unity-shaders', 'unity-tests'])
    // The button installs up to five of the same ones.
    expect(pickAutoInstall(sug, [], 5).map((x) => x.skill)).toEqual(['unity-ui', 'unity-shaders', 'unity-tests', 'unity-net'])
    expect(pickAutoInstall(sug, [], 5).every((x) => x.installs >= AUTO_MIN_INSTALLS)).toBe(true)
  })

  it('una que el usuario quitó del proyecto no vuelve sola, se llame como se llame en la lista', () => {
    const sug = [f('a/r@unity-ui', 9000), f('c/r@unity-shaders', 120_000)]
    expect(pickAutoInstall(sug, ['unity-ui']).map((x) => x.skill)).toEqual(['unity-shaders'])
    expect(pickAutoInstall(sug, ['coleccion:UNITY-UI']).map((x) => x.skill)).toEqual(['unity-shaders'])
  })

  it('el registro: puesta sola, quitada (no vuelve) y vuelta a poner a mano (ya no cuenta como quitada)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-auto-')), 'skills-puestas.json')
    noteInstalled('juego', { name: 'unity-ui', id: 'a/r@unity-ui', by: 'app' }, file, 10)
    noteInstalled('juego', { name: 'unity-shaders', id: 'c/r@unity-shaders', by: 'app' }, file, 11)
    expect(readAuto(file).juego.auto.map((x) => x.name)).toEqual(['unity-ui', 'unity-shaders'])
    noteRemoved('juego', 'unity-ui', file)
    noteRemoved('juego', 'unity-ui', file)
    expect(readAuto(file).juego).toEqual({ auto: [{ name: 'unity-shaders', id: 'c/r@unity-shaders', by: 'app', at: 11 }], removed: ['unity-ui'] })
    // Another project keeps its own record.
    expect(readAuto(file).otro).toBeUndefined()
    noteInstalled('juego', { name: 'unity-ui', id: 'a/r@unity-ui', by: 'usuario' }, file, 12)
    expect(readAuto(file).juego.removed).toEqual([])
    expect(readAuto(file).juego.auto.find((x) => x.name === 'unity-ui')?.by).toBe('usuario')
  })

  it('fuera de git: una línea por skill y la del skills-lock.json, sin repetirlas y sin romper lo que había', () => {
    const exclude = join(mkdtempSync(join(tmpdir(), 'pmc-auto-')), '.git', 'info', 'exclude')
    excludeFromGit(exclude, 'unity-ui')
    excludeFromGit(exclude, 'unity-ui')
    expect(readFileSync(exclude, 'utf8')).toBe('.claude/skills/unity-ui/\n/skills-lock.json\n')
    excludeFromGit(exclude, 'unity-shaders')
    expect(readFileSync(exclude, 'utf8')).toBe('.claude/skills/unity-ui/\n/skills-lock.json\n.claude/skills/unity-shaders/\n')
    writeFileSync(exclude, '# mio\r\nbuild/')
    excludeFromGit(exclude, 'unity-net')
    expect(readFileSync(exclude, 'utf8')).toBe('# mio\r\nbuild/\n.claude/skills/unity-net/\n/skills-lock.json\n')
    excludeFromGit(undefined, 'nada') // a project without git: nothing to do, no error
  })
})

describe('pmc skills-busca y skills-instala (EV205)', () => {
  it('la búsqueda: solo las fiables que no están ya, en el orden de skills.sh', () => {
    const found = [f('a/r@video-edit', 30_000, 'video'), f('b/r@video-poco', 200, 'video'), f('c/r@ffmpeg', 4000, 'video'), f('a/r@video-edit', 30_000, 'video'), f('d/r@ya-esta', 9000, 'video')]
    expect(pickForSearch(found, ['ya-esta'], MIN_INSTALLS).map((x) => x.id)).toEqual(['a/r@video-edit', 'c/r@ffmpeg'])
    expect(pickForSearch(found, [], MIN_INSTALLS, 1).map((x) => x.id)).toEqual(['a/r@video-edit'])
  })

  it('instalar: nombre bien escrito, que skills.sh la liste con más de mil instalaciones y que el usuario no la haya quitado', () => {
    const found = [f('a/r@video-edit', 30_000, 'video'), f('b/r@video-poco', 200, 'video')]
    expect(refuseInstall('a/r@video-edit', found, [], MIN_INSTALLS)).toBeUndefined()
    expect(refuseInstall('A/R@Video-Edit', found, [], MIN_INSTALLS)).toBeUndefined()
    expect(refuseInstall('video-edit', found, [], MIN_INSTALLS)).toBe('nombre')
    expect(refuseInstall('a/r@video-edit; rm -rf /', found, [], MIN_INSTALLS)).toBe('nombre')
    expect(refuseInstall('b/r@video-poco', found, [], MIN_INSTALLS)).toBe('pocas')
    expect(refuseInstall('z/r@no-existe', found, [], MIN_INSTALLS)).toBe('desconocida')
    expect(refuseInstall('a/r@video-edit', found, ['video-edit'], MIN_INSTALLS)).toBe('quitada')
  })
})
