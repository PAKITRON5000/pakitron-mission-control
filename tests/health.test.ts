// Requirements and readings: each piece says whether it is there, and only asks for what a project uses.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { checkTools, checkReadings } from '../src/core/health'

describe('requirements at start', () => {
  const exec = (have: string[]) => (cmd: string) => { if (have.some((h) => cmd.includes(h))) return `${cmd} 1.2.3\n`; throw new Error('not found') }
  it('asks for Claude Code, Git and Node always; Unity and Blender only when a project uses them', () => {
    const none = checkTools({ claudePath: 'claude', projectRoots: ['C:/p'], accounts: [], exec: exec(['git', 'node']), exists: () => false })
    expect(none.map((c) => `${c.name}:${c.ok}`)).toEqual(['Claude Code:false', 'Git:true', 'Node:true'])
    expect(none[0].fix).toContain('Instala Claude Code')
    const game = checkTools({ claudePath: 'claude', projectRoots: ['C:/game'], accounts: [], exec: exec(['claude', 'git', 'node']), exists: (p) => p === join('C:/game', 'ProjectSettings', 'ProjectVersion.txt') || p === join('C:/game', 'ArtSource') })
    expect(game.map((c) => c.name)).toEqual(['Claude Code', 'Git', 'Node', 'Unity', 'Blender'])
    expect(game.find((c) => c.name === 'Unity')).toMatchObject({ ok: false, needed: false })
  })
  it('says which account is not plugged in, and which folder is gone', () => {
    const r = checkReadings({ claudePath: 'claude', projectRoots: [], exists: (p) => !p.includes('gone'), accounts: [
      { id: 'claude1', configDir: 'C:/a', statusLine: true, hooks: true, usageAt: Date.now() },
      { id: 'claude6', configDir: 'C:/b', statusLine: true, hooks: false },
      { id: 'claude2', configDir: 'C:/gone', statusLine: false, hooks: false }
    ] })
    expect(r[0].ok).toBe(true)
    expect(r[1]).toMatchObject({ ok: false })
    expect(r[1].detail).toContain('no recibe avisos')
    expect(r[2].detail).toContain('su carpeta no existe')
  })
})
