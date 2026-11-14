// EV138: a task's code change, read from git, and a commented line as it goes to the Claude.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lineNote, parseDiff, taskOfSubject } from '../src/core/taskdiff'
import { taskDiff } from '../src/core/projects'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ function uno()',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' export { a }',
  '\\ No newline at end of file',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  ''
].join('\n')

describe('taskdiff', () => {
  it('lee los archivos, los trozos y el número de cada línea', () => {
    const [a, img] = parseDiff(DIFF)
    expect(a).toMatchObject({ path: 'src/a.ts', added: 2, removed: 1 })
    expect(a.hunks[0].header).toBe('function uno()')
    expect(a.hunks[0].lines).toEqual([
      { kind: 'ctx', text: 'const a = 1', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'const b = 2', oldNo: 2 },
      { kind: 'add', text: 'const b = 3', newNo: 2 },
      { kind: 'add', text: 'const c = 4', newNo: 3 },
      { kind: 'ctx', text: 'export { a }', oldNo: 3, newNo: 4 }
    ])
    expect(img).toMatchObject({ path: 'img.png', binary: true, hunks: [] })
    expect(parseDiff(DIFF, 2)[0].cut).toBe(3)
  })

  it('un commit es de la primera tarea que nombra, también en un punto de control', () => {
    expect(taskOfSubject('EV133: Memoria en el Tablero')).toBe('EV133')
    expect(taskOfSubject('Punto de control (claude6): EV136 hecha… EV133-EV135 cerradas')).toBe('EV136')
    expect(taskOfSubject('Punto de control (claude6): 0.32.4 instalada: EV133 casi')).toBe('EV133')
    expect(taskOfSubject('Arreglo sin tarea')).toBeUndefined()
  })

  it('el comentario de una línea dice dónde está y qué pone', () => {
    expect(lineNote({ path: 'src/a.ts', commit: 'abcdef123456', line: { kind: 'add', text: '  const c = 4', newNo: 3 }, text: ' Que sea 5. ' }))
      .toBe('- src/a.ts, línea 3 (commit abcdef1): «const c = 4». Que sea 5.')
    expect(lineNote({ path: 'b.ts', commit: 'abc', line: { kind: 'del', text: 'x', oldNo: 7 }, text: 'Vuelve a ponerla' })).toContain('línea quitada 7')
  })

  it('de un repositorio, solo los commits de la tarea y sin los archivos de registro', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'pmc-taskdiff-'))
    try {
      const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true })
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { windowsHide: true })
      g('config', 'user.email', 'prueba@example.com'); g('config', 'user.name', 'Prueba')
      mkdirSync(join(repo, 'docs')); mkdirSync(join(repo, 'src'))
      const commit = (file: string, body: string, msg: string) => { writeFileSync(join(repo, file), body); g('add', '.'); g('commit', '-q', '-m', msg) }
      commit('src/a.ts', 'uno\n', 'EV1: primero')
      commit('docs/TASKS.md', '- [x] EV1\n', 'Punto de control (claude1): EV1 hecha')
      commit('src/a.ts', 'uno\ndos\n', 'EV12: otra tarea que no es EV1')
      commit('src/a.ts', 'uno\ndos\ntres\n', 'Punto de control (claude1): EV1 casi; EV12 hecha')
      const list = await taskDiff(repo, 'EV1')
      expect(list.map((c) => c.subject)).toEqual(['Punto de control (claude1): EV1 casi; EV12 hecha', 'EV1: primero'])
      expect(list[0].files[0].hunks[0].lines.at(-1)).toEqual({ kind: 'add', text: 'tres', newNo: 3 })
      expect(await taskDiff(repo, 'no es un id')).toEqual([])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }, 30_000)
})
