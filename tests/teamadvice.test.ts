import { describe, expect, it } from 'vitest'
import { modeOf, settingsFor, teamAdvice } from '../src/core/workmode'

describe('the way of working for the team the user has (EV110)', () => {
  it('one account works on its own; two or three relay; four or more relay with two fronts', () => {
    expect(teamAdvice(1)).toMatchObject({ mode: 'cada-uno', fronts: 1 })
    expect(teamAdvice(0).mode).toBe('cada-uno')
    expect(teamAdvice(3)).toMatchObject({ mode: 'relevos', fronts: 1 })
    expect(teamAdvice(4)).toMatchObject({ mode: 'relevos', fronts: 2 })
    expect(teamAdvice(5, true).fronts).toBe(1)
  })

  it('each advice is a mode the switches can be set to', () => {
    for (const n of [1, 2, 4]) expect(modeOf(settingsFor(teamAdvice(n).mode))).toBe(teamAdvice(n).mode)
  })
})
