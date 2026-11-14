import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findTranscript, projectsDirs, savedSessions } from '../src/core/sessions'

// 13-11: Claude 5 keeps its conversations in its own folder (~/.claude-quinta/projects, not linked to ~/.claude/projects
// like the others) and the app read none of them.
describe('las conversaciones de cada cuenta, esté donde esté su carpeta', () => {
  const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'pmc-home-'))
    mkdirSync(join(home, '.claude', 'projects', 'C--a'), { recursive: true })
    writeFileSync(join(home, '.claude', 'projects', 'C--a', 's1.jsonl'), '{}\n')
    mkdirSync(join(home, '.claude-quinta', 'projects', 'C--b'), { recursive: true })
    writeFileSync(join(home, '.claude-quinta', 'projects', 'C--b', 's2.jsonl'), '{}\n')
    mkdirSync(join(home, '.claude-quinta', 'projects', 'C--a'), { recursive: true })
    writeFileSync(join(home, '.claude-quinta', 'projects', 'C--a', 's3.jsonl'), '{}\n')
    // Linked like claude2, 3, 4 and 6: the same folder, counted once.
    mkdirSync(join(home, '.claude-sexta'), { recursive: true })
    symlinkSync(join(home, '.claude', 'projects'), join(home, '.claude-sexta', 'projects'), 'junction')
    process.env.USERPROFILE = home
    process.env.HOME = home
  })
  afterAll(() => {
    process.env.USERPROFILE = was.USERPROFILE
    process.env.HOME = was.HOME
    try { rmSync(join(home, '.claude-sexta', 'projects')) } catch { /* the link only */ }
    rmSync(home, { recursive: true, force: true })
  })
  it('encuentra la de una cuenta con carpeta propia', () => {
    expect(projectsDirs()).toHaveLength(2)
    expect(findTranscript('s2', 'C:\\b')).toBe(join(home, '.claude-quinta', 'projects', 'C--b', 's2.jsonl'))
    expect(findTranscript('s1', 'C:\\a')).toBe(join(home, '.claude', 'projects', 'C--a', 's1.jsonl'))
    expect(findTranscript('s2')).toBe(join(home, '.claude-quinta', 'projects', 'C--b', 's2.jsonl'))
    expect(findTranscript('nada', 'C:\\a')).toBeUndefined()
  })
  it('las guardadas de una carpeta de trabajo salen de todas las cuentas, una vez cada una', () => {
    expect(savedSessions('C:\\a').map((s) => s.sessionId).sort()).toEqual(['s1', 's3'])
  })
})
