import { describe, expect, it } from 'vitest'
import { placeRequest } from '../src/core/requests'

describe('which project a request of the user belongs to', () => {
  it('where the account then wrote, when the window was elsewhere (12-11: a Mission Control request in a Juego de prueba window)', () => {
    expect(placeRequest({ byFolder: 'fp', byWork: 'mc', byWords: 'mc', outside: false })).toBe('mc')
  })
  it('the window\'s project, when the account was writing in another one at once and the words do not say so (13-11)', () => {
    expect(placeRequest({ byFolder: 'lab', byWork: 'mc', byWords: undefined, outside: false })).toBe('lab')
    expect(placeRequest({ byFolder: 'lab', byWork: 'mc', byWords: 'lab', outside: false })).toBe('lab')
  })
  it('a window in a folder that is no project counts only where it wrote', () => {
    expect(placeRequest({ byWork: undefined, byWords: 'mc', outside: true })).toBeUndefined()
    expect(placeRequest({ byWork: 'iv', byWords: 'mc', outside: true })).toBe('iv')
  })
  it('with no writes: the words, then the folder', () => {
    expect(placeRequest({ byFolder: 'lab', byWords: 'mc', outside: false })).toBe('mc')
    expect(placeRequest({ byFolder: 'lab', outside: false })).toBe('lab')
  })
})
