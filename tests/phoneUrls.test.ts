import { describe, it, expect } from 'vitest'
import { phoneUrls } from '../src/renderer/src/lib/phoneUrls'

describe('phoneUrls (MC4: pictures on the phone)', () => {
  it('turns every pmc:// address into its /media/ one, at any depth', () => {
    const cards = { 7: { thumb: 'pmc://thumb/12?s=320', audio: false }, 9: { thumb: 'pmc://card/juego/BZ68/0' } }
    expect(phoneUrls(cards)).toEqual({ 7: { thumb: '/media/thumb/12?s=320', audio: false }, 9: { thumb: '/media/card/juego/BZ68/0' } })
    const look = [{ kind: 'image', src: 'pmc://file/3', thumb: 'pmc://thumb/3?s=420', caption: 'pmc fuera' }]
    expect(phoneUrls(look)).toEqual([{ kind: 'image', src: '/media/file/3', thumb: '/media/thumb/3?s=420', caption: 'pmc fuera' }])
  })

  it('leaves everything else as it was', () => {
    expect(phoneUrls('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(phoneUrls(null)).toBe(null)
    expect(phoneUrls(42)).toBe(42)
    expect(phoneUrls({ n: 1, ok: true, list: ['x', 'pmc://dimg/4/0'] })).toEqual({ n: 1, ok: true, list: ['x', '/media/dimg/4/0'] })
  })
})
