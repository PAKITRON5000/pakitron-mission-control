import { afterEach, describe, expect, it } from 'vitest'
import { liveRelevo } from '../src/core/brief'
import { enCursoLine, heartbeatLine, staleEnCurso, withHeartbeat } from '../src/core/checkpoint'
import { parseRelevo } from '../src/core/parse/relevo'
import { acceptanceOf } from '../src/core/acceptance'
import { taskTags } from '../src/core/coord'
import { setLang } from '../src/core/i18n'

// EV164: a project kept in English reads like one kept in Spanish; what is written follows the app's language.
describe('documentos en los dos idiomas', () => {
  afterEach(() => setLang('es'))

  const en = '# Handover\n\n**In progress (claude3, since 14:02):** the castle of the islands.\n\n**Last heartbeat:** 2026-11-14 14:02 · claude6 · Lagoon done.\n\n**Previous heartbeat:** 2026-11-14 13:00 · claude6 · Plan.\n'
  const es = '# Relevo\n\n**En curso (claude3, desde las 14:02):** el castillo de las islas.\n\n**Último latido:** 2026-11-14 14:02 · claude6 · Laguna hecha.\n'

  it('lee «En curso» y el último latido en inglés y en español', () => {
    expect(liveRelevo(en)).toEqual({ enCurso: expect.stringContaining('the castle of the islands'), latest: expect.stringContaining('Lagoon done') })
    expect(liveRelevo(es)).toEqual({ enCurso: expect.stringContaining('el castillo de las islas'), latest: expect.stringContaining('Laguna hecha') })
    expect(parseRelevo(en, 'docs/RELEVO.md').enCurso).toContain('the castle of the islands')
    expect(enCursoLine(en)).toMatch(/^\*\*In progress/)
    // Whose «In progress» it is, as with «En curso».
    expect(staleEnCurso(enCursoLine(en), 'claude1', undefined, 0).reminder).toBeTruthy()
    expect(staleEnCurso(enCursoLine(en), 'claude3', undefined, 0).reminder).toBeUndefined()
  })

  it('escribe el latido en el idioma de la app y deja el anterior debajo, sin amontonarlos', () => {
    setLang('en')
    const line = heartbeatLine(new Date(2026, 10, 14, 15, 0), 'claude3', 'Readers in both languages.')
    expect(line).toMatch(/^\*\*Last heartbeat:\*\* 2026-11-14 15:00 · claude3 · /)
    const out = withHeartbeat(en, line)
    expect(out).toContain(line)
    expect(out).toContain('**Previous heartbeat:** 2026-11-14 14:02')
    // The older previous one goes: only one is kept below.
    expect(out).not.toContain('13:00 · claude6 · Plan')
    setLang('es')
    expect(heartbeatLine(new Date(2026, 10, 14, 15, 0), 'claude3', 'x')).toMatch(/^\*\*Último latido:\*\* /)
    // A Spanish file written to in English (the user changed language): the new line replaces its Spanish one.
    setLang('en')
    const mixed = withHeartbeat(es, heartbeatLine(new Date(2026, 10, 14, 15, 0), 'claude3', 'Switched.'))
    expect(mixed).toContain('**Previous heartbeat:** 2026-11-14 14:02 · claude6 · Laguna hecha.')
    expect(mixed.match(/heartbeat|latido/gi)?.length).toBe(2)
  })

  it('entiende «done when» y «(after: X)» como «se da por buena cuando» y «(tras: X)»', () => {
    expect(acceptanceOf('Lagoon for the islands. Done when the castle tests pass and there are photos.')).toBe('the castle tests pass and there are photos')
    expect(acceptanceOf('Se da por buena cuando pasan las pruebas.')).toBe('pasan las pruebas')
    expect(taskTags('Castle of the town (after: F10d, F10e) [opus]').after).toEqual(['F10d', 'F10e'])
    expect(taskTags('Castillo del pueblo (tras: F10d) [opus]').after).toEqual(['F10d'])
  })
})
