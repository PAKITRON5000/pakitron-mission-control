// EV133: today's commits counted by git, in every branch, beyond the 400 the timeline reads (534 in one day, 13-11).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { commitsSince } from '../src/core/projects'

const git = (cwd: string, env: Record<string, string>, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } }).trim()

describe('commitsSince', () => {
  it('cuenta los commits desde un momento en todas las ramas, y nada si no es un repositorio', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-commits-'))
    try {
      const repo = join(base, 'proyecto')
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { windowsHide: true })
      git(repo, {}, 'config', 'user.email', 'prueba@example.com')
      git(repo, {}, 'config', 'user.name', 'Prueba')
      const at = (d: string) => ({ GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
      const commit = (n: number, d: string) => { writeFileSync(join(repo, 'a.txt'), String(n)); git(repo, {}, 'add', '.'); git(repo, at(d), 'commit', '-q', '-m', `c${n}`) }
      commit(1, '2026-11-12T10:00:00+01:00')
      commit(2, '2026-11-13T09:00:00+01:00')
      git(repo, {}, 'checkout', '-q', '-b', 'otra')
      commit(3, '2026-11-13T11:00:00+01:00')
      git(repo, {}, 'checkout', '-q', 'main')
      commit(4, '2026-11-13T12:00:00+01:00')
      expect(await commitsSince(repo, Date.parse('2026-11-13T00:00:00+01:00'))).toBe(3)
      expect(await commitsSince(repo, Date.parse('2026-11-14T00:00:00+01:00'))).toBe(0)
      expect(await commitsSince(join(base, 'no-existe'), 0)).toBeUndefined()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  }, 30_000) // a dozen git calls: slow while the other test files run alongside
})
