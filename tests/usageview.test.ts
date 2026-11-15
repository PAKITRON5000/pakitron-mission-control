import { describe, expect, it } from 'vitest'
import { fastPace, usageView, usedColor, USAGE_SPAN } from '../src/core/usageview'

const H = 3600_000
const now = Date.parse('2026-11-14T19:23:00+01:00')

describe('usageView (EV175: lo usado, como /usage)', () => {
  it('el número es lo usado, igual que /usage; lo que queda va aparte', () => {
    const v = usageView({ snapshot: { capturedAt: now, fiveHour: { usedPct: 35, resetsAt: now + 3 * H } } as any }, 'five', now)
    expect(v.used).toBe(35)
    expect(v.left).toBe(65)
    expect(v.out).toBe(false)
    expect(v.elapsed).toBeCloseTo(0.4, 5)
  })

  it('el caso del Mac: 20 % gastado de la semana se dice 20 %, no 80 %', () => {
    const v = usageView({ snapshot: { capturedAt: now, sevenDay: { usedPct: 20, resetsAt: now + 4 * 24 * H } } as any }, 'week', now)
    expect(v.used).toBe(20)
  })

  it('una semana recién empezada no avisa de que se acaba (Claude 3, 14-11 19:23: 2 % en 23 min decía «se acaba 15:15»)', () => {
    const resetsAt = Date.parse('2026-11-21T19:00:00+01:00')
    const v = usageView({ snapshot: { capturedAt: now, sevenDay: { usedPct: 2, resetsAt } } as any }, 'week', now)
    expect(v.used).toBe(2)
    expect(v.emptyAt).toBeUndefined()
    expect(fastPace(v)).toBe(false)
  })

  it('con la ventana bien empezada sí dice cuándo se acaba a ese ritmo', () => {
    // 5 días de semana y un 90 % gastado: a ese ritmo se acaba antes de renovarse.
    const resetsAt = now + 2 * 24 * H
    const v = usageView({ snapshot: { capturedAt: now, sevenDay: { usedPct: 90, resetsAt } } as any }, 'week', now)
    expect(v.emptyAt).toBeDefined()
    expect(v.emptyAt!).toBeLessThan(resetsAt)
    expect(fastPace(v)).toBe(true)
  })

  it('una ventana que ya se renovó sin lectura nueva está entera: 0 % usado', () => {
    const v = usageView({ snapshot: { capturedAt: now - 6 * H, fiveHour: { usedPct: 97, resetsAt: now - H } } as any }, 'five', now)
    expect(v.used).toBe(0)
    expect(v.renewedAt).toBe(now - H)
  })

  it('con el límite semanal encima, la semana está al 100 % y agotada', () => {
    const v = usageView({ activeLimit: { at: now - H, resetsAt: now + 5 * H, kind: 'semanal', source: 'transcript' } as any }, 'week', now)
    expect(v).toMatchObject({ used: 100, left: 0, out: true })
  })

  it('sin lectura, nada que inventar', () => {
    expect(usageView({}, 'five', now)).toEqual({ which: 'five', out: false })
  })

  it('el color, como /usage: el de la cuenta, naranja desde el 75 % y rojo desde el 90 %', () => {
    expect(usedColor(40, 'base')).toBe('base')
    expect(usedColor(75, 'base')).toBe('var(--orange)')
    expect(usedColor(90, 'base')).toBe('var(--red)')
    expect(USAGE_SPAN.week).toBe(7 * 24 * H)
  })
})
