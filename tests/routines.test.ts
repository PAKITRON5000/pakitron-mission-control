// Routines (EV44): checks the app runs by itself, after commits and at night, without a Claude.
import { describe, it, expect } from 'vitest'
import { dueRoutines, remember, routineDefaults, type RoutineMemory, type RoutineProject } from '../src/core/routines'

const mem = (): RoutineMemory => ({ heads: {}, nights: {}, nightTry: {} })
const mc: RoutineProject = { id: 'mc', copies: [{ path: 'C:\\mc', head: 'a1', dirty: 0 }], light: 2, all: 2, heavy: false, working: false }
const fp: RoutineProject = { id: 'fp', copies: [{ path: 'C:\\fp', head: 'f1', dirty: 0 }], light: 0, all: 2, heavy: true, working: false }

describe('routines', () => {
  it('defaults: after each commit when there is a light check; at night only when nothing is heavy', () => {
    expect(routineDefaults(mc)).toEqual({ trasCommit: true, noche: true, hora: '03:30' })
    expect(routineDefaults(fp)).toEqual({ trasCommit: false, noche: false, hora: '03:30' })
  })

  it('a commit seen for the first time is only remembered; a new one runs the light checks once', () => {
    const m = mem()
    const day = new Date(2026, 10, 12, 14, 0).getTime()
    expect(dueRoutines([mc], {}, m, day)).toEqual([])
    const next = { ...mc, copies: [{ path: 'C:\\mc', head: 'a2', dirty: 0 }] }
    const due = dueRoutines([next], {}, m, day)
    expect(due).toEqual([{ projectId: 'mc', copy: 'C:\\mc', kind: 'tras-commit', head: 'a2' }])
    remember(m, due[0], 'bien', day)
    expect(dueRoutines([next], {}, m, day)).toEqual([])
  })

  it('waits while someone works on a copy with half-made changes; runs when it is clean or they stop', () => {
    const m = mem(); const day = new Date(2026, 10, 12, 14, 0).getTime()
    dueRoutines([mc], {}, m, day)
    const busy = { ...mc, working: true, copies: [{ path: 'C:\\mc', head: 'a2', dirty: 3 }] }
    expect(dueRoutines([busy], {}, m, day)).toEqual([])
    expect(dueRoutines([{ ...busy, copies: [{ path: 'C:\\mc', head: 'a2', dirty: 0 }] }], {}, m, day)).toHaveLength(1)
    expect(dueRoutines([{ ...busy, working: false }], {}, m, day)).toHaveLength(1)
  })

  it('at night, once, when nobody works there; put off means trying again in half an hour', () => {
    const m = mem()
    const night = new Date(2026, 10, 13, 3, 40).getTime()
    const on = { fp: { noche: true } }
    expect(dueRoutines([fp], on, m, new Date(2026, 10, 13, 2, 0).getTime())).toEqual([])
    expect(dueRoutines([{ ...fp, working: true }], on, m, night)).toEqual([])
    const due = dueRoutines([fp], on, m, night)
    expect(due).toEqual([{ projectId: 'fp', copy: 'C:\\fp', kind: 'noche', night: '2026-11-13' }])
    remember(m, due[0], 'aplazada', night)
    expect(dueRoutines([fp], on, m, night + 10 * 60_000)).toEqual([])
    expect(dueRoutines([fp], on, m, night + 31 * 60_000)).toHaveLength(1)
    remember(m, due[0], 'bien', night + 31 * 60_000)
    expect(dueRoutines([fp], on, m, night + 90 * 60_000)).toEqual([])
    // Not after the night is over, and the user's choice wins over the defaults.
    expect(dueRoutines([fp], on, mem(), new Date(2026, 10, 13, 9, 0).getTime())).toEqual([])
    expect(dueRoutines([mc], { mc: { noche: false, trasCommit: false } }, mem(), night)).toEqual([])
  })

  it('an evening hour (22:00) lasts until 08:00 and a run after midnight counts for the night that began the day before', () => {
    const on = { fp: { noche: true, hora: '22:00' } }
    const m = mem()
    expect(dueRoutines([fp], on, m, new Date(2026, 10, 12, 21, 30).getTime())).toEqual([])
    // Someone worked until midnight: at 01:00 it still runs, for the night of the 12th.
    const late = new Date(2026, 10, 13, 1, 0).getTime()
    const due = dueRoutines([fp], on, m, late)
    expect(due).toEqual([{ projectId: 'fp', copy: 'C:\\fp', kind: 'noche', night: '2026-11-12' }])
    remember(m, due[0], 'bien', late)
    expect(dueRoutines([fp], on, m, new Date(2026, 10, 13, 3, 0).getTime())).toEqual([])
    // That evening it runs again: it is another night.
    expect(dueRoutines([fp], on, m, new Date(2026, 10, 13, 22, 10).getTime())).toHaveLength(1)
    expect(dueRoutines([fp], on, mem(), new Date(2026, 10, 13, 9, 0).getTime())).toEqual([])
  })
})
