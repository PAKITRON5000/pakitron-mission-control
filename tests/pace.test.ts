// Telling an account to close its block before its usage runs out.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-pace-'))
  process.env.PMC_DATA_DIR = dir
  mkdirSync(join(dir, 'usage'), { recursive: true })
})

describe('pace of usage', async () => {
  const { paceWarning, minutesLeft, takePaceWarning } = await import('../src/core/pace')
  const now = new Date(2026, 10, 12, 2, 0).getTime()
  const resets = new Date(2026, 10, 12, 6, 0).getTime()
  const week = new Date(2026, 10, 14, 19, 0).getTime()
  const snap = (five: number, sevenDay = 10, capturedAt = now) => ({ account: 'claude3' as const, capturedAt, source: 'statusline' as const, fiveHour: { usedPct: five, resetsAt: resets }, sevenDay: { usedPct: sevenDay, resetsAt: week } }) as any
  const history = [{ at: now - 60 * 60_000, five: 26, fiveResets: resets }, { at: now - 30 * 60_000, five: 56, fiveResets: resets }, { at: now, five: 86, fiveResets: resets }]

  it('estimates the time left from the readings of this window only', () => {
    expect(minutesLeft(history, snap(86), now)).toBe(14) // 60 points in 60 minutes, 14 to go
    expect(minutesLeft([history[2]], snap(86), now)).toBeUndefined()
    expect(minutesLeft(history.map((h) => ({ ...h, fiveResets: 1 })), snap(86), now)).toBeUndefined()
  })

  it('says nothing below 85 %, warns once at 85 % and once more, harder, at 95 %', () => {
    expect(paceWarning({ snapshot: snap(70), history, warned: {}, now })).toBeUndefined()
    const w = paceWarning({ snapshot: snap(86), history, warned: {}, autoRelay: true, now })!
    expect(w.text).toContain('el 86 % de tus 5 horas')
    expect(w.text).toContain('unos 14 min, es una estimación')
    expect(w.text).toContain('abrirá otra cuenta')
    expect(paceWarning({ snapshot: snap(90), history, warned: { [w.key]: now }, now })).toBeUndefined()
    const last = paceWarning({ snapshot: snap(96), history, warned: { [w.key]: now }, now })!
    expect(last.text).toContain('No empieces nada nuevo')
    expect(last.key).not.toBe(w.key)
    // With the automatic hand-off on, it is told to save and go on until the limit cuts it, never to stop (the user, 12-11).
    const on = paceWarning({ snapshot: snap(96), history, warned: {}, autoRelay: true, now })!
    expect(on.text).toContain('NO TE PARES')
    expect(on.text).not.toContain('No empieces nada nuevo')
  })

  it('the week counts too, and an old reading says nothing', () => {
    expect(paceWarning({ snapshot: snap(20, 91), history: [], warned: {}, now })!.text).toContain('el 91 % de tu semana')
    expect(paceWarning({ snapshot: snap(96, 10, now - 40 * 60_000), history, warned: {}, now })).toBeUndefined()
  })

  it('from the hook: read from disk and said only once', () => {
    writeFileSync(join(dir, 'usage', 'claude3.json'), JSON.stringify(snap(88)))
    expect(takePaceWarning('claude3', false, now)).toContain('cuando el usuario la abra')
    expect(takePaceWarning('claude3', false, now + 60_000)).toBeUndefined()
  })
})

describe('spending without getting anywhere', async () => {
  const { isStalled } = await import('../src/core/pace')
  const now = 100_000_000
  const r = (minAgo: number, five: number, fiveResets = 1) => ({ at: now - minAgo * 60_000, five, fiveResets })
  it('ten points in half an hour with nothing written, reserved or delivered', () => {
    const history = [r(28, 40), r(15, 47), r(1, 55)]
    expect(isStalled(history, [now - 60 * 60_000], now)).toEqual({ points: 15, minutes: 27 })
    expect(isStalled(history, [now - 10 * 60_000], now)).toBeUndefined() // it wrote a file ten minutes ago
    expect(isStalled([r(28, 40), r(1, 46)], [], now)).toBeUndefined() // slow spending is not being stuck
    expect(isStalled([r(8, 40), r(1, 55)], [], now)).toBeUndefined() // too short to tell
    expect(isStalled([r(28, 90, 1), r(1, 5, 2)], [], now)).toBeUndefined() // another window
  })
})
