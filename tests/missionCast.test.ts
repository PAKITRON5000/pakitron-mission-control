import { describe, expect, it } from 'vitest'
import { mapCast } from '../src/renderer/src/components/missionCast'
import type { AgentCard, LiveSession } from '../src/core/types'

const session = (id: string, projectId: string, status: string): LiveSession => ({ sessionId: id, shortId: id, cwd: 'C:\\x', kind: 'interactive', status, projectId })
const agent = (state: AgentCard['state'], sessions: LiveSession[]): AgentCard => ({
  id: 'claude3', alias: 'epic', color: '#a855f7', configDir: '', identity: {} as AgentCard['identity'], state, stateReason: '', sessions,
  usage: { history: [] }
} as unknown as AgentCard)

describe('the map, a Claude in two projects at once (the user, 15-11)', () => {
  it('shows it in each project where it works, each place saying where else it is', () => {
    const cast = mapCast([agent('trabajando', [session('a', 'pmc', 'busy'), session('b', 'px', 'busy')])], {}, Date.now())
    expect(cast.map((m) => [m.projectId, m.sessionId, m.alsoIn])).toEqual([['pmc', 'a', ['px']], ['px', 'b', ['pmc']]])
    expect(cast.every((m) => m.where === 'proyecto' && m.mood === 'trabaja')).toBe(true)
  })

  it('one waiting for the user goes first, and two windows in the same project count once', () => {
    const cast = mapCast([agent('esperando', [session('a', 'pmc', 'busy'), session('c', 'pmc', 'busy'), session('b', 'px', 'waiting')])], {}, Date.now())
    expect(cast.map((m) => [m.projectId, m.mood])).toEqual([['px', 'llama'], ['pmc', 'trabaja']])
  })

  it('in one project it is as before: one place, nothing else said', () => {
    const cast = mapCast([agent('trabajando', [session('a', 'pmc', 'busy'), session('d', 'pmc', 'idle')])], {}, Date.now())
    expect(cast).toHaveLength(1)
    expect(cast[0].alsoIn).toBeUndefined()
  })

  it('with nothing open in a project it waits at the base', () => {
    const cast = mapCast([agent('disponible', [session('a', 'pmc', 'idle')])], {}, Date.now())
    expect(cast.map((m) => m.where)).toEqual(['base'])
  })
})
