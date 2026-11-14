import { describe, expect, it } from 'vitest'
import { classify, asideFate, sizeText, type CleanupFacts } from '../src/core/cleanup'

const NOW = new Date(2026, 10, 13, 8, 0).getTime()
const DAY = 86400_000
const facts = (x: Partial<CleanupFacts> = {}): CleanupFacts => ({ now: NOW, noted: new Set(), named: new Set(), ...x })

describe('a clean project (EV100)', () => {
  it('caches of copies at rest can go; the one in use and what the user noted stay', () => {
    expect(classify({ rel: 'Library', kind: 'dir', size: 9e9, mtime: NOW, copy: { main: false, active: false } }, facts()).pile).toBe('sobra')
    expect(classify({ rel: 'Library', kind: 'dir', size: 9e9, mtime: NOW, copy: { main: true, active: true } }, facts()).pile).toBe('queda')
    expect(classify({ rel: 'tools/node_modules', kind: 'dir', size: 4e8, mtime: NOW, copy: { main: false, active: false } }, facts()).why).toContain('npm install')
    expect(classify({ rel: 'node_modules', kind: 'dir', size: 2e9, mtime: NOW, copy: { main: true, active: false } }, facts()).pile).toBe('queda')
    expect(classify({ rel: 'Temp', kind: 'dir', size: 2e8, mtime: NOW, copy: { main: true, active: false } }, facts()).pile).toBe('sobra')
    expect(classify({ rel: 'Builds', kind: 'dir', size: 2e9, mtime: NOW - 10 * DAY }, facts()).pile).toBe('sobra')
    expect(classify({ rel: 'Builds', kind: 'dir', size: 2e9, mtime: NOW - DAY }, facts()).pile).toBe('queda')
  })
  it('a heavy old video nobody names is doubtful; named, noted or in git it stays', () => {
    const v = { rel: 'Videos/prueba_vieja.mp4', kind: 'file' as const, size: 300 * 1048576, mtime: NOW - 40 * DAY }
    expect(classify(v, facts()).pile).toBe('dudoso')
    expect(classify(v, facts({ named: new Set(['prueba_vieja.mp4']) })).pile).toBe('queda')
    expect(classify(v, facts({ noted: new Set(['C:/X/Videos/prueba_vieja.mp4']) })).pile).toBe('queda')
    expect(classify(v, facts({ tracked: () => true })).pile).toBe('queda')
    expect(classify({ ...v, mtime: NOW - 3 * DAY }, facts()).pile).toBe('queda')
  })
  it('the Claudes notes: kept stays, disposable is only doubtful', () => {
    const marks = new Map([['c:/p/a.png', { kind: 'conservar' as const, why: 'la usa el vídeo final', by: 'claude6' }], ['c:/p/b.png', { kind: 'desechable' as const, why: 'prueba', by: 'claude1' }]])
    expect(classify({ rel: 'a.png', path: 'C:\\p\\a.png', kind: 'file', size: 9e8, mtime: NOW - 90 * DAY }, facts({ marks }))).toEqual({ pile: 'queda', why: 'Claude 6 dijo que se conserva: la usa el vídeo final' })
    expect(classify({ rel: 'b.png', path: 'C:/p/b.png', kind: 'file', size: 10, mtime: NOW }, facts({ marks })).pile).toBe('dudoso')
  })
  it('what is set aside comes back when named, goes after weeks or once its tasks are closed', () => {
    expect(asideFate({ at: NOW - DAY, name: 'a.mp4' }, { now: NOW, named: new Set(['a.mp4']) })).toBe('volver')
    expect(asideFate({ at: NOW - 2 * DAY, name: 'a.mp4' }, { now: NOW, named: new Set() })).toBe('esperar')
    expect(asideFate({ at: NOW - 30 * DAY, name: 'a.mp4' }, { now: NOW, named: new Set() })).toBe('borrar')
    expect(asideFate({ at: NOW - 8 * DAY, name: 'a.mp4' }, { now: NOW, named: new Set(), tasksOpen: false })).toBe('borrar')
    expect(sizeText(3.2 * (1 << 30))).toBe('3,2 GB')
  })
})
