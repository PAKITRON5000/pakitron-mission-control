// EV176 (the user, 14-11: «por qué hay tantas tareas bloqueadas»): every waiting task says on its card what it waits for.
import { describe, expect, it } from 'vitest'
import { waitingOn } from '../src/renderer/src/screens/Tasks'

const task = (detail: string) => ({ title: 'Algo', detail } as any)

describe('waitingOn: qué espera una tarea en espera', () => {
  it('«Espera un hecho real» dice que está hecha y qué falta ver (antes no decía nada)', () => {
    const w = waitingOn(task('Espera un hecho real (14-11 17:41, claude1): instalada con la 0.34.0 a las 17:32. Falta ver el cierre.'))
    expect(w?.real).toBe(true)
    expect(w?.yours).toBe(false)
    expect(w?.text).toMatch(/^Hecha e instalada; falta verla pasar de verdad: instalada con la 0\.34\.0 a las 17:32$/)
  })

  it('«Bloqueada (…): espera a que el usuario…» se le dice al usuario', () => {
    const w = waitingOn(task('Bloqueada (13-11 16:40, claude6): espera a que el usuario tenga a mano el segundo ordenador. Hasta entonces nada.'))
    expect(w?.yours).toBe(true)
    expect(w?.text).toBe('Que tengas a mano el segundo ordenador')
  })

  it('«Espera a que el usuario la pruebe (…)» también', () => {
    const w = waitingOn(task('Espera a que el usuario la pruebe (14-11, claude1): abrir dos Claude dentro de la app.'))
    expect(w?.yours).toBe(true)
    expect(w?.text).toMatch(/^Que la pruebes: abrir dos Claude dentro de la app$/)
  })

  it('sin nota de espera, nada', () => {
    expect(waitingOn(task('Hecha (14-11): todo bien.'))).toBeUndefined()
  })
})
