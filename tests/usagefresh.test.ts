// The usage each account has left, from the right session (core/usagefresh.ts). The case of 14-11 16:14: Claude 5 at
// 100 % of its 5 hours working in Mission Control, and an idle session of the same account in another project, whose numbers
// were from the morning, redrew and saved 86 %.
import { describe, expect, it } from 'vitest'
import { acceptReading, sessionFreshAt } from '../src/core/usagefresh'

const H = 3600_000
const now = Date.parse('2026-11-14T16:14:15Z')
const fiveEnds = Date.parse('2026-11-14T16:30:00Z')
const weekEnds = Date.parse('2026-11-15T11:00:00Z')

describe('qué lectura de uso vale', () => {
  const working = { sessionId: 'mc', freshAt: now - 20_000, fiveHour: { usedPct: 100, resetsAt: fiveEnds }, sevenDay: { usedPct: 74, resetsAt: weekEnds } }

  it('una sesión quieta desde hace horas no pisa la de la que trabaja', () => {
    const idle = { sessionId: 'iv', freshAt: now - 3 * H, fiveHour: { usedPct: 86, resetsAt: fiveEnds }, sevenDay: { usedPct: 72, resetsAt: weekEnds } }
    expect(acceptReading(working, idle)).toBe(false)
  })

  it('la misma sesión siempre se pone al día (también si baja: una recarga regalada)', () => {
    expect(acceptReading(working, { ...working, freshAt: now, fiveHour: { usedPct: 0, resetsAt: fiveEnds } })).toBe(true)
  })

  it('otra sesión que acaba de preguntar a Anthropic, sí', () => {
    expect(acceptReading(working, { sessionId: 'otra', freshAt: now, fiveHour: { usedPct: 100, resetsAt: fiveEnds } })).toBe(true)
  })

  it('una que ya conoce una ventana de 5 horas más nueva, sí, aunque no sea la última en hablar', () => {
    const later = { sessionId: 'otra', freshAt: now - H, fiveHour: { usedPct: 3, resetsAt: fiveEnds + 5 * H } }
    expect(acceptReading(working, later)).toBe(true)
    // …y una con una ventana más vieja, no.
    expect(acceptReading(working, { sessionId: 'vieja', freshAt: now - 6 * H, fiveHour: { usedPct: 40, resetsAt: fiveEnds - 5 * H } })).toBe(false)
  })

  it('sin lectura guardada, o una guardada por una versión anterior, la nueva vale', () => {
    expect(acceptReading(undefined, { sessionId: 'a', freshAt: now })).toBe(true)
    expect(acceptReading({ sessionId: 'b', fiveHour: { usedPct: 50, resetsAt: fiveEnds } }, { sessionId: 'a', freshAt: now - 9 * H })).toBe(true)
  })
})

describe('cuándo habló una sesión con Anthropic por última vez', () => {
  it('ahora, si su tiempo de API ha crecido desde la última vez que se dibujó', () => {
    expect(sessionFreshAt({ apiMs: 1000, freshAt: now - H }, 1500, now - 2 * H, now)).toBe(now)
  })
  it('y si vuelve a cero (retomada en otro proceso), también', () => {
    expect(sessionFreshAt({ apiMs: 90_000, freshAt: now - 5 * H }, 0, now - 5 * H, now)).toBe(now)
  })
  it('con el mismo tiempo de API, lo que se sabía, aunque se haya tocado su conversación', () => {
    expect(sessionFreshAt({ apiMs: 1000, freshAt: now - 3 * H }, 1000, now - 60_000, now)).toBe(now - 3 * H)
  })
  it('la primera vez que se ve, cuando se escribió su conversación', () => {
    // The first redraw of a session open since the morning: its conversation says how old its numbers are.
    expect(sessionFreshAt(undefined, 5000, now - 4 * H, now)).toBe(now - 4 * H)
    // A mark of an older version, without its API time.
    expect(sessionFreshAt({ freshAt: now - 3 * H }, 5000, now - 2 * H, now)).toBe(now - 2 * H)
  })
  it('sin nada que lo diga, cuenta como nueva (como antes)', () => {
    expect(sessionFreshAt(undefined, undefined, undefined, now)).toBe(now)
  })
})
