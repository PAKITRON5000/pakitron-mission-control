// macOS: what the app reads with `ps` and the scripts its Terminal windows run (core/platform.ts, main/terminal.ts).
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({}))

import { mergedPath, shQuote, tasklistFromPs } from '../src/core/platform'
import { terminalScript } from '../src/main/terminal'

describe('macOS', () => {
  it('the login shell PATH goes first, then what the app had, then the usual folders, never twice', () => {
    const p = mergedPath(['/Users/ana/.nvm/versions/node/v22/bin', '/usr/bin'], '/usr/bin:/bin').split(':')
    expect(p[0]).toBe('/Users/ana/.nvm/versions/node/v22/bin')
    expect(p.indexOf('/usr/bin')).toBe(1)
    expect(p).toContain('/opt/homebrew/bin')
    expect(new Set(p).size).toBe(p.length)
  })

  it('shQuote keeps any text as one word', () => {
    expect(shQuote('/Users/ana/Mis cosas')).toBe("'/Users/ana/Mis cosas'")
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })

  it('ps names read as tasklist names', () => {
    const out = tasklistFromPs('Unity\nBlender\nAdobe Premiere Pro 2025\n/Applications/DaVinci Resolve.app/Contents/MacOS/Resolve\nclaude\nSafari\n')
    expect(out.split('\n')).toEqual(['"unity.exe"', '"blender.exe"', '"adobe premiere pro.exe"', '"resolve.exe"', '"claude.exe"', '"safari.exe"'])
  })

  it('a window script sets the account, the folder and the command, and leaves a shell', () => {
    const s = terminalScript({ title: 'claude3 · Mi juego', cwd: '/Users/ana/Mi juego', configDir: '/Users/ana/.claude-tres', argv: ['/Users/ana/.local/bin/claude', '--resume', 'abc'] })
    expect(s.startsWith('#!/bin/zsh\nrm -f -- "$0"')).toBe(true)
    expect(s).toContain("cd '/Users/ana/Mi juego' || exit 1")
    expect(s).toContain("export CLAUDE_CONFIG_DIR='/Users/ana/.claude-tres'")
    expect(s).toContain('unset CLAUDE_CODE_CHILD_SESSION')
    expect(s).toContain("'/Users/ana/.local/bin/claude' '--resume' 'abc'")
    expect(s.trimEnd().endsWith('exec "${SHELL:-/bin/zsh}" -l')).toBe(true)
  })

  it('a scheduled window keeps its script and runs its check first', () => {
    const s = terminalScript({ title: 't', cwd: '/x', argv: ['claude', 'sigue'], before: ['node pmc.mjs puede-arrancar claude1 p || exit 0'], once: false })
    expect(s).not.toContain('rm -f -- "$0"')
    expect(s).toContain('unset CLAUDE_CONFIG_DIR')
    expect(s.indexOf('puede-arrancar')).toBeLessThan(s.indexOf("'claude' 'sigue'"))
  })
})

import { projectForPath, binnable } from '../src/core/projects'
import { isInside, pathKey } from '../src/core/paths'

// 14-11, from a Mac: `pmc` said «Esta carpeta no pertenece a ningún proyecto» in every project, because only the folder
// it was run in had its «/» turned into «\», never the project's stored folder.
describe('macOS paths', () => {
  const p = { id: 'subty', name: 'Subty', root: '/Users/ana/Claude/Subty', copies: [{ path: '/Users/ana/Claude/Subty/.claude/worktrees/rachas', label: 'rachas' }] } as never
  it('a folder inside a project is that project, in its copy when it is in one', () => {
    expect(projectForPath([p], '/Users/ana/Claude/Subty').project?.id).toBe('subty')
    expect(projectForPath([p], '/Users/ana/Claude/Subty/src/app').project?.id).toBe('subty')
    expect(projectForPath([p], '/Users/ana/Claude/Subty/.claude/worktrees/rachas/src').copy).toBe('rachas')
    expect(projectForPath([p], '/Users/ana/Claude/Subtitles').project).toBeUndefined()
  })
  it('isInside and pathKey treat both separators alike', () => {
    expect(isInside('/Users/ana/x/y', '/users/ana/x/')).toBe(true)
    expect(isInside('/Users/ana/xy', '/Users/ana/x')).toBe(false)
    expect(pathKey(String.raw`C:/A\b/`)).toBe(pathKey(String.raw`c:\a/B`))
  })
  it('only a project folder goes to the bin on a Mac', () => {
    const home = '/Users/ana'
    const app = '/Applications/Pakitron Mission Control.app'
    expect(binnable('/Users/ana/Claude/Subty', app, home, 'darwin')).toBe(true)
    for (const r of ['/', '/Users', '/Users/ana', '/Users/ana/Downloads', '/Volumes/Disco', '/Applications', 'Claude/Subty']) expect(binnable(r, app, home, 'darwin')).toBe(false)
  })
})

import { backupTarget } from '../src/core/backup'

describe('backups on a Mac', () => {
  it('keep each folder its own separator', () => {
    expect(backupTarget('/Volumes/Disco/Copias de proyectos/', 'mi juego')).toBe('/Volumes/Disco/Copias de proyectos/mi_juego.git')
    expect(backupTarget('G:\\Copias', 'juego')).toBe('G:\\Copias\\juego.git')
  })
})

import { withMacKeys } from '../src/core/i18n'

describe('shortcuts on a Mac', () => {
  it('say ⌘ instead of Ctrl, except Ctrl + Tab', () => {
    expect(withMacKeys('Buscar (Ctrl+K)')).toBe('Buscar (⌘K)')
    expect(withMacKeys('Ctrl K')).toBe('⌘K')
    expect(withMacKeys('Ctrl + Intro para enviar')).toBe('⌘Intro para enviar')
    expect(withMacKeys('Cambiar de proyecto (Ctrl + Tab)')).toBe('Cambiar de proyecto (Ctrl + Tab)')
    expect(withMacKeys('Ctrl + / Ctrl − cambian el tamaño')).toBe('⌘ + / ⌘− cambian el tamaño')
    expect(withMacKeys('Ctrl 0')).toBe('⌘0')
    expect(withMacKeys('Ctrl + {v0}'.replace('{v0}', '3'))).toBe('⌘3')
    expect(withMacKeys('Ctrl + 1…9, los apartados')).toBe('⌘1…9, los apartados')
  })
})
