import { describe, it, expect } from 'vitest'
import { compactInstructions } from '../src/core/compact'

describe('instrucciones para el resumen al compactar (EV76)', () => {
  it('pide conservar la tarea, lo que dijo el usuario y lo que falta comprobar, con las reservas y reglas del proyecto', () => {
    const t = compactInstructions({ project: 'Mission Control', claims: [{ id: 'EV76', title: 'Antes y después de compactar' }], rules: ['Primero la app, hasta que esté completamente lista'], enCurso: 'la rueda de relevos' })
    expect(t).toContain('Mission Control')
    expect(t).toContain('con sus propias palabras')
    expect(t).toContain('EV76 · Antes y después de compactar')
    expect(t).toContain('Primero la app')
    expect(t).toContain('En curso según el relevo: la rueda de relevos')
    expect(t.length).toBeLessThanOrEqual(3500)
  })
  it('no pasa de su tope aunque el relevo sea enorme', () => {
    const t = compactInstructions({ project: 'X', claims: Array.from({ length: 80 }, (_, i) => ({ id: 'T' + i, title: 'tarea larga '.repeat(10) })), rules: [], enCurso: 'x'.repeat(5000) })
    expect(t.length).toBeLessThanOrEqual(3500)
  })
})
