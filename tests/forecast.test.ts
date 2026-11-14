import { describe, expect, it } from 'vitest'
import { weekRate, wheelForecast, forecastText, DEFAULT_RATE } from '../src/core/forecast'

const NOW = new Date(2026, 10, 13, 3, 0).getTime()
const M = 60_000

describe('the wheel forecast (EV67)', () => {
  it('measures the pace from readings in the same week, ignoring gaps and resets', () => {
    const r = weekRate([
      { at: NOW - 120 * M, week: 50, weekResets: 1 }, { at: NOW - 100 * M, week: 53, weekResets: 1 }, { at: NOW - 80 * M, week: 56, weekResets: 1 },
      { at: NOW - 20 * M, week: 60, weekResets: 1 }, { at: NOW - 10 * M, week: 1, weekResets: 2 }
    ], NOW)
    expect(r.hours).toBeCloseTo(40 / 60)
    expect(r.rate).toBeCloseTo(6 / (40 / 60))
    expect(weekRate([], NOW).rate).toBeUndefined()
  })
  it('adds the hours one after another and says when everything would stop, and if the agenda fits', () => {
    const f = wheelForecast([
      { id: 'claude3', skipped: false, weekUsed: 64, weekResetsAt: NOW + 4 * 86400_000, rate: 9 },
      { id: 'claude1', skipped: false, weekUsed: 76, weekResetsAt: NOW + 2 * 86400_000, backAt: NOW + 90 * M },
      { id: 'claude4', skipped: true }
    ], NOW, { open: 20, hoursPerTask: 0.5 })
    expect(f.hours).toBeCloseTo(4 + 24 / DEFAULT_RATE, 0)
    expect(f.stopAt).toBe(NOW + f.hours * 3600_000)
    expect(f.agendaHours).toBe(10)
    expect(f.short).toBe(true)
    expect(forecastText(f, NOW)).toMatch(/^Quedan unas 6,7 h de trabajo en la rueda esta semana; a este ritmo se pararía todo hoy hacia las 09:00 y volvería a haber cuando se renueve una semana \(el dom 15 hacia las 03:00\)\. La agenda pide unas 10 h: la semana no llega \(estimación\)\.$/)
  })
  it('does not stop before a week comes back when there is plenty', () => {
    const f = wheelForecast([{ id: 'claude3', skipped: false, weekUsed: 0, weekResetsAt: NOW + 5 * 3600_000, rate: 5 }], NOW)
    expect(f.stopAt).toBeUndefined()
    expect(forecastText(f, NOW)).toContain('no se para antes de que vuelva una semana')
  })
})
