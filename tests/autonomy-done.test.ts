// EV126: a project given up as finished (pmc terminado) stops autonomous mode there, or sends the session elsewhere.
import { describe, it, expect } from 'vitest'
import { keepGoing, stillDone } from '../src/core/autonomy'

const other = [{ project: 'Otro', root: 'C:/otro', next: ['X1 algo'] }]

describe('a project given up as finished (EV126)', () => {
  it('holds until new work comes after it', () => {
    const mark = { at: 1000, by: 'claude1', why: 'nada más' }
    expect(stillDone(mark, undefined)).toBe(true)
    expect(stillDone(mark, 900)).toBe(true)
    expect(stillDone(mark, 1001)).toBe(false)
    expect(stillDone(undefined, 900)).toBe(false)
  })

  it('with nothing queued: lets the session rest, or sends it to another project when the user chose that', () => {
    const base = { autonomous: true, next: [] as string[], blocks: [], project: 'Juego', elsewhere: other, done: true }
    expect(keepGoing({ ...base, whenDone: 'parar' })).toBeUndefined()
    expect(keepGoing({ ...base })).toBeUndefined()
    expect(keepGoing({ ...base, whenDone: 'otro' })).toContain('Pasa a Otro')
    expect(keepGoing({ ...base, whenDone: 'otro', elsewhere: [] })).toBeUndefined()
  })

  it('not done: asks to think of improvements, and says how to give it up', () => {
    const r = keepGoing({ autonomous: true, next: [], blocks: [], project: 'Juego', elsewhere: other })
    expect(r).toContain('piensa qué se puede mejorar')
    expect(r).toContain('pmc terminado')
  })

  it('work still queued keeps it going, done or not', () => {
    expect(keepGoing({ autonomous: true, next: ['T1 tarea'], blocks: [], project: 'Juego', done: true, whenDone: 'parar' })).toContain('T1 tarea')
  })
})
