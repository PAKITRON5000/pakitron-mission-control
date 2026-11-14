// 13-11: «Claude 1 gastó 0 % de su semana» after spending its whole week and being recharged.
import { describe, it, expect } from 'vitest'
import { weekSpent } from '../src/core/accounts'

const W = 1795003200000
describe('week spent while away', () => {
  it('adds what went up, also across a recharge', () => {
    expect(weekSpent([{ at: 1, week: 90, weekResets: W }, { at: 2, week: 96, weekResets: W }, { at: 3, week: 100, weekResets: W }, { at: 4, week: 1, weekResets: W }, { at: 5, week: 9, weekResets: W }])).toBe(18)
    expect(weekSpent([{ at: 1, week: 10, weekResets: W }, { at: 2, week: 25, weekResets: W }])).toBe(15)
    // A new week in the middle: what went up inside each week.
    expect(weekSpent([{ at: 1, week: 95, weekResets: W }, { at: 2, week: 3, weekResets: W + 7 * 86400_000 }, { at: 3, week: 8, weekResets: W + 7 * 86400_000 }])).toBe(5)
    expect(weekSpent([{ at: 1, week: 40, weekResets: W }])).toBeUndefined()
  })
})
