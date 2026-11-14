// EV115: what the app runs by itself is timed like the window's calls, and a failing job never escapes its timer.
import { describe, it, expect } from 'vitest'
import { timed } from '../src/main/service'

describe('timed jobs', () => {
  it('logs only the slow ones, and the errors, sync or async', async () => {
    const lines: string[] = []
    const log = (s: string) => lines.push(s)
    timed(log, 'rapida', () => 1)
    timed(log, 'lenta', () => { const t = performance.now(); while (performance.now() - t < 90) { /* busy */ } })
    timed(log, 'rota', () => { throw new Error('fallo') })
    timed(log, 'promesa', () => Promise.reject(new Error('asincrona')))
    await new Promise((r) => setTimeout(r, 10))
    expect(lines.some((l) => /^lento: lenta \d+ ms \(sola\)$/.test(l))).toBe(true)
    expect(lines.some((l) => l.includes('rapida'))).toBe(false)
    expect(lines).toContain('rota: fallo')
    expect(lines).toContain('promesa: asincrona')
  })
})
