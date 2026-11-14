import { describe, it, expect } from 'vitest'
import { acceptanceLine, acceptanceOf } from '../src/core/acceptance'

describe('criterio de aceptación de una tarea (EV78)', () => {
  it('lo encuentra escrito de varias formas', () => {
    expect(acceptanceOf('- [ ] EV99 · **Algo** Se da por buena cuando Inicio carga en menos de 1 s y no hay «lento:» en mission.log. [sonnet]')).toBe('Inicio carga en menos de 1 s y no hay «lento:» en mission.log')
    expect(acceptanceOf('- [ ] X1 · Mapa. Criterio: las tres cuentas salen en su sitio')).toBe('las tres cuentas salen en su sitio')
    expect(acceptanceOf('- [ ] X2 · Algo sin criterio')).toBeUndefined()
  })
  it('lo dice o pide escribirlo', () => {
    expect(acceptanceLine('Se da por buena cuando compila.')).toContain('Se da por buena cuando: compila')
    expect(acceptanceLine('nada')).toContain('no dice cuándo se da por buena')
  })
})
