// Automatic hand-off: who goes on when an account stops for its limit, and when nobody should.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickSuccessor, relayPrompt, shouldRelay, RELAY_COOLDOWN_MS } from '../src/core/relay'
import { teamContext } from '../src/core/coord'

const idle = (id: string, weekFree?: number, state = 'disponible') => ({ id, state, sessions: [], weekFree }) as any
const working = (id: string, projectId: string) => ({ id, state: 'trabajando', sessions: [{ projectId, status: 'busy', kind: 'interactive' }], weekFree: 50 }) as any
const base = { from: 'claude3' as const, projectId: 'mc', order: [] as string[], status: {}, wantsFable: true, noFable: [] as string[] }

describe('automatic hand-off', () => {
  // The user's accounts on 12-11: claude1 and claude5 with Fable, claude6 out of Fable, claude4 his brother's, claude2 unpaid.
  const team = [idle('claude1', 78), idle('claude2', 0, 'sin-uso'), idle('claude3', 0, 'sin-uso'), idle('claude4', 60), idle('claude5', 68), idle('claude6', 90)]
  const real = { ...base, agents: team, status: { claude4: 'pausada' as const, claude2: 'baja' as const }, noFable: ['claude6'], order: ['claude1', 'claude3', 'claude4', 'claude2'] }

  it('a Fable job goes to the next account in the turn that still has Fable; never to one set aside or unpaid', () => {
    const c = pickSuccessor(real)
    expect(c.to).toBe('claude1')
    expect(c.to && c.fable).toBe(true)
    // claude1 out too: claude5 has Fable, though claude6 has more week.
    const c2 = pickSuccessor({ ...real, agents: team.map((a) => (a.id === 'claude1' ? idle('claude1', 0, 'sin-uso') : a)) })
    expect(c2.to).toBe('claude5')
    // Nobody with Fable left: the one that can still work goes on with its own model, and is told so.
    const c3 = pickSuccessor({ ...real, noFable: ['claude6', 'claude1', 'claude5'] })
    expect(c3.to).toBe('claude1')
    expect(c3.to && c3.fable).toBe(false)
    expect(relayPrompt('claude3', 'Mission Control', false, true)).toContain('tú no lo tienes')
  })

  it('opens nobody when another account already works on the project, or nobody can', () => {
    expect(pickSuccessor({ ...real, agents: [...team.slice(1), working('claude1', 'mc')] }).to).toBeUndefined()
    expect(pickSuccessor({ ...real, agents: [...team.slice(1), working('claude1', 'otro')] }).to).toBe('claude1')
    const none = pickSuccessor({ ...base, agents: [idle('claude3'), idle('claude4', 60), idle('claude2', 3)], status: { claude4: 'pausada' } })
    expect(none.to).toBeUndefined()
    expect(none.why).toContain('claude4 apartada')
    expect(none.why).toContain('claude2 con el 3 %')
    // An account with its week free but its 5 hours nearly gone would stop at once: it is not chosen.
    const spent = pickSuccessor({ ...real, agents: team.map((a) => (a.id === 'claude1' ? { ...idle('claude1', 78), fiveFree: 1 } : a)) })
    expect(spent.to).toBe('claude5')
  })

  it('only a fresh usage limit triggers it, and once per account and project in half an hour', () => {
    const now = 10_000_000
    expect(shouldRelay({ at: now - 1000, error: 'rate_limit' }, undefined, now)).toBe(true)
    expect(shouldRelay({ at: now - 1000, error: 'overloaded' }, undefined, now)).toBe(false)
    expect(shouldRelay({ at: now - 3600_000, error: 'rate_limit' }, undefined, now)).toBe(false) // the spool read after the app was closed
    expect(shouldRelay({ at: now - 1000, error: 'rate_limit' }, now - 60_000, now)).toBe(false)
    expect(shouldRelay({ at: now - 1000, error: 'rate_limit' }, now - RELAY_COOLDOWN_MS - 1, now)).toBe(true)
    // An account that ends its turn on its own with the usage nearly gone (claude3 at 99 %, 12-11) is a stop too.
    expect(shouldRelay({ at: now - 1000, event: 'Stop', usedPct: 99 }, undefined, now)).toBe(true)
    expect(shouldRelay({ at: now - 1000, event: 'Stop', usedPct: 60 }, undefined, now)).toBe(false)
    expect(shouldRelay({ at: now - 1000, event: 'Stop' }, undefined, now)).toBe(false)
  })

  it('every session is told which accounts are not to be counted on', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-team-')), 'team.json')
    const now = Date.now()
    writeFileSync(file, JSON.stringify({ at: now, team: [{ id: 'claude3', state: 'trabajando' }, { id: 'claude4', state: 'disponible', weekFree: 60, status: 'pausada' }, { id: 'claude2', state: 'sin-uso', status: 'baja' }] }))
    const t = teamContext('claude3', now, file)
    expect(t).toContain('claude4 apartada por el usuario')
    expect(t).toContain('claude2 de baja')
  })

  it('una cuenta apartada que trabaja aparte (la de reserva) no se dice «no se usa» (13-11)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-team-')), 'team.json')
    const now = Date.now()
    writeFileSync(file, JSON.stringify({ at: now, team: [{ id: 'claude6', state: 'trabajando' }, { id: 'claude5', state: 'trabajando', status: 'pausada', projectId: 'video' }] }))
    const t = teamContext('claude6', now, file)
    expect(t).toContain('claude5 trabajando aparte en video')
    expect(t).not.toContain('claude5 apartada')
  })

  it('the turn order only holds an account back when they take turns, and only behind a free account (12-11 11:30)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-team-')), 'team.json')
    const now = Date.now()
    const team = [
      { id: 'claude5', state: 'disponible', weekFree: 49 },
      { id: 'claude1', state: 'sin-uso', backAt: now - 4 * 3600_000 },
      { id: 'claude3', state: 'trabajando', weekFree: 85 }
    ]
    const order = ['claude5', 'claude1', 'claude3']
    writeFileSync(file, JSON.stringify({ at: now, team, order, mode: 'cada-uno' }))
    let t = teamContext('claude3', now, file)
    expect(t).not.toContain('Turno')
    expect(t).not.toContain('Van antes')
    // A limit that already ended is not «sin uso».
    expect(t).toContain('claude1 libre (su límite acabó')
    writeFileSync(file, JSON.stringify({ at: now, team, order, mode: 'relevos' }))
    t = teamContext('claude3', now, file)
    expect(t).toContain('Van antes que tú y están libres: claude5.')
    writeFileSync(file, JSON.stringify({ at: now, team: [{ ...team[0], state: 'sin-uso', weekFree: 0 }, team[1], team[2]], order, mode: 'relevos' }))
    expect(teamContext('claude3', now, file)).not.toContain('Van antes')
    // EV38: each session gets the order of its own project, not the one on screen in the app.
    writeFileSync(file, JSON.stringify({ at: now, team, order, orders: { video: ['claude3', 'claude5'] }, mode: 'relevos' }))
    expect(teamContext('claude3', now, file, 'video')).not.toContain('Van antes')
    expect(teamContext('claude3', now, file, 'otro')).toContain('Van antes que tú y están libres: claude5.')
  })
})
