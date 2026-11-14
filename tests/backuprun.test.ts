// EV44: the backup for real, on a small repository in a temporary folder: first copy, then only what is new, and a
// rewritten branch kept beside the old one (nothing in the copy is ever overwritten).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { backupProject } from '../src/main/backup'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim()

describe('backup run', () => {
  it('copies, updates and keeps rewritten history', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-backup-'))
    try {
      const repo = join(base, 'proyecto')
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { windowsHide: true })
      git(repo, 'config', 'user.email', 'prueba@example.com')
      git(repo, 'config', 'user.name', 'Prueba')
      writeFileSync(join(repo, 'a.txt'), 'uno')
      git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'uno')
      const target = join(base, 'Copias de proyectos', 'proyecto.git')

      const first = await backupProject(repo, target)
      expect(first.ok).toBe(true)
      expect(first.summary).toContain('primera copia')
      expect(git(target, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main'))

      const again = await backupProject(repo, target)
      expect(again).toMatchObject({ ok: true, summary: 'ya estaba al día' })

      writeFileSync(join(repo, 'a.txt'), 'dos')
      git(repo, 'commit', '-q', '-am', 'dos')
      git(repo, 'branch', 'otra')
      const more = await backupProject(repo, target)
      expect(more.ok).toBe(true)
      expect(git(target, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main'))
      expect(git(target, 'rev-parse', 'otra')).toBe(git(repo, 'rev-parse', 'otra'))

      // History rewritten: the copy keeps the old «main» and the new one goes under reescritas/.
      const old = git(target, 'rev-parse', 'main')
      git(repo, 'commit', '-q', '--amend', '-m', 'dos, reescrito')
      const kept = await backupProject(repo, target, new Date(2026, 10, 14, 3, 5).getTime())
      expect(kept.ok).toBe(true)
      expect(kept.summary).toContain('reescrita')
      expect(git(target, 'rev-parse', 'main')).toBe(old)
      expect(git(target, 'rev-parse', 'reescritas/2026-11-14-0305/main')).toBe(git(repo, 'rev-parse', 'main'))

      // A folder there that is not a git copy is never touched.
      const notGit = join(base, 'Copias de proyectos', 'otra cosa')
      mkdirSync(notGit, { recursive: true })
      const refused = await backupProject(repo, notGit)
      expect(refused.ok).toBe(false)
      expect(refused.summary).toContain('no se toca')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  }, 60_000)
})
