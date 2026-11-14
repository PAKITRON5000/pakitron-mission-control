// Three ways of working instead of five switches.
import { describe, it, expect } from 'vitest'
import { chainTurnsOnRelay, fitTeam, modeOf, settingsFor, teamAdvice, turnsOnRelay, WORK_MODES } from '../src/core/workmode'

describe('how the Claude accounts work', () => {
  it('each mode reads back as itself', () => {
    for (const m of WORK_MODES) expect(modeOf(settingsFor(m.id))).toBe(m.id)
  })
  it('the switches the user had on 12-11 (autonomous, each in its project, heavy turns) are «cada uno sigue con lo suyo»', () => {
    expect(modeOf({ autonomous: true, autoRelay: false, relayMode: 'proyecto', heavyTurns: true })).toBe('cada-uno')
  })
  it('nothing on is manual; an odd mix is shown as none of the three', () => {
    expect(modeOf({})).toBe('manual')
    expect(modeOf({ autonomous: false, autoRelay: true, relayMode: 'conjunto' })).toBeUndefined()
  })
  it('no mode opens windows by distributing on its own: that stays an extra', () => {
    for (const m of WORK_MODES) expect(settingsFor(m.id).autoPlan).toBe(false)
  })
  it('EV128: chosen by the app, it follows the team; chosen by the user, it is never touched', () => {
    // A newcomer with one account: it takes up its own work when its usage is back, nothing to change.
    // (With Anthropic's rules already read, EV140: without them, see the next test.)
    const one = { ...settingsFor('cada-uno'), maxFronts: 1, workModeBy: 'app' as const, relayRulesAt: 1 }
    expect(fitTeam(one, 1)).toBeUndefined()
    expect(fitTeam(one, 0)).toBeUndefined()
    // A second account signed in: they relay, without the user doing anything.
    const two = fitTeam(one, 2)!
    expect(modeOf(two.patch)).toBe('relevos')
    expect(two.patch.maxFronts).toBe(1)
    // Four: relays and two fronts.
    expect(fitTeam({ ...two.patch, workModeBy: 'app', relayRulesAt: 1 }, 4)?.patch.maxFronts).toBe(2)
    // Back to one (the other marked «No usar»): each on its own again.
    expect(modeOf(fitTeam({ ...two.patch, workModeBy: 'app', relayRulesAt: 1 }, 1)!.patch)).toBe('cada-uno')
    // The user's own choice, even «manual», and the settings from before 0.32.1 (unset) stay as they are.
    expect(fitTeam({ ...settingsFor('manual'), workModeBy: 'usuario' }, 3)).toBeUndefined()
    expect(fitTeam(settingsFor('manual'), 3)).toBeUndefined()
  })

  it('EV140: until Anthropic\'s rules are read, several accounts each go on with their own work; nothing turns the relay on', () => {
    const fresh = { ...settingsFor('cada-uno'), maxFronts: 1, workModeBy: 'app' as const }
    expect(fitTeam(fresh, 3)).toBeUndefined()
    expect(teamAdvice(3, false, false)).toMatchObject({ mode: 'cada-uno', fronts: 1 })
    expect(teamAdvice(3, false, false).why).toContain('normas de Anthropic')
    expect(modeOf(fitTeam({ ...fresh, relayRulesAt: 5 }, 3)!.patch)).toBe('relevos')
    // What turns it on: the relay or the automatic sharing out, and a wheel that gets two or more accounts.
    expect(turnsOnRelay(settingsFor('relevos'), settingsFor('cada-uno'))).toBe(true)
    expect(turnsOnRelay({ autoPlan: true }, {})).toBe(true)
    expect(turnsOnRelay({ autoRelay: true }, { autoRelay: true })).toBe(false)
    expect(turnsOnRelay(settingsFor('manual'), {})).toBe(false)
    expect(chainTurnsOnRelay({ on: true }, { on: false, order: ['claude1', 'claude2'] })).toBe(true)
    expect(chainTurnsOnRelay({ on: true }, { on: false, order: ['claude1'] })).toBe(false)
    expect(chainTurnsOnRelay({ order: ['claude1', 'claude2'] }, { on: true, order: ['claude1'] })).toBe(true)
    expect(chainTurnsOnRelay({ order: ['claude2', 'claude1'] }, { on: true, order: ['claude1', 'claude2'] })).toBe(false)
    expect(chainTurnsOnRelay({ on: false }, { on: true, order: ['claude1', 'claude2'] })).toBe(false)
  })
})
