// EV120 end to end on the data files: what the probe writes, and what the app then believes about the account.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseProbe } from '../src/core/probe'
import { writeReading } from '../src/main/probe'
import { buildUsage } from '../src/core/accounts'
import type { LimitHit } from '../src/core/types'

let dir = ''
const before = process.env.PMC_DATA_DIR
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pmc-probe-')); process.env.PMC_DATA_DIR = join(dir, 'data'); mkdirSync(join(dir, 'data', 'usage'), { recursive: true }) })
afterAll(() => { if (before === undefined) delete process.env.PMC_DATA_DIR; else process.env.PMC_DATA_DIR = before; rmSync(dir, { recursive: true, force: true }) })

const line = (status: string, type: string, fiveU: number, fiveR: number, weekU: number, weekR: number) =>
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status, rateLimitType: type, resetsAt: type === 'five_hour' ? fiveR : weekR, unifiedWindows: { five_hour: { utilization: fiveU, resetsAt: fiveR, status }, seven_day: { utilization: weekU, resetsAt: weekR, status: 'allowed' } } } })

describe('probe readings on the account', () => {
  const now = new Date(2026, 10, 13, 14, 0).getTime()
  const wed = new Date(2026, 10, 18, 13, 0).getTime()
  const weekOut: LimitHit = { kind: 'semanal', at: now - 4 * 3600_000, resetsAt: wed, source: 'transcript' }

  it('a recharged account (allowed) is free again once marked recharged', () => {
    const r = parseProbe(line('allowed', 'five_hour', 0.09, (now + 3 * 3600_000) / 1000, 0.01, wed / 1000))!
    // Without the reading, the week the app knew holds; with it (and with the «recharged» mark too), it is free.
    expect(buildUsage('claude7' as never, [weekOut], undefined, now + 1000).activeLimit?.resetsAt).toBe(wed)
    writeReading('claude7' as never, r, now)
    expect(buildUsage('claude7' as never, [weekOut], undefined, now + 1000).activeLimit).toBeUndefined()
    expect(buildUsage('claude7' as never, [weekOut], undefined, now + 1000, now).activeLimit).toBeUndefined()
  })

  it('an account back sooner than believed shows the real return', () => {
    const five = new Date(2026, 10, 13, 17, 30).getTime()
    const r = parseProbe(line('rejected', 'five_hour', 1, five / 1000, 0.97, wed / 1000))!
    expect(buildUsage('claude8' as never, [weekOut], undefined, now + 1000).activeLimit?.resetsAt).toBe(wed)
    writeReading('claude8' as never, r, now)
    // With the reading, 17:30 (its 5-hour window at 100 %), with or without the mark set just before the reading.
    expect(buildUsage('claude8' as never, [weekOut], undefined, now + 1000).activeLimit?.resetsAt).toBe(five)
    expect(buildUsage('claude8' as never, [weekOut], undefined, now + 1000, now - 1).activeLimit?.resetsAt).toBe(five)
  })
})
