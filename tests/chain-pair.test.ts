// EV152 (the user, 14-11 04:50: «prioridad el resto de claude activos al proyecto del juego máxima potencia»): two at once in a
// wheel, the partner on what needs no shared resource.
import { describe, it, expect } from 'vitest'
import { chainStep, memberViews, partnerText, turnFor, type ChainMember, type RelayChain } from '../src/core/chain'

const m = (id: string, o: Partial<ChainMember> = {}): ChainMember => ({ id: id as any, state: 'disponible', hasLogin: true, workingHere: false, ...o })
const wheel = (o: Partial<RelayChain> = {}): RelayChain => ({ on: true, order: ['claude3', 'claude1', 'claude6'] as any, phase: 'trabaja', ...o })
const NOW = 1_800_000_000_000
const working = (id: string) => m(id, { state: 'trabajando', workingHere: true })

describe('dos a la vez en la rueda (EV152)', () => {
  it('apagado, nada cambia: la que trabaja fuera de turno espera', () => {
    const acts = chainStep(wheel({ holder: 'claude6' as any }), [working('claude6'), working('claude1'), m('claude3', { state: 'sin-uso' })], NOW)
    expect(acts).toEqual([{ kind: 'frenar', account: 'claude1', holder: 'claude6' }])
  })
  it('encendido, la siguiente con uso trabaja a la vez y no se la frena', () => {
    const acts = chainStep(wheel({ holder: 'claude6' as any, pair: true }), [working('claude6'), m('claude1'), m('claude3', { state: 'sin-uso' })], NOW)
    expect(acts).toEqual([{ kind: 'pareja', to: 'claude1', holder: 'claude6' }])
    const again = chainStep(wheel({ holder: 'claude6' as any, pair: true, partner: 'claude1' as any }), [working('claude6'), working('claude1'), m('claude3', { state: 'sin-uso' })], NOW)
    expect(again).toEqual([])
  })
  it('la pareja que se agota deja de serlo y entra otra si la hay', () => {
    const acts = chainStep(wheel({ holder: 'claude6' as any, pair: true, partner: 'claude1' as any }), [working('claude6'), m('claude1', { state: 'sin-uso' }), m('claude3')], NOW)
    expect(acts).toEqual([{ kind: 'fin-pareja', account: 'claude1', why: 'sin uso' }, { kind: 'pareja', to: 'claude3', holder: 'claude6' }])
  })
  it('si se agota la del turno, el turno pasa a la pareja (ya trabajando) y se busca otra', () => {
    const acts = chainStep(wheel({ holder: 'claude6' as any, pair: true, partner: 'claude3' as any }), [m('claude6', { state: 'sin-uso' }), working('claude3'), m('claude1')], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', from: 'claude6', to: 'claude3', adopt: true })
    expect(acts[1]).toMatchObject({ kind: 'fin-pareja', account: 'claude3' })
    expect(acts[2]).toEqual({ kind: 'pareja', to: 'claude1', holder: 'claude3' })
  })
  it('al apagarlo, la pareja deja de serlo; y en un solape no se busca pareja', () => {
    expect(chainStep(wheel({ holder: 'claude6' as any, partner: 'claude1' as any }), [working('claude6'), working('claude1'), m('claude3')], NOW))
      .toEqual([{ kind: 'fin-pareja', account: 'claude1', why: 'la rueda ya no trabaja de dos en dos' }, { kind: 'frenar', account: 'claude1', holder: 'claude6' }])
    expect(chainStep(wheel({ holder: 'claude6' as any, pair: true, outgoing: 'claude1' as any }), [working('claude6'), m('claude1', { state: 'trabajando', workingHere: true }), m('claude3')], NOW)).toEqual([])
  })
  it('los ganchos dejan trabajar a la pareja; la pantalla la enseña; su texto dice qué coger', () => {
    const file = { at: NOW, projects: [{ id: 'fp', name: 'Mi Juego', roots: ['C:\\fp'], holder: 'claude6' as any, phase: 'trabaja' as const, members: ['claude3', 'claude1', 'claude6'] as any, partner: 'claude1' as any }] }
    expect(turnFor(file, 'claude1' as any, 'C:\\fp\\Assets')).toMatchObject({ inWheel: true, mine: true, partner: true })
    expect(turnFor(file, 'claude3' as any, 'C:\\fp')).toMatchObject({ inWheel: true, mine: false })
    const v = memberViews(wheel({ holder: 'claude6' as any, pair: true, partner: 'claude1' as any }), [working('claude6'), working('claude1'), m('claude3')], NOW)
    expect(v.find((x) => x.id === 'claude1')).toMatchObject({ status: 'turno', text: 'Trabaja a la vez (sin Unity ni la gráfica)' })
    const t = partnerText({ to: 'claude1' as any, holder: 'claude6' as any, project: 'Mi Juego' })
    expect(t).toContain('trabajas a la vez que Claude 6')
    expect(t).toContain('pmc claim')
  })
})
