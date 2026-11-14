// EV91: a CLAUDE.md past 200 lines is said in «Tus proyectos» (every session reads it whole).
import { describe, it, expect } from 'vitest'
import { projectHealth, CLAUDE_MD_MAX_LINES } from '../src/core/projecthealth'

describe('CLAUDE.md demasiado largo (EV91)', () => {
  const now = new Date(2026, 10, 13, 2, 50).getTime()
  const base = { checksDeclared: true, counts: { pendiente: 0, enCurso: 0, revision: 0, esperan: 0 }, working: [], now, copies: [{ label: 'principal', dirty: 0, untracked: 0, headAt: now - 3600_000 }], check: { outcome: 'bien', at: now - 3600_000, summary: 'ok' } }
  it('avisa pasado el tope y no antes', () => {
    expect(projectHealth({ ...base, claudeMdLines: CLAUDE_MD_MAX_LINES }).level).toBe('bien')
    const h = projectHealth({ ...base, claudeMdLines: 260 })
    expect(h.level).toBe('aviso')
    expect(h.parts.some((p) => p.startsWith('CLAUDE.md de 260 líneas'))).toBe(true)
  })
})
