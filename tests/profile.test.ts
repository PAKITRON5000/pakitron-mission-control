// A project understood from its folder: kind, gallery folders, checks, coordination files and subagents.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProfile, findMediaDirs, prepareProject } from '../src/core/profile'

const mk = (root: string, rel: string, text = 'x') => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }

describe('project profile', () => {
  it('a Unity game with Blender: kind, version, heavy resources, its own build tool as the check, game reviewers', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-prof-'))
    mk(root, 'ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 6000.3.9f1\n')
    mk(root, 'Assets/_Juego/Art/a.png'); mk(root, 'Assets/_Juego/Art/b.png'); mk(root, 'Assets/_Juego/Art/c.fbx')
    mk(root, 'Library/cache/x.png'); mk(root, 'Library/cache/y.png'); mk(root, 'Library/cache/z.png')
    mk(root, 'ArtSource/pig.blend'); mk(root, 'tools/unity.ps1')
    mk(root, 'Logs/captures/1.png'); mk(root, 'Logs/captures/2.png'); mk(root, 'Logs/captures/3.jpg')
    const p = detectProfile(root, ['scenario-blender-expert', 'scenario-unity-expert', 'impeccable', 'level-design'])
    expect(p.kinds).toEqual(['unity', 'blender'])
    expect(p.summary).toBe('Juego de Unity 6000.3.9f1, con arte 3D con Blender; sin git')
    expect(p.heavy.sort()).toEqual(['gpu', 'unity'])
    // tools/unity.ps1 is PowerShell: elsewhere (a Mac, 14-11 tests on macOS) the editor itself builds, and there is no test run.
    if (process.platform === 'win32') {
      expect(p.checks.map((c) => c.nombre)).toEqual(['compila', 'pruebas'])
      expect(p.checks[0].orden).toContain('tools/unity.ps1 build')
    } else {
      expect(p.checks.map((c) => c.nombre)).toEqual(['compila'])
      expect(p.checks[0].orden).toContain('6000.3.9f1')
    }
    expect(p.mediaDirs.map((d) => d.slice(root.length + 1)).sort()).toEqual(['Assets', 'Logs'])
    expect(p.skills).toEqual(['level-design', 'scenario-blender-expert', 'scenario-unity-expert'])
    expect(p.agents.map((a) => a.name)).toEqual(['explorador', 'verificador', 'relevo', 'coordinador', 'revisor-visual', 'jugabilidad', 'arte-3d'])
    expect(p.agents.find((a) => a.name === 'arte-3d')!.body).toContain('scenario-blender-expert')
  })

  it('a video edit keeps its clips at the root; an Electron app gets its type and test checks', () => {
    const v = mkdtempSync(join(tmpdir(), 'pmc-vid-'))
    for (const n of ['a.mp4', 'b.mp4', 'c.mov']) mk(v, n)
    const pv = detectProfile(v, ['resolve-edit', 'impeccable'])
    expect(pv.kinds).toEqual(['video'])
    expect(findMediaDirs(v)).toEqual([v])
    expect(pv.skills).toEqual(['resolve-edit'])
    const e = mkdtempSync(join(tmpdir(), 'pmc-app-'))
    mk(e, 'package.json', JSON.stringify({ name: 'mc', scripts: { test: 'vitest run' }, devDependencies: { electron: '45', typescript: '7' } }))
    mk(e, 'tsconfig.json', '{}')
    const pe = detectProfile(e, [])
    expect(pe.kinds).toEqual(['electron'])
    expect(pe.checks.map((c) => c.orden)).toEqual(['npx tsc --noEmit -p tsconfig.json', 'npm test'])
  })

  it('preparing creates only what is missing and never overwrites', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-prep-'))
    mk(root, 'docs/TASKS.md', '# Mías\n- [ ] A1 · algo\n')
    mk(root, 'CLAUDE.md', '# Mi proyecto\n\nReglas mías.\n')
    mk(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest run' } }))
    const made = prepareProject(detectProfile(root, []))
    expect(made).toEqual(['docs/RELEVO.md', 'docs/STATE.md', 'docs/DECISIONS.md', 'docs/PROYECTO.md', 'pmc.json', 'CLAUDE.md (sección «Cada sesión»)', '.claude/agents/explorador.md', '.claude/agents/verificador.md', '.claude/agents/relevo.md', '.claude/agents/coordinador.md', '.claude/skills/mission-control/SKILL.md'])
    expect(readFileSync(join(root, '.claude/skills/mission-control/SKILL.md'), 'utf8')).toMatch(/^---\nname: mission-control\ndescription: .+\n---/)
    expect(readFileSync(join(root, 'docs/TASKS.md'), 'utf8')).toBe('# Mías\n- [ ] A1 · algo\n')
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    expect(claude.startsWith('# Mi proyecto\n\nReglas mías.')).toBe(true)
    expect(claude).toContain('## Cada sesión')
    expect(readFileSync(join(root, '.claude/agents/verificador.md'), 'utf8')).toMatch(/^---\nname: verificador\ndescription: .+\ntools: Bash, Read, Grep\nmodel: haiku\nmaxTurns: 20\n---/)
    // EV139: the explorer keeps what it learns of the project for the next time, for every account, and has a shorter leash.
    expect(readFileSync(join(root, '.claude/agents/explorador.md'), 'utf8')).toMatch(/\nmodel: haiku\nmaxTurns: 15\nmemory: project\n---\n/)
    // A second time there is nothing left to create.
    expect(prepareProject(detectProfile(root, []))).toEqual([])
    expect(existsSync(join(root, 'docs/RELEVO.md'))).toBe(true)
  })
})

describe('subagents the app wrote', () => {
  it('carry what pmc stands for and a mark; with the mark they are brought up to date, without it they are left alone', async () => {
    const { AGENT_MARK } = await import('../src/core/profile')
    const root = mkdtempSync(join(tmpdir(), 'pmc-agents-'))
    prepareProject(detectProfile(root, []))
    const f = join(root, '.claude/agents/verificador.md')
    const text = readFileSync(f, 'utf8')
    expect(text).toContain('PakitronMC/bin/pmc.mjs')
    expect(text.trim().endsWith(AGENT_MARK)).toBe(true)
    writeFileSync(f, text.replace('Eres el verificador', 'Eres el verificador viejo'))
    expect(prepareProject(detectProfile(root, []), { refreshAgents: true })).toEqual(['.claude/agents/verificador.md (actualizado)'])
    writeFileSync(f, 'mío, sin marca')
    expect(prepareProject(detectProfile(root, []), { refreshAgents: true })).toEqual([])
    expect(readFileSync(f, 'utf8')).toBe('mío, sin marca')
  })

  it('EV142: a new version rewrites only the marked ones, and creates nothing', async () => {
    const { refreshMarkedAgents } = await import('../src/core/profile')
    const root = mkdtempSync(join(tmpdir(), 'pmc-agents-'))
    prepareProject(detectProfile(root, []))
    const exp = join(root, '.claude/agents/explorador.md')
    const rel = join(root, '.claude/agents/relevo.md')
    // As written by an older version (no maxTurns), one of them edited by hand (mark removed), and one deleted.
    writeFileSync(exp, readFileSync(exp, 'utf8').replace(/maxTurns: \d+\nmemory: project\n/, ''))
    writeFileSync(rel, 'mío, sin marca')
    rmSync(join(root, '.claude/agents/coordinador.md'))
    const before = readdirSync(root).sort()
    expect(refreshMarkedAgents(root, detectProfile(root, []).agents)).toEqual(['.claude/agents/explorador.md'])
    expect(readFileSync(exp, 'utf8')).toContain('maxTurns: 15\nmemory: project\n')
    expect(readFileSync(rel, 'utf8')).toBe('mío, sin marca')
    expect(existsSync(join(root, '.claude/agents/coordinador.md'))).toBe(false)
    expect(readdirSync(root).sort()).toEqual(before)
    expect(refreshMarkedAgents(root, detectProfile(root, []).agents)).toEqual([])
  })
})
