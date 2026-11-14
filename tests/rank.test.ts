import { describe, it, expect } from 'vitest'
import { rankOf } from '../src/core/rank'

describe('rango de cada cuenta por su plan (EV84)', () => {
  it('Pro es soldado; Max 5x y los de equipo, caballero; Max 20x, campeón', () => {
    expect(rankOf({ subscriptionType: 'pro', planTier: 'pro' })).toBe('pro')
    expect(rankOf({ subscriptionType: 'max', planTier: 'max_5x' })).toBe('max5')
    expect(rankOf({ subscriptionType: 'max', planTier: 'max_20x' })).toBe('max20')
    expect(rankOf({ subscriptionType: 'team' })).toBe('max5')
    // EV146: Ultra, above Max 20x (it came out as Pro).
    expect(rankOf({ subscriptionType: 'ultra', planTier: 'ultra' })).toBe('max20')
    expect(rankOf({})).toBeUndefined()
    expect(rankOf(undefined)).toBeUndefined()
  })
})
