// EV43: what each task cost, from its claim to «marcada como hecha», in week points of its account.
import { describe, it, expect } from 'vitest'
import { costByModel, heavyNow, taskCosts } from '../src/core/taskcost'

const W = 1_000_000_000
const r = (at: number, week: number) => ({ at, week, weekResets: W })

describe('gasto por tarea (EV43)', () => {
  it('cuenta los puntos de la semana entre la reserva y la tarea hecha, de la cuenta que la reservó', () => {
    const claims = [
      { at: 100, account: 'claude1', title: 'Claude 1 se encarga de EV92 · Decisiones que se contradicen' },
      { at: 50, account: 'claude3', title: 'Claude 3 se encarga de EV92 · Decisiones que se contradicen' },
      { at: 200, account: 'claude3', title: 'Claude 3 se encarga de EV64 · Peticiones' }
    ]
    const dones = [{ at: 160, title: 'EV92 · Decisiones que se contradicen: marcada como hecha' }, { at: 400, title: 'EV64 · Peticiones: marcada como hecha' }, { at: 500, title: 'XX: sin reserva' }]
    const history = { claude1: [r(90, 80), r(130, 82), r(160, 85)], claude3: [r(190, 10), r(300, 14), r(400, 16)] }
    const out = taskCosts(claims, dones, history, { EV92: 'opus', EV64: 'sonnet' })
    expect(out).toEqual([
      { task: 'EV92', account: 'claude1', points: 3, minutes: 0, model: 'opus', doneAt: 160 },
      { task: 'EV64', account: 'claude3', points: 2, minutes: 0, model: 'sonnet', doneAt: 400 }
    ])
    expect(costByModel(out)).toEqual([{ model: 'opus', tasks: 1, avgPoints: 3 }, { model: 'sonnet', tasks: 1, avgPoints: 2 }])
  })
  it('avisa de una tarea en marcha que ya gasta más del triple de lo normal en su modelo', () => {
    const claims = [{ at: 100, account: 'claude1', title: 'Claude 1 se encarga de EV50 · Grande' }, { at: 100, account: 'claude3', title: 'Claude 3 se encarga de EV51 · Normal' }]
    const history = { claude1: [r(100, 10), r(500, 22)], claude3: [r(100, 5), r(500, 7)] }
    const out = heavyNow(claims, new Set(), history, { EV50: 'sonnet', EV51: 'sonnet' }, [{ model: 'sonnet', avgPoints: 1.5 }], 600)
    expect(out).toEqual([{ task: 'EV50', account: 'claude1', points: 12, avg: 1.5, model: 'sonnet' }])
    expect(heavyNow(claims, new Set(['EV50']), history, { EV50: 'sonnet' }, [{ model: 'sonnet', avgPoints: 1.5 }], 600)).toEqual([])
  })
  it('una tarea reservada antes de que la cuenta cogiera otra no se lleva lo que gastó después (EV20, 13-11)', () => {
    const claims = [
      { at: 100, account: 'claude1', title: 'Claude 1 se encarga de EV20 · Reparto automático' },
      { at: 100 + 30_000, account: 'claude1', title: 'Claude 1 se encarga de EV21 · Cogida a la vez' },
      { at: 200_000, account: 'claude1', title: 'Claude 1 se encarga de EV7 · Otra' }
    ]
    const history = { claude1: [r(100, 10), r(200_000, 11), r(900_000, 60)] }
    const out = heavyNow(claims, new Set(), history, { EV20: 'opus', EV21: 'opus', EV7: 'opus' }, [{ model: 'opus', avgPoints: 1 }], 1_000_000)
    expect(out.map((h) => h.task)).toEqual(['EV7'])
  })
  it('lo que la cuenta terminó entre medias no se carga a una tarea reservada hace mucho', () => {
    const claims = [
      { at: 100, account: 'claude1', title: 'Claude 1 se encarga de EV19 · Ventana de relevos' },
      { at: 150, account: 'claude1', title: 'Claude 1 se encarga de EV7 · Otra' }
    ]
    const dones = [{ at: 300, title: 'EV7 · Otra: marcada como hecha' }, { at: 400, title: 'EV19 · Ventana de relevos: marcada como hecha' }]
    const history = { claude1: [r(100, 10), r(150, 12), r(300, 40), r(400, 45)] }
    const out = taskCosts(claims, dones, history)
    expect(out.find((c) => c.task === 'EV7')?.points).toBe(28)
    expect(out.find((c) => c.task === 'EV19')?.points).toBe(5)
  })
})
