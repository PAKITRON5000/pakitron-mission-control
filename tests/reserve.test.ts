import { describe, it, expect } from 'vitest'
import { reserveDue, reservePrompt, reservedFor, reserveWrapUp, wrapUpText, type ReserveAgent } from '../src/core/reserve'
import { decideLaunch } from '../src/core/dispatch'

const now = Date.parse('2026-11-13T09:30:00+01:00')
const out = (id: string, h = 5): ReserveAgent => ({ id: id as any, state: 'sin-uso', usage: { activeLimit: { resetsAt: now + h * 3600_000 } } })
const free = (id: string, state = 'disponible'): ReserveAgent => ({ id: id as any, state, usage: {} })
const rule = { account: 'claude5' as const, projectId: 'video', on: true }
const status = { claude2: 'baja', claude4: 'pausada', claude5: 'pausada' }

describe('cuenta de reserva (IV1)', () => {
  it('se abre cuando todas las demás en uso están sin uso, aunque ella esté en «No usar»', () => {
    const agents = [out('claude1', 5.5), free('claude2', 'baja'), out('claude3', 3), free('claude4', 'apartada'), free('claude5', 'apartada'), out('claude6', 5.5)]
    const v = reserveDue(rule, agents, status, now)
    expect(v.open).toBe(true)
    expect(v.why).toContain('todas las demás cuentas están sin uso')
  })
  it('no se abre si alguna puede trabajar, si ella está sin uso, de baja o la regla apagada', () => {
    const base = [out('claude1'), out('claude3'), free('claude5', 'apartada'), out('claude6')]
    expect(reserveDue(rule, [out('claude1'), free('claude3'), free('claude5', 'apartada'), out('claude6')], status, now)).toMatchObject({ open: false, why: expect.stringContaining('Claude 3') })
    expect(reserveDue(rule, [out('claude1'), out('claude3'), out('claude5', 2), out('claude6')], status, now).open).toBe(false)
    expect(reserveDue(rule, base, { ...status, claude5: 'baja' }, now).open).toBe(false)
    expect(reserveDue({ ...rule, on: false }, base, status, now).open).toBe(false)
    // a limit that already reset does not count against it
    expect(reserveDue(rule, [out('claude1'), out('claude3'), out('claude5', -1), out('claude6')], status, now).open).toBe(true)
  })
  it('solo con margen: no se abre si la primera vuelve en menos de una hora (EV150)', () => {
    expect(reserveDue(rule, [out('claude1', 0.5), out('claude3', 3), free('claude5', 'apartada'), out('claude6', 5)], status, now)).toMatchObject({ open: false, why: expect.stringContaining('no hay margen') })
    expect(reserveDue(rule, [out('claude1', 1.5), out('claude3', 3), free('claude5', 'apartada'), out('claude6', 5)], status, now).open).toBe(true)
  })
  it('antes de que vuelva otra, o en cuanto vuelve, se le pide que lo deje todo a salvo y cierre (EV150)', () => {
    expect(reserveWrapUp(rule, [out('claude1', 2), out('claude3', 3), free('claude5', 'apartada'), out('claude6', 5)], status, now)).toBeUndefined()
    const soon = reserveWrapUp(rule, [out('claude1', 0.3), out('claude3', 3), free('claude5', 'apartada'), out('claude6', 5)], status, now)
    expect(soon?.why).toMatch(/la primera vuelve a las \d\d:\d\d/)
    const back = reserveWrapUp(rule, [out('claude1', 2), free('claude3'), free('claude5', 'apartada'), out('claude6', 5)], status, now)
    expect(back).toMatchObject({ key: 'ya:claude3', why: 'Claude 3 ya puede trabajar' })
    expect(reserveWrapUp({ ...rule, on: false }, [free('claude3'), free('claude5', 'apartada')], status, now)).toBeUndefined()
    const text = wrapUpText('Mis Vídeos', back!.why)
    expect(text).toContain('Deja Mis Vídeos en un punto seguro')
    expect(text).toContain('cierra los programas que hayas abierto')
    expect(text).toContain('no cortes un render a medias')
    expect(reservePrompt('Mis Vídeos')).toContain('hasta que vuelva una')
  })
  it('el despachador la deja abrir solo como reserva', () => {
    const world = { windows: [], status, workingOn: {}, maxPerProject: 1, lastOpened: {}, now }
    expect(decideLaunch({ account: 'claude5', projectId: 'video', reason: 'reserva' }, world).action).toBe('abrir')
    expect(decideLaunch({ account: 'claude5', projectId: 'video', reason: 'reparto' }, world).action).toBe('nada')
    expect(decideLaunch({ account: 'claude2', projectId: 'video', reason: 'reserva' }, world).action).toBe('nada')
  })
  it('sin tareas abiertas ni respuestas por leer no se abre', () => {
    const agents = [out('claude1'), out('claude3'), free('claude5', 'apartada'), out('claude6')]
    expect(reserveDue(rule, agents, status, now, { openTasks: 0, toRead: 0 })).toMatchObject({ open: false, why: expect.stringContaining('no le queda trabajo') })
    expect(reserveDue(rule, agents, status, now, { openTasks: 0, toRead: 1 }).open).toBe(true)
    expect(reserveDue(rule, agents, status, now, { openTasks: 2, toRead: 0 }).open).toBe(true)
  })
  it('el proyecto de una reserva encendida es solo de esa cuenta', () => {
    expect(reservedFor([rule], 'video')).toBe('claude5')
    expect(reservedFor([{ ...rule, on: false }], 'video')).toBeUndefined()
    expect(reservedFor([rule], 'mission-control')).toBeUndefined()
    expect(reservedFor(undefined, 'video')).toBeUndefined()
  })
  it('el mensaje cabe en una línea', () => {
    expect(reservePrompt('Video')).not.toMatch(/\n/)
  })
})
