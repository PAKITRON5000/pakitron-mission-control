import { describe, it, expect } from 'vitest'
import { clash, conflictsOf, forbids, inForce } from '../src/core/contradict'

describe('reglas que se contradicen (EV92)', () => {
  it('ve cuándo una prohíbe lo que la otra pide sobre lo mismo', () => {
    expect(forbids('No toques la aceleración del personaje')).toBe(true)
    expect(forbids('Pregunta antes de borrar')).toBe(false)
    expect(clash('Usa música generada con IA para los menús', 'Nunca música generada con IA: grabaciones reales')).toBe(true)
    expect(clash('Nada de menús desplegables que no se leen: opciones a la vista', 'Pon las opciones en menús desplegables')).toBe(true)
    expect(clash('Fotos antes de preguntar al usuario', 'No mandes fotos antes de preguntar')).toBe(true)
    // same sense, or different things: no clash
    expect(clash('No toques tools/unity.ps1', 'No borres tools/unity.ps1')).toBe(false)
    expect(clash('No toques la aceleración del personaje', 'Textos con humor en los menús')).toBe(false)
    expect(clash('Nunca subas nada a internet', 'Haz las capturas a 3440x1440')).toBe(false)
  })
  it('dice con cuáles choca una nueva', () => {
    const old = [{ id: 1, text: 'Las capturas siempre en pantalla completa a 3440x1440' }, { id: 2, text: 'Textos con humor' }]
    expect(conflictsOf('No hagas capturas en pantalla completa', old).map((m) => m.id)).toEqual([1])
  })
  it('en el arranque solo va la vigente: la más nueva', () => {
    const ms = [
      { id: 1, text: 'Usa música generada con IA en los menús del juego', at: 1 },
      { id: 2, text: 'Textos con humor', at: 2 },
      { id: 3, text: 'Nunca música generada con IA en los menús: grabaciones reales', at: 3 }
    ]
    expect(inForce(ms).map((m) => m.id)).toEqual([2, 3])
    // a looser match only asks the user; it never drops a rule by itself
    const loose = [{ id: 1, text: 'Usa música generada con IA para los menús', at: 1 }, { id: 3, text: 'Nunca música generada con IA: grabaciones reales', at: 3 }]
    expect(clash(loose[0].text, loose[1].text)).toBe(true)
    expect(inForce(loose).map((m) => m.id)).toEqual([1, 3])
  })
})
