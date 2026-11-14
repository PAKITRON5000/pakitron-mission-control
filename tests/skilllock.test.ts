import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillLock } from '../src/core/skills'

describe('where each skill came from (EV119)', () => {
  it('reads the skills.sh registry: repository and when it was updated', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'pmc-lock-')), '.skill-lock.json')
    writeFileSync(f, JSON.stringify({ version: 3, skills: {
      'find-skills': { source: 'vercel-labs/skills', sourceUrl: 'https://github.com/vercel-labs/skills.git', updatedAt: '2026-10-07T17:05:10.265Z' },
      animate: { sourceUrl: 'https://github.com/emilkowalski/skill.git', installedAt: '2026-10-07T10:00:00Z' }
    } }))
    const l = skillLock(f)
    expect(l['find-skills']).toEqual({ source: 'vercel-labs/skills', updatedAt: Date.parse('2026-10-07T17:05:10.265Z') })
    expect(l.animate.source).toBe('emilkowalski/skill')
  })

  it('without a registry, nothing (never a guess)', () => {
    expect(skillLock(join(tmpdir(), 'no-existe', '.skill-lock.json'))).toEqual({})
  })
})
