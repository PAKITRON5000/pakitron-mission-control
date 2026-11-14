import { afterEach, describe, expect, it } from 'vitest'
import { improveOnAdd, improveText } from '../src/core/improve'
import { setLang } from '../src/core/i18n'

// EV171 «Mejorar mi proyecto».
afterEach(() => setLang('es'))
const DAY = 86400_000

describe('mejorar mi proyecto (EV171)', () => {
  it('el encargo nombra el proyecto, pide tareas con cómo se dan por buenas y empezar por la primera', () => {
    const s = improveText('Recetario')
    expect(s).toContain('Recetario')
    expect(s).toContain('docs/TASKS.md')
    expect(s).toContain('se da por buena cuando')
    expect(s).toContain('pmc claim')
    expect(s).toContain('pmc decide')
  })

  it('en inglés también, con el mismo proyecto', () => {
    setLang('en')
    const s = improveText('Recetario')
    expect(s).toContain('Recetario')
    expect(s).toContain('done when')
    expect(s).not.toContain('Repásalo')
  })

  it('al añadir: solo si la carpeta ya tenía trabajo, y no más de una vez por semana', () => {
    const now = 100 * DAY
    expect(improveOnAdd({ hasWork: true, now })).toBe(true)
    expect(improveOnAdd({ hasWork: false, now })).toBe(false)
    expect(improveOnAdd({ hasWork: true, lastAskedAt: now - 2 * DAY, now })).toBe(false)
    expect(improveOnAdd({ hasWork: true, lastAskedAt: now - 8 * DAY, now })).toBe(true)
  })
})
