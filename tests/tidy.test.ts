import { describe, expect, it } from 'vitest'
import { duplicateWindowsToClose, idleBackgroundToStop, idleWindowsToClose, strayWindowsToClose, type TidyAccount } from '../src/core/tidy'

const now = new Date(2026, 10, 13, 12, 40).getTime()
const min = 60_000
const wheel = { mc: { on: true, order: ['claude3', 'claude1', 'claude6'], holder: 'claude3' } }
const acc = (id: string, over: Partial<TidyAccount> = {}, s: Partial<TidyAccount['sessions'][number]> = {}): TidyAccount =>
  ({ id, state: 'sin-uso', backAt: now + 5 * 24 * 60 * min, sessions: [{ pid: 100 + Number(id.slice(6)), projectId: 'mc', working: false, lastActivityAt: now - 60 * min, ...s }], ...over })

describe('closing the windows nobody uses in a wheel (EV111)', () => {
  it('closes an account out of usage for days, idle for an hour (13-11: Claude 1 until Wednesday)', () => {
    expect(idleWindowsToClose(wheel, [acc('claude1')], now)).toEqual([{ projectId: 'mc', account: 'claude1', pid: 101, backAt: now + 5 * 24 * 60 * min }])
  })

  it('never the holder, the one finishing in the overlap, one back soon, one working or busy a moment ago', () => {
    expect(idleWindowsToClose(wheel, [acc('claude3')], now)).toEqual([])
    expect(idleWindowsToClose({ mc: { ...wheel.mc, outgoing: 'claude1' } }, [acc('claude1')], now)).toEqual([])
    expect(idleWindowsToClose(wheel, [acc('claude1', { backAt: now + 30 * min })], now)).toEqual([])
    expect(idleWindowsToClose(wheel, [acc('claude1', {}, { working: true })], now)).toEqual([])
    expect(idleWindowsToClose(wheel, [acc('claude1', {}, { lastActivityAt: now - 5 * min })], now)).toEqual([])
  })

  it('only windows in the wheel\'s project, of accounts in the wheel, not background sessions nor the ones already closed', () => {
    expect(idleWindowsToClose(wheel, [acc('claude1', {}, { projectId: 'otro' })], now)).toEqual([])
    expect(idleWindowsToClose(wheel, [acc('claude5')], now)).toEqual([])
    expect(idleWindowsToClose(wheel, [acc('claude1', {}, { kind: 'background' })], now)).toEqual([])
    expect(idleWindowsToClose(wheel, [acc('claude1')], now, new Set([101]))).toEqual([])
    expect(idleWindowsToClose({ mc: { ...wheel.mc, on: false } }, [acc('claude1')], now)).toEqual([])
  })
})

describe('stopping the background sessions nobody uses in a wheel (EV141)', () => {
  const bg = { kind: 'background', shortId: 'a1b2c3d4' }
  it('stops one of an account out of usage for days, idle for an hour', () => {
    expect(idleBackgroundToStop(wheel, [acc('claude1', {}, bg)], now)).toEqual([{ projectId: 'mc', account: 'claude1', shortId: 'a1b2c3d4', backAt: now + 5 * 24 * 60 * min }])
  })
  it('never the holder, the one in the overlap, one back soon, one working, a window, another project or one already stopped', () => {
    expect(idleBackgroundToStop(wheel, [acc('claude3', {}, bg)], now)).toEqual([])
    expect(idleBackgroundToStop({ mc: { ...wheel.mc, outgoing: 'claude1' } }, [acc('claude1', {}, bg)], now)).toEqual([])
    expect(idleBackgroundToStop(wheel, [acc('claude1', { backAt: now + 30 * min }, bg)], now)).toEqual([])
    expect(idleBackgroundToStop(wheel, [acc('claude1', {}, { ...bg, working: true })], now)).toEqual([])
    expect(idleBackgroundToStop(wheel, [acc('claude1')], now)).toEqual([])
    expect(idleBackgroundToStop(wheel, [acc('claude1', {}, { ...bg, projectId: 'otro' })], now)).toEqual([])
    expect(idleBackgroundToStop(wheel, [acc('claude1', {}, bg)], now, new Set(['a1b2c3d4']))).toEqual([])
    expect(idleBackgroundToStop(wheel, [acc('claude1', { state: 'disponible' }, bg)], now)).toEqual([])
  })
})

describe('a second window of the same account (EV130)', () => {
  const w = (pid: number, over: Partial<TidyAccount['sessions'][number]> = {}) => ({ pid, projectId: 'mc', working: false, lastActivityAt: now - 30 * min, ...over })
  it('closes the idle extra one and keeps the one most recently active', () => {
    const a: TidyAccount = { id: 'claude6', state: 'trabajando', sessions: [w(1, { working: true, lastActivityAt: now }), w(2)] }
    expect(duplicateWindowsToClose([a], now)).toEqual([{ projectId: 'mc', account: 'claude6', pid: 2 }])
  })
  it('not a single window, not one working or busy a moment ago, not background sessions', () => {
    expect(duplicateWindowsToClose([{ id: 'claude6', state: 'disponible', sessions: [w(1)] }], now)).toEqual([])
    expect(duplicateWindowsToClose([{ id: 'claude6', state: 'trabajando', sessions: [w(1, { lastActivityAt: now - 40 * min }), w(2, { working: true })] }], now)).toEqual([{ projectId: 'mc', account: 'claude6', pid: 1 }])
    expect(duplicateWindowsToClose([{ id: 'claude6', state: 'trabajando', sessions: [w(1, { lastActivityAt: now }), w(2, { lastActivityAt: now - 5 * min })] }], now)).toEqual([])
    expect(duplicateWindowsToClose([{ id: 'claude6', state: 'trabajando', sessions: [w(1, { lastActivityAt: now }), w(2, { kind: 'background' })] }], now)).toEqual([])
  })
})

describe('closing the windows left behind outside the wheel (the user, 14-11 03:13)', () => {
  const back = now + 2 * 60 * min
  it('closes a wheel account quiet in another project, and one set aside (14-11 17:19: Claude 3 in another project, Claude 4)', () => {
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: back }, { projectId: 'fp' })], now)).toEqual([{ projectId: 'fp', account: 'claude1', pid: 101, backAt: back, why: 'otro-proyecto' }])
    expect(strayWindowsToClose(wheel, [acc('claude4', { state: 'apartada', backAt: back }, { projectId: undefined })], now)).toEqual([{ projectId: undefined, account: 'claude4', pid: 104, backAt: back, why: 'apartada' }])
    expect(strayWindowsToClose({}, [acc('claude2', { state: 'baja', backAt: back })], now)).toHaveLength(1)
  })
  it('not its own wheel\'s project (idleWindowsToClose has it), nor an account outside every wheel, nor a wheel that is off', () => {
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: back })], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude5', { backAt: back }, { projectId: 'iv' })], now)).toEqual([])
    expect(strayWindowsToClose({ mc: { ...wheel.mc, on: false } }, [acc('claude1', { backAt: back }, { projectId: 'fp' })], now)).toEqual([])
  })
  it('never a holder or the one in the overlap, one with usage, one back soon, one working or busy a moment ago, a background session or one already closed', () => {
    const fp = { projectId: 'fp' }
    expect(strayWindowsToClose(wheel, [acc('claude3', { backAt: back }, fp)], now)).toEqual([])
    expect(strayWindowsToClose({ mc: { ...wheel.mc, outgoing: 'claude1' } }, [acc('claude1', { backAt: back }, fp)], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude1', { state: 'disponible', backAt: undefined }, fp)], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude4', { state: 'apartada', backAt: undefined })], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: now + 30 * min }, fp)], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: back }, { ...fp, working: true })], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: back }, { ...fp, lastActivityAt: now - 5 * min })], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: back }, { ...fp, kind: 'background' })], now)).toEqual([])
    expect(strayWindowsToClose(wheel, [acc('claude1', { backAt: back }, fp)], now, new Set([101]))).toEqual([])
  })
  it('one window once, even with two wheels on', () => {
    const two = { mc: wheel.mc, fp: { on: true, order: ['claude1', 'claude6'], holder: 'claude6' } }
    expect(strayWindowsToClose(two, [acc('claude1', { backAt: back }, { projectId: 'iv' })], now)).toHaveLength(1)
    expect(strayWindowsToClose(two, [acc('claude1', { backAt: back }, { projectId: 'fp' })], now)).toEqual([])
  })
})
