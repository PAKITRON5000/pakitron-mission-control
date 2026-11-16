// EV207 (the user, 16-11: «me ha mandado claude5 algo en decidir y al responder, le ha llegado a claude2»).
import { describe, it, expect } from 'vitest'
import { askerWindow } from '../src/core/answerWatch'

describe('la respuesta de Decidir va a quien preguntó (EV207)', () => {
  const s = (pid: number | undefined, projectId: string, at: number, kind?: string, moving = false) => ({ pid, projectId, at, kind, moving })
  const pick = (list: ReturnType<typeof s>[], p = 'mc') => askerWindow(list, p, (x) => x.moving, (x) => x.at)

  it('elige la ventana más reciente de esa cuenta en ese proyecto', () => {
    expect(pick([s(1, 'mc', 10), s(2, 'mc', 30), s(3, 'fp', 99)]).window?.pid).toBe(2)
  })
  it('no escribe en ventanas de fondo, sin pid ni de otro proyecto', () => {
    expect(pick([s(1, 'mc', 10, 'background'), s(undefined, 'mc', 20), s(3, 'fp', 30)]).window).toBeUndefined()
  })
  it('si está trabajando no se le escribe: se lo lleva el gancho de su siguiente paso', () => {
    expect(pick([s(1, 'mc', 10), s(2, 'mc', 30, undefined, true)])).toEqual({ busy: true })
  })
})
