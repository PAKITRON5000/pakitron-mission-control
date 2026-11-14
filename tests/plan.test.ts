// How many accounts are worth running at once, and on what.
import { describe, it, expect } from 'vitest'
import { planFronts, staffGap, STAFF_COOLDOWN_MS } from '../src/core/plan'

const t = (extId: string, section: string, title: string) => ({ key: extId, extId, title, section, priority: 2, status: 'pendiente' })
const acc = (id: string, hasFable = false) => ({ id: id as any, hasFable, weekFree: 80 })

describe('fronts at once', () => {
  const tasks = [t('MP1', 'Mapas', 'La Caldera {unity} [opus]'), t('MP2', 'Mapas', 'El Fiordo {unity}'), t('AR1', 'Arte', 'Árboles en Blender {gpu} [sonnet]'), t('NET1', 'Red', 'Servidor dedicado [fable]'), t('G4', 'Dirigible', 'Probar en partida {unity}')]
  const base = { tasks, accounts: [acc('claude1', true), acc('claude5', true), acc('claude6')], freeCopies: ['rachas', 'cabeza', 'manos'], busy: [] as string[], max: 3 }

  it('one front per system and per single-use resource; Fable only where the task asks for it', () => {
    const p = planFronts(base)
    expect(p.fronts.map((f) => `${f.task}:${f.account}`)).toEqual(['MP1:claude6', 'AR1:claude1', 'NET1:claude5'])
    expect(p.queue).toEqual([])
    expect(p.why).toContain('caben 3 frentes')
  })

  it('with the resource busy, one copy or a cap of one, the rest wait their turn', () => {
    expect(planFronts({ ...base, busy: ['unity', 'gpu'] }).fronts.map((f) => f.task)).toEqual(['NET1'])
    const one = planFronts({ ...base, freeCopies: ['rachas'] })
    expect(one.fronts.length).toBe(1)
    expect(one.queue).toEqual(['claude1', 'claude5'])
    expect(one.why).toContain('solo cabe un frente')
    expect(planFronts({ ...base, max: 1 }).fronts.length).toBe(1)
    expect(planFronts({ ...base, accounts: [] }).why).toBe('ninguna cuenta tiene uso ahora')
  })
})

describe('keeping a project staffed', () => {
  const now = 90_000_000_000
  const base = { working: 0, claims: 0, lastActivityAt: now - 3600_000, scheduledSoon: false, playing: false, max: 1, now }
  it('opens one account when tasks are left and nobody is on a project worked on today', () => {
    expect(staffGap(base).open).toBe(1)
    expect(staffGap({ ...base, max: 3, working: 1 }).open).toBe(2)
  })
  it('opens nobody when someone is there, it was just staffed, the project is idle or the user plays', () => {
    expect(staffGap({ ...base, working: 1 }).open).toBe(0)
    expect(staffGap({ ...base, claims: 2 }).open).toBe(0) // a window in another folder holding tasks here
    expect(staffGap({ ...base, lastLaunchAt: now - STAFF_COOLDOWN_MS + 1000 }).open).toBe(0)
    expect(staffGap({ ...base, lastActivityAt: now - 3 * 86400_000 }).open).toBe(0)
    expect(staffGap({ ...base, lastActivityAt: undefined }).open).toBe(0)
    expect(staffGap({ ...base, scheduledSoon: true }).open).toBe(0)
    expect(staffGap({ ...base, launches: 4 }).why).toContain('algo las para')
    expect(staffGap({ ...base, playing: true }).why).toContain('jugando')
  })
})
