import { describe, it, expect } from 'vitest'
import { heartbeatLine, parseGuarda } from '../src/core/checkpoint'

describe('relevo con plantilla fija (EV77)', () => {
  it('lee el texto libre y los tres campos de la plantilla', () => {
    expect(parseGuarda(['EV77 hecho', '--probado', 'npm test y una ventana real', '--siguiente', 'EV80', '--no-rehacer', 'el gancho PreCompact'])).toEqual({ text: 'EV77 hecho', tested: 'npm test y una ventana real', next: 'EV80', dontRedo: 'el gancho PreCompact', noCommit: false })
    expect(parseGuarda(['solo texto', '--sin-commit'])).toEqual({ text: 'solo texto', noCommit: true })
    // A flag with no value is not the text.
    expect(parseGuarda(['algo', '--probado', '--sin-commit']).text).toBe('algo')
  })
  it('el latido lleva rama, último commit, qué se probó, el siguiente paso y qué no rehacer', () => {
    const line = heartbeatLine(new Date(2026, 10, 13, 2, 20), 'claude6', 'EV77 hecho.', { branch: 'main', commit: '71cc52d EV76', tested: 'npm test', next: 'EV80', dontRedo: 'EV76' })
    expect(line).toBe('**Último latido:** 2026-11-13 02:20 · claude6 · EV77 hecho. Rama main, último commit 71cc52d EV76. Probado: npm test. Siguiente: EV80. No rehacer: EV76.')
    expect(heartbeatLine(new Date(2026, 10, 13, 2, 20), 'claude6', 'sin más')).toBe('**Último latido:** 2026-11-13 02:20 · claude6 · sin más')
  })
})
