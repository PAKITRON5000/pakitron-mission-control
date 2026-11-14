// 13-11: EV44 and EV52 stayed «bloqueadas» after being unblocked, because an older note further on the line said so.
import { describe, it, expect } from 'vitest'
import { statusFor } from '../src/core/parse/tasks'

describe('status of a task in progress', () => {
  it('follows the newest note (the first one), not an older one further on', () => {
    expect(statusFor('~', 'EV44 · *Copia hecha, sin instalar.* *Bloqueada (09:54): espera a Decidir #135.* **Rutinas**')).toBe('en-desarrollo')
    expect(statusFor('~', 'EV96 · *Bloqueada (09:54): espera una recarga de verdad.* *Visto el texto real.* **Recarga inteligente**')).toBe('bloqueada')
    expect(statusFor('~', 'EV9 · *Hecho; a la espera del visto bueno del usuario.* *Bloqueada antes.* **Algo**')).toBe('revision')
    // EV121: waiting for something that has to happen for real is not work a session can take now.
    expect(statusFor('~', 'EV120 · *Espera un hecho real (13-11, claude1): una recarga hecha a mano.* *Hecha, sin instalar.* **Recarga**')).toBe('bloqueada')
  })
  it('without notes, the whole text as before', () => {
    expect(statusFor('~', 'EV1 · **Algo** bloqueada hasta que llegue el disco')).toBe('bloqueada')
    expect(statusFor('~', 'EV2 · **Algo** a medias')).toBe('en-desarrollo')
    expect(statusFor('x', 'EV3 · *Bloqueada* **Algo**')).toBe('terminada')
    expect(statusFor(' ', 'EV4 · **Algo**')).toBe('pendiente')
  })
})
