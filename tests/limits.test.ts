// When each account comes back: the reset read from the limit message itself, from the status line at 100 %, and the
// wake hook's files attributed to the account that really ran the session (7-11: claude6's limit showed as claude1's).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { limitFromTranscriptEntry, resetFromText } from '../src/core/parse/limits'
import { buildUsage, readLimits, workedAfter } from '../src/core/accounts'
import type { AccountConfig, LimitHit } from '../src/core/types'

const oldLocal = process.env.LOCALAPPDATA
beforeAll(() => {
  process.env.PMC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pmc-limits-'))
})
afterAll(() => {
  process.env.LOCALAPPDATA = oldLocal
})

describe('limit message in the conversation', () => {
  // As Claude Code 2.1 saves it (c82d68b9, 6-11 at 13:59 local).
  const entry = {
    type: 'assistant',
    timestamp: '2026-11-06T12:59:12.787Z',
    sessionId: 'c82d68b9-b142-4cd0-ad7a-4485a00d2bd7',
    message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your 5-hour limit · resets 5pm (Europe/Madrid)" }] },
    apiError: 'usage_limit_reached',
    quotaLimits: { status: 'rejected', resetsAt: 1793980800, rateLimitType: 'five_hour' },
    error: 'rate_limit'
  }
  it('takes the exact reset and the window the API gave', () => {
    const l = limitFromTranscriptEntry(entry)!
    expect(l.resetsAt).toBe(1793980800_000)
    expect(l.kind).toBe('5 horas')
    expect(l.source).toBe('transcript')
    expect(l.sessionShort).toBe('c82d68b9')
    expect(l.at).toBe(Date.parse('2026-11-06T12:59:12.787Z'))
  })
  it('weekly window', () => {
    expect(limitFromTranscriptEntry({ ...entry, quotaLimits: { resetsAt: 1794214800, rateLimitType: 'seven_day' } })!.kind).toBe('semanal')
  })
  it('falls back to the text when the entry has no reset field', () => {
    const { quotaLimits: _q, ...bare } = entry
    const l = limitFromTranscriptEntry(bare)!
    const d = new Date(l.resetsAt)
    expect([d.getHours(), d.getMinutes()]).toEqual([17, 0])
    expect(l.resetsAt).toBeGreaterThan(l.at)
  })
  it('reads the clock like the wake script', () => {
    const at = new Date(2026, 10, 7, 23, 50).getTime()
    expect(new Date(resetFromText('resets 3:30am (Europe/Madrid)', at)!).getDate()).toBe(8)
    const dated = new Date(resetFromText("You've hit your weekly limit · resets Nov 9, 10am", at)!)
    expect([dated.getMonth(), dated.getDate(), dated.getHours()]).toEqual([10, 9, 10])
    expect(new Date(resetFromText('resets Nov 6 at 7:30am', at)!).getFullYear()).toBe(2027)
    expect(resetFromText('nothing here', at)).toBeUndefined()
  })
})

describe('status line at 100 %', () => {
  const now = new Date(2026, 10, 7, 16, 30).getTime()
  const snap = (five: number, week: number, weekReset: number) => {
    mkdirSync(join(process.env.PMC_DATA_DIR!, 'usage'), { recursive: true })
    writeFileSync(
      join(process.env.PMC_DATA_DIR!, 'usage', 'claude3.json'),
      JSON.stringify({ account: 'claude3', capturedAt: now - 5 * 86400_000, source: 'statusline', fiveHour: { usedPct: five, resetsAt: now - 86400_000 }, sevenDay: { usedPct: week, resetsAt: weekReset } })
    )
  }
  it('gives the return time of a week used up outside Juego de prueba', () => {
    snap(10, 100, now + 2.5 * 3600_000)
    const u = buildUsage('claude3', [], undefined, now)
    expect(u.activeLimit?.kind).toBe('semanal')
    expect(u.activeLimit?.resetsAt).toBe(now + 2.5 * 3600_000)
    expect(u.activeLimit?.source).toBe('statusline')
  })
  it('nothing once that reset has passed, or below 100 %', () => {
    snap(10, 100, now - 60_000)
    expect(buildUsage('claude3', [], undefined, now).activeLimit).toBeUndefined()
    snap(10, 99, now + 3600_000)
    expect(buildUsage('claude3', [], undefined, now).activeLimit).toBeUndefined()
  })
})

describe('wake hook files, by the account that ran the session', () => {
  // The folder of a project's own hook is named in este-pc.json (EV129), with %LOCALAPPDATA% expanded.
  const useWakeDir = (root: string) => {
    process.env.LOCALAPPDATA = root
    mkdirSync(join(root, 'Avisos'))
    writeFileSync(join(process.env.PMC_DATA_DIR!, 'este-pc.json'), JSON.stringify({ carpetasDeLimites: ['%LOCALAPPDATA%/Avisos'] }))
  }
  it('moves a limit filed under the wrong account', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-wake-'))
    useWakeDir(root)
    // The old script took any settings folder it did not know for claude1.
    writeFileSync(join(root, 'Avisos', 'credits_claude1.txt'), '﻿2026-11-07 08:09;2026-11-07 10:30;5 horas;94fe495f\n')
    writeFileSync(
      join(root, 'Avisos', 'wake.log'),
      "2026-11-07 08:09:21 [54352] 94fe495f limit: 'You've hit your 5-hour limit · resets 10:30am (Europe/Madrid)' -> sleeping until 2026-11-07 10:32:00\n"
    )
    const dir = (n: string) => {
      const d = join(root, n)
      mkdirSync(join(d, 'session-env'), { recursive: true })
      return d
    }
    const one = dir('.claude')
    const six = dir('.claude-sexta')
    mkdirSync(join(six, 'session-env', '94fe495f-4810-45bd-ae03-70f957cfc7c4'))
    const accounts: AccountConfig[] = [
      { id: 'claude1', alias: '', configDir: one, color: '' },
      { id: 'claude6', alias: '', configDir: six, color: '' }
    ]
    const by = readLimits(new Map(), accounts)
    expect(by.get('claude1')).toBeUndefined()
    expect(by.get('claude6')?.map((l) => l.source).sort()).toEqual(['credits_txt', 'wake_log'])
  })
  it('keeps the account named in the file when nothing says otherwise', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-wake-'))
    useWakeDir(root)
    writeFileSync(join(root, 'Avisos', 'credits_claude2.txt'), '2026-11-04 00:20;2026-11-09 10:00;semanal;fbe3457c\n')
    const by = readLimits(new Map(), [{ id: 'claude2', alias: '', configDir: join(root, 'nada'), color: '' }])
    expect(by.get('claude2')?.[0].kind).toBe('semanal')
  })
})

describe('a limit that work afterwards proves over, with the windows already closed', () => {
  // claude6, 11-11: week used up at 00:46 (back on Friday 13 at 15:00), week given back at 11:32, five hours used up at
  // 14:06 (back at 16:20). At 19:00 it showed "Límite semanal agotado" until Friday.
  const t = (h: number, m: number) => new Date(2026, 10, 11, h, m).getTime()
  const now = t(19, 0)
  const weekly: LimitHit = { at: t(0, 46), resetsAt: new Date(2026, 10, 13, 15, 0).getTime(), kind: 'semanal', source: 'wake_log' }
  const five: LimitHit = { at: t(14, 6), resetsAt: t(16, 20), kind: '5 horas', source: 'wake_log' }
  const history = (weeks: number[], from = t(11, 32)) => {
    mkdirSync(join(process.env.PMC_DATA_DIR!, 'usage'), { recursive: true })
    writeFileSync(
      join(process.env.PMC_DATA_DIR!, 'usage', 'claude6.history.jsonl'),
      weeks.map((w, i) => JSON.stringify({ at: from + i * 600_000, five: 0, week: w })).join('\n') + '\n'
    )
  }
  it('a later 5-hour limit whose window began after it', () => {
    history([])
    expect(workedAfter(weekly, [five, weekly], [])).toBe(true)
    expect(buildUsage('claude6', [five, weekly], undefined, now).activeLimit).toBeUndefined()
  })
  it('not a 5-hour limit whose window was already running at the weekly one', () => {
    const early: LimitHit = { at: t(1, 30), resetsAt: t(4, 0), kind: '5 horas', source: 'wake_log' }
    expect(workedAfter(weekly, [early, weekly], [])).toBe(false)
  })
  it('the status line watching the week go up', () => {
    history([0, 1, 2, 5, 13])
    expect(buildUsage('claude6', [weekly], undefined, now).activeLimit).toBeUndefined()
  })
  it('one reading below 100 % in a 5-hour window that began after the limit (the user topped the week up)', () => {
    // claude3, 12-11: week used up on the 11th at 15:59, topped up; first reply at 01:03 read week 0 %, five hours until 06:00.
    const at = new Date(2026, 10, 12, 1, 3).getTime()
    const reading = { at, five: 0, week: 0, fiveResets: new Date(2026, 10, 12, 6, 0).getTime() }
    const hit: LimitHit = { at: t(15, 59), resetsAt: new Date(2026, 10, 14, 19, 0).getTime(), kind: 'semanal', source: 'wake_log' }
    expect(workedAfter(hit, [hit], [reading])).toBe(true)
    // The same figure from a session whose window was already running at the limit proves nothing.
    expect(workedAfter(hit, [hit], [{ ...reading, fiveResets: t(20, 0) }])).toBe(false)
    expect(workedAfter(hit, [hit], [{ ...reading, week: 100 }])).toBe(false)
  })
  it('stale sessions repainting their old figures are not work', () => {
    history([95, 95, 95])
    expect(buildUsage('claude6', [weekly], undefined, now).activeLimit?.kind).toBe('semanal')
    history([95, 97, 95, 97, 95])
    expect(buildUsage('claude6', [weekly], undefined, now).activeLimit?.kind).toBe('semanal')
  })
})
