import { describe, expect, it } from 'vitest'
import { fitPackage, PACKAGE_LIMIT } from '../src/core/coord'

describe('the startup package fits (EV75)', () => {
  it('drops the least useful parts first and never the ones that must stay', () => {
    const must = ['Mensaje del usuario: ' + 'a'.repeat(1500), 'Cómo se trabaja aquí: ' + 'b'.repeat(1500)]
    const level = new Map([['parked ' + 'c'.repeat(400), 6], ['busy ' + 'd'.repeat(400), 5], ['team ' + 'e'.repeat(400), 2]])
    const parts = [must[0], ...level.keys(), must[1]]
    const fit = fitPackage(parts, (s) => level.get(s) ?? 0)
    expect(fit.join('\n').length).toBeLessThanOrEqual(PACKAGE_LIMIT)
    expect(fit).toContain(must[0])
    expect(fit).toContain(must[1])
    expect(fit.some((s) => s.startsWith('team'))).toBe(true)
    expect(fit.some((s) => s.startsWith('parked'))).toBe(false)
  })
  it('leaves a short package alone, and never cuts what must stay even if long', () => {
    expect(fitPackage(['a', 'b'], () => 3)).toEqual(['a', 'b'])
    const long = ['x'.repeat(5000)]
    expect(fitPackage(long, () => 0)).toEqual(long)
  })
})
