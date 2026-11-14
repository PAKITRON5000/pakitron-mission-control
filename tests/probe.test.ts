// EV120: an account recharged by hand is seen by the app with no window open (the rate_limit_event of a tiny claude -p).
import { describe, it, expect } from 'vitest'
import { backSooner, dueProbe, hasUsage, parseProbe, probeWords, PROBE_EVERY_MS } from '../src/core/probe'

// Real lines from 13-11 (claude3 still out; claude1 recharged by the user).
const rejected = '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1794587400,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":1794587400,"status":"rejected","surpassedThreshold":1},"seven_day":{"utilization":0.97,"resetsAt":1794679200,"status":"allowed_warning","surpassedThreshold":0.75}}},"uuid":"e29b4fa1","session_id":"1bc0258a"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"You\'ve hit your 5-hour limit · resets 5:30pm (Europe/Madrid)"}]}}'
const allowed = '{"type":"system","subtype":"init"}\n{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1794592200,"rateLimitType":"five_hour","overageStatus":"rejected","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.09,"resetsAt":1794592200,"status":"allowed"},"seven_day":{"utilization":0.01,"resetsAt":1795003200,"status":"allowed"}}},"uuid":"b0bb","session_id":"02f1"}\n{"type":"result"}'

describe('usage probe', () => {
  it('reads the real windows from the stream', () => {
    const r = parseProbe(rejected)!
    expect(r).toMatchObject({ status: 'rejected', type: 'five_hour', resetsAt: 1794587400_000 })
    expect(r.five).toMatchObject({ pct: 100, resetsAt: 1794587400_000 })
    expect(r.week).toMatchObject({ pct: 97 })
    expect(hasUsage(r)).toBe(false)
    const a = parseProbe(allowed)!
    expect(hasUsage(a)).toBe(true)
    expect(probeWords(a)).toBe('semana 1 %, 5 horas 9 %')
    expect(parseProbe('Error: not logged in')).toBeUndefined()
  })

  it('tells when a refused account comes back sooner than the app believes', () => {
    const r = parseProbe(rejected)! // back at 17:30 (1794587400 s)
    const wed = 1794587400_000 + 5 * 86400_000
    expect(backSooner(wed, r)).toBe(true)
    expect(backSooner(1794587400_000 + 10 * 60_000, r)).toBe(false) // within 15 min: the same, near enough
    expect(backSooner(undefined, r)).toBe(false)
    expect(backSooner(wed, parseProbe(allowed)!)).toBe(false) // with usage it is not «sooner», it is back
  })

  it('asks only accounts believed out, not due back soon, not set aside, every 10 minutes, oldest first', () => {
    const now = 1_800_000_000_000
    const accs = [
      { id: 'claude1', out: true, backAt: now + 5 * 86400_000, skip: false },
      { id: 'claude3', out: true, backAt: now + 3 * 3600_000, skip: false },
      { id: 'claude6', out: true, backAt: now + 10 * 60_000, skip: false },
      { id: 'claude4', out: true, skip: true },
      { id: 'claude5', out: false, skip: false },
      { id: 'claude2', out: true, skip: false, login: false }
    ]
    expect(dueProbe(accs, {}, now)).toBe('claude1')
    expect(dueProbe(accs, { claude1: now - 60_000 }, now)).toBe('claude3')
    expect(dueProbe(accs, { claude1: now - 60_000, claude3: now - 60_000 }, now)).toBeUndefined()
    expect(dueProbe(accs, { claude1: now - PROBE_EVERY_MS, claude3: now - 60_000 }, now)).toBe('claude1')
    expect(dueProbe(accs, { claude1: now - PROBE_EVERY_MS - 5, claude3: now - PROBE_EVERY_MS - 9 }, now)).toBe('claude3')
  })
})
