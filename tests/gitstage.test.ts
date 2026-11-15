import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { addablePaths, commitStaged, stagePaths } from '../src/core/gitstage'

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', windowsHide: true })

describe('pmc guarda con muchos archivos o un texto largo (EV181)', () => {
  it('800 rutas largas (más que una línea de órdenes de Windows) y un mensaje de 40.000 caracteres entran en el commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-git-'))
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'prueba@example.com')
    git(root, 'config', 'user.name', 'prueba')
    git(root, 'config', 'core.autocrlf', 'false')
    const names: string[] = []
    for (let i = 0; i < 800; i++) {
      const name = `archivo-con-un-nombre-bastante-largo-como-los-de-unity-${String(i).padStart(4, '0')}-${'x'.repeat(40)}.txt`
      writeFileSync(join(root, name), String(i))
      names.push(name)
    }
    expect(names.join(' ').length).toBeGreaterThan(40_000)
    // One file left out on purpose: only what is named goes in.
    writeFileSync(join(root, 'no-va.txt'), 'fuera')
    stagePaths(root, names)
    const message = 'Punto de control: ' + 'texto largo '.repeat(3_400)
    expect(message.length).toBeGreaterThan(40_000)
    commitStaged(root, message)
    expect(git(root, 'log', '-1', '--format=%B').trim().length).toBe(message.trim().length)
    const files = git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean)
    expect(files.length).toBe(800)
    expect(git(root, 'status', '--porcelain')).toContain('no-va.txt')
    // 800 files through git take ~55 s alone and more with the whole suite and a busy PC (Unity, Blender): room for it.
  }, 180_000)

  it('sin rutas no hace nada', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-git-'))
    git(root, 'init', '-q')
    expect(() => stagePaths(root, [])).not.toThrow()
  })

  it('una ruta ignorada o que ya no existe no tumba el commit (Video Dos 15-11: «EL COMMIT NO SE HIZO: warning: … CRLF»)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-git-'))
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'prueba@example.com')
    git(root, 'config', 'user.name', 'prueba')
    writeFileSync(join(root, '.gitignore'), '*.log\n')
    writeFileSync(join(root, 'viejo.txt'), 'a')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'inicio')
    rmSync(join(root, 'viejo.txt'))
    writeFileSync(join(root, 'nuevo.txt'), 'b')
    writeFileSync(join(root, 'trabajo.log'), 'c')
    mkdirSync(join(root, 'carpeta'))
    writeFileSync(join(root, 'carpeta', 'dentro.txt'), 'd')
    expect(addablePaths(root, ['nuevo.txt', 'trabajo.log', 'nunca-existio.txt', 'viejo.txt', 'carpeta/'])).toEqual(['nuevo.txt', 'viejo.txt', 'carpeta/'])
    stagePaths(root, ['nuevo.txt', 'trabajo.log', 'nunca-existio.txt', 'viejo.txt', 'carpeta/'])
    commitStaged(root, 'Punto de control')
    const files = git(root, 'show', '--name-status', '--format=', 'HEAD')
    expect(files).toContain('A\tnuevo.txt')
    expect(files).toContain('D\tviejo.txt')
    expect(files).toContain('A\tcarpeta/dentro.txt')
    expect(files).not.toContain('trabajo.log')
  })
})
