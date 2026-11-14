// macOS: what the app reads with `ps` and the scripts its Terminal windows run (core/platform.ts, main/terminal.ts).
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({}))

import { shQuote, tasklistFromPs } from '../src/core/platform'
import { terminalScript } from '../src/main/terminal'

describe('macOS', () => {
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
