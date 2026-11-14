import { describe, expect, it } from 'vitest'
import { readResetOffer, resetStep, rechargeDecision, useByTime, type RechargeInput } from '../src/core/recharge'

const NOW = new Date(2026, 10, 13, 4, 0).getTime()
const H = 3600_000

describe('what the window says (EV96)', () => {
  it('finds the reset offer in its notice lines', () => {
    expect(readResetOffer('You\'ve hit your 5-hour limit · resets 9am\n/limit-reset to use your 5-hour reset · 1 left · use by Nov 18')).toEqual({ available: true, kinds: ['5-hour'], left: 1, useBy: 'Nov 18' })
    expect(readResetOffer('  ❯ Use an available limit reset and keep working')).toEqual({ available: true })
    // Wording read from claude.exe 2.1.323 (13-11): kept resets, a saved one, a new offer; and the real «not now».
    expect(readResetOffer('Resets kept · run /limit-reset when you want one · first expires Nov 20')).toEqual({ available: true, useBy: 'Nov 20' })
    expect(readResetOffer('You have a reset saved for when you reach a usage limit · run /limit-reset')).toMatchObject({ available: true })
    expect(readResetOffer('A different reset is on offer now · nothing was used · run /limit-reset again')).toMatchObject({ available: true })
    expect(readResetOffer('❯ /limit-reset\n  ⎿  A 5-hour limit reset isn\'t available right now.')).toEqual({ available: false })
    expect(readResetOffer('A 5-hour limit reset isn\'t available right now.')).toEqual({ available: false })
    expect(readResetOffer('You\'ve hit your 5-hour limit · resets 9am')).toBeUndefined()
  })
  it('never presses where it talks about credits or paying', () => {
    expect(resetStep('Use a 5-hour reset?\nRefills your 5-hour limit now · back to work\n❯ Yes, use my 5-hour reset\n  No, keep it')).toBe('confirmar')
    expect(resetStep('Press Enter again to claim (claiming turns on extra usage billing)')).toBe('peligro')
    expect(resetStep('Buy usage credits and get at least 20% extra')).toBe('peligro')
    expect(resetStep('Reset used · 0 left · send a message to continue')).toBe('hecho')
    expect(resetStep('A 5-hour limit reset isn\'t available right now.')).toBe('sin-recarga')
    expect(resetStep('Which reset do you want to use?')).toBe('elegir')
    expect(resetStep('Use a 5-hour reset?\nRefills your 5-hour limit now · your weekly reset day stays Monday\n❯ Yes, use my 5-hour reset')).toBe('confirmar')
    expect(resetStep('5-hour limit refilled · your weekly reset day stays Monday · 0 resets left')).toBe('hecho')
  })
  it('reads «use by» in English or Spanish', () => {
    expect(new Date(useByTime('Nov 18', NOW)!).getDate()).toBe(18)
    expect(new Date(useByTime('18 de nov', NOW)!).getMonth()).toBe(10)
    expect(useByTime('soon', NOW)).toBeUndefined()
  })
})

describe('the best moment', () => {
  const base: RechargeInput = { now: NOW, mode: 'sola', limit: { kind: '5 horas', resetsAt: NOW + 3 * H }, weekUsed: 50, weekResetsAt: NOW + 3 * 86400_000, offer: { available: true, kinds: ['5-hour'] }, workLeft: true, othersReady: [] }
  it('uses it when it is stopped with work, nobody else can go on and its return is far', () => {
    expect(rechargeDecision(base)).toMatchObject({ action: 'usar', kind: '5-hour' })
    expect(rechargeDecision({ ...base, mode: 'avisar' }).action).toBe('avisar')
  })
  it('keeps it when another can go on, when it is back soon, with no work or no week left', () => {
    expect(rechargeDecision({ ...base, othersReady: ['claude1'] })).toMatchObject({ action: 'esperar', why: 'Claude 1 puede seguir: la recarga se guarda' })
    expect(rechargeDecision({ ...base, limit: { kind: '5 horas', resetsAt: NOW + 30 * 60_000 } }).action).toBe('esperar')
    expect(rechargeDecision({ ...base, workLeft: false }).action).toBe('esperar')
    expect(rechargeDecision({ ...base, weekUsed: 95 }).action).toBe('nada')
    expect(rechargeDecision({ ...base, limit: { kind: 'semanal', resetsAt: NOW + 2 * 86400_000 } }).action).toBe('nada')
    expect(rechargeDecision({ ...base, mode: 'no' }).action).toBe('nada')
    expect(rechargeDecision({ ...base, offer: { available: false } }).action).toBe('nada')
  })
  it('spends one about to expire even if another could go on', () => {
    expect(rechargeDecision({ ...base, othersReady: ['claude1'], useByAt: NOW + 10 * H })).toMatchObject({ action: 'usar', why: 'caduca pronto y se perdería' })
  })
  it('each kind where it buys the most: full when the week is low too, Fable only for Fable work', () => {
    const full = { available: true, kinds: ['full'] }
    expect(rechargeDecision({ ...base, offer: full }).action).toBe('nada')
    expect(rechargeDecision({ ...base, offer: full, weekUsed: 80 })).toMatchObject({ action: 'usar', kind: 'full' })
    const weeklyWall = { kind: 'semanal' as const, resetsAt: NOW + 2 * 86400_000 }
    expect(rechargeDecision({ ...base, limit: weeklyWall, offer: full })).toMatchObject({ action: 'usar', kind: 'full' })
    expect(rechargeDecision({ ...base, limit: weeklyWall, offer: { available: true, kinds: ['fable'] } }).action).toBe('nada')
    expect(rechargeDecision({ ...base, limit: weeklyWall, offer: { available: true, kinds: ['fable'] }, model: 'claude-fable-5-2' })).toMatchObject({ action: 'usar', kind: 'fable' })
  })
  it('reads the chooser and a kept reset', () => {
    expect(readResetOffer('Which reset do you want to use?\n❯ Use a full reset (1 left, until Nov 20)\n  Use a Fable reset (1 left, until Nov 22)')).toEqual({ available: true, kinds: ['full', 'fable'], left: 2, useBy: 'Nov 20' })
    expect(readResetOffer('Full reset kept · run /limit-reset whenever you want to use it · use by Nov 20')).toEqual({ available: true, kinds: ['full'], useBy: 'Nov 20' })
  })
  it('keeps a weekly or full reset when the week comes back within a day, unless it would be lost first', () => {
    const soon = { kind: 'semanal' as const, resetsAt: NOW + 10 * H }
    expect(rechargeDecision({ ...base, limit: soon, offer: { available: true, kinds: ['full'] } })).toMatchObject({ action: 'esperar', why: 'su semana se renueva en 10 h: la recarga se guarda' })
    expect(rechargeDecision({ ...base, limit: soon, offer: { available: true, kinds: ['full'] }, useByAt: NOW + 5 * H }).action).toBe('usar')
    expect(rechargeDecision({ ...base, offer: { available: true, kinds: ['full'] }, weekUsed: 80, weekResetsAt: NOW + 12 * H }).action).toBe('esperar')
  })
  it('with the forecast: kept while the others reach its return or the agenda fits in them, spent when the wheel would stand still', () => {
    expect(rechargeDecision({ ...base, othersHours: 5 })).toMatchObject({ action: 'esperar', why: 'las demás tienen unas 5 h de trabajo, hasta que vuelva sola: la recarga se guarda' })
    expect(rechargeDecision({ ...base, othersHours: 1, agendaHours: 0.5 }).action).toBe('esperar')
    expect(rechargeDecision({ ...base, othersHours: 1, agendaHours: 12 }).action).toBe('usar')
    const weeklyWall = { kind: 'semanal' as const, resetsAt: NOW + 10 * H }
    expect(rechargeDecision({ ...base, limit: weeklyWall, offer: { available: true, kinds: ['full'] }, othersHours: 2, agendaHours: 20 }).action).toBe('usar')
  })
  it('a weekly reset at the weekly wall', () => {
    expect(rechargeDecision({ ...base, limit: { kind: 'semanal', resetsAt: NOW + 2 * 86400_000 }, offer: { available: true, kinds: ['weekly', '5-hour'] } })).toMatchObject({ action: 'usar', kind: 'weekly' })
  })
})
