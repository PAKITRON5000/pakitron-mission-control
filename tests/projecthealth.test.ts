// «Tus proyectos» (EV47): one line per project from what the app already reads.
import { describe, it, expect } from 'vitest'
import { projectHealth } from '../src/core/projecthealth'

describe('project health', () => {
  const now = new Date(2026, 10, 12, 12, 0).getTime()
  const base = { checksDeclared: true, counts: { pendiente: 3, enCurso: 1, revision: 0, esperan: 2 }, working: ['claude1'], now }

  it('green checks, recent commit, tasks and who works', () => {
    const h = projectHealth({ ...base, copies: [{ label: 'principal', dirty: 0, untracked: 0, headAt: now - 3 * 3600_000 }], check: { outcome: 'bien', at: now - 2 * 3600_000, summary: 'compila' } })
    expect(h.level).toBe('bien')
    expect(h.parts).toEqual(['comprobaciones en verde (hace 2 h)', 'último commit hace 3 h', '3 pendientes · 1 a medias · 2 esperan a otras', 'trabajando: Claude 1'])
  })

  it('failing checks are bad; old unsaved work with nobody there is a warning', () => {
    expect(projectHealth({ ...base, copies: [], check: { outcome: 'mal', at: now - 60_000, summary: 'error CS0103 en Pig.cs' } }).level).toBe('mal')
    const h = projectHealth({ ...base, working: [], copies: [{ label: 'rachas', dirty: 12, untracked: 1, headAt: now - 8 * 3600_000 }], check: { outcome: 'bien', at: now, summary: '' } })
    expect(h.level).toBe('aviso')
    expect(h.parts).toContain('13 archivos sin guardar en rachas y nadie trabajando (desde el commit de hace 8 h)')
    // The same changes with someone at work are just said.
    const busy = projectHealth({ ...base, copies: [{ label: 'rachas', dirty: 12, untracked: 1, headAt: now - 8 * 3600_000 }], check: { outcome: 'bien', at: now, summary: '' } })
    expect(busy.level).toBe('bien')
    expect(busy.parts).toContain('13 archivos sin guardar en rachas')
  })

  it('says how much its images and videos take (EV48)', () => {
    expect(projectHealth({ ...base, copies: [], mediaBytes: 12.55e9 }).parts).toContain('12,6 GB en imágenes y vídeos')
    expect(projectHealth({ ...base, copies: [], mediaBytes: 3e6 }).parts.join(' ')).not.toContain('imágenes')
  })

  it('no checks declared is a warning that says where to get them', () => {
    const h = projectHealth({ ...base, checksDeclared: false, copies: [] })
    expect(h.level).toBe('aviso')
    expect(h.parts[0]).toContain('Prepararlo')
  })
})
