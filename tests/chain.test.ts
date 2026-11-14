import { describe, it, expect } from 'vitest'
import { agendaBlocked, agendaDone, callable, callText, chainStep, memberViews, nextInLine, rotation, turnFor, wheelProjectOf, wheelsOf, type ChainMember, type RelayChain } from '../src/core/chain'

const m = (id: string, o: Partial<ChainMember> = {}): ChainMember => ({ id: id as any, state: 'disponible', hasLogin: true, workingHere: false, ...o })
const wheel = (o: Partial<RelayChain> = {}): RelayChain => ({ on: true, order: ['claude3', 'claude1', 'claude6'] as any, ...o })
const NOW = 1_800_000_000_000

describe('rueda de relevos', () => {
  it('gira empezando por la siguiente y deja a la que tenía el turno al final', () => {
    expect(rotation(['claude3', 'claude1', 'claude6'] as any, 'claude1' as any)).toEqual(['claude6', 'claude3', 'claude1'])
    expect(rotation(['claude3', 'claude1'] as any)).toEqual(['claude3', 'claude1'])
  })

  it('no hace nada mientras la que tiene el turno trabaja', () => {
    const acts = chainStep(wheel({ holder: 'claude1' as any, phase: 'trabaja' }), [m('claude1', { state: 'trabajando', workingHere: true }), m('claude3', { state: 'sin-uso', backAt: NOW + 3600_000 }), m('claude6')], NOW)
    expect(acts).toEqual([])
  })

  it('pasa el turno a la siguiente con uso cuando la que lo tiene se agota', () => {
    const acts = chainStep(wheel({ holder: 'claude3' as any, phase: 'trabaja' }), [m('claude3', { state: 'sin-uso' }), m('claude1'), m('claude6')], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', from: 'claude3', to: 'claude1' })
  })

  it('se salta a la siguiente si no tiene uso (Claude 1 sin uso: sigue Claude 6)', () => {
    const acts = chainStep(wheel({ holder: 'claude3' as any }), [m('claude3', { state: 'sin-uso' }), m('claude1', { state: 'sin-uso', backAt: NOW + 600_000 }), m('claude6')], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', to: 'claude6' })
  })

  it('si nadie tiene uso, espera y dice quién vuelve antes', () => {
    const c = wheel({ holder: 'claude3' as any, phase: 'trabaja' })
    const ms = [m('claude3', { state: 'sin-uso', backAt: NOW + 5 * 3600_000 }), m('claude1', { state: 'sin-uso', backAt: NOW + 2 * 3600_000 }), m('claude6', { state: 'sin-uso', backAt: NOW + 3600_000 })]
    expect(chainStep(c, ms, NOW)[0]).toMatchObject({ kind: 'esperar', firstBack: 'claude6' })
    // Already waiting: nothing new to say until someone is back.
    expect(chainStep({ ...c, phase: 'espera' }, ms, NOW)).toEqual([])
  })

  it('al volver la primera, le da el turno (aunque no sea la siguiente del orden)', () => {
    const c = wheel({ holder: 'claude3' as any, phase: 'espera' })
    const acts = chainStep(c, [m('claude3', { state: 'sin-uso' }), m('claude1', { state: 'sin-uso' }), m('claude6')], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', from: 'claude3', to: 'claude6' })
  })

  it('si vuelve primero la que tenía el turno, sigue ella', () => {
    const acts = chainStep(wheel({ holder: 'claude3' as any, phase: 'espera' }), [m('claude3'), m('claude1', { state: 'sin-uso' }), m('claude6', { state: 'sin-uso' })], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', from: 'claude3', to: 'claude3' })
  })

  it('frena a una cuenta de la rueda que vuelve y se pone a trabajar fuera de su turno', () => {
    const acts = chainStep(wheel({ holder: 'claude1' as any, phase: 'trabaja' }), [m('claude1', { state: 'trabajando', workingHere: true }), m('claude3', { state: 'trabajando', workingHere: true }), m('claude6')], NOW)
    expect(acts).toEqual([{ kind: 'frenar', account: 'claude3', holder: 'claude1' }])
  })

  it('si la que se agota tenía a otra ya trabajando aquí, esa se queda el turno sin abrir nada', () => {
    const acts = chainStep(wheel({ holder: 'claude1' as any }), [m('claude1', { state: 'sin-uso' }), m('claude3'), m('claude6', { state: 'trabajando', workingHere: true })], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', to: 'claude6', adopt: true })
    expect(acts.some((a) => a.kind === 'frenar')).toBe(false)
  })

  it('se salta las cuentas en pausa, apartadas, casi llenas o trabajando en otro proyecto', () => {
    const c = wheel({ holder: 'claude3' as any, paused: ['claude1'] as any })
    const acts = chainStep(c, [m('claude3', { state: 'sin-uso' }), m('claude1'), m('claude6', { weekUsed: 97 })], NOW)
    expect(acts[0]).toMatchObject({ kind: 'esperar' })
    const busy = chainStep(wheel({ holder: 'claude3' as any }), [m('claude3', { state: 'sin-uso' }), m('claude1', { workingElsewhere: 'mission-control' }), m('claude6', { status: 'pausada' })], NOW)
    expect(busy[0]).toMatchObject({ kind: 'esperar' })
  })

  it('EV153: llama a la siguiente con uso que trabaja en otro proyecto, al agotarse la del turno y cuando está a punto', () => {
    const away = { workingElsewhere: 'Mission Control', elsewhereId: 'mission-control', state: 'trabajando' as const }
    // Ran out: nobody free here; Claude 1 (next) is at work on Mission Control with usage: it is called there.
    const out = chainStep(wheel({ holder: 'claude3' as any, phase: 'trabaja' }), [m('claude3', { state: 'sin-uso' }), m('claude1', away), m('claude6', { state: 'sin-uso' })], NOW)
    expect(out[0]).toMatchObject({ kind: 'esperar' })
    expect(out[1]).toMatchObject({ kind: 'llamar', account: 'claude1', holder: 'claude3', elsewhere: 'Mission Control', elsewhereId: 'mission-control' })
    // Already waiting: it is still called (the app does not repeat the call more often than every 20 min).
    expect(chainStep(wheel({ holder: 'claude3' as any, phase: 'espera' }), [m('claude3', { state: 'sin-uso' }), m('claude1', away), m('claude6', { state: 'sin-uso' })], NOW))
      .toEqual([expect.objectContaining({ kind: 'llamar', account: 'claude1' })])
    // About to run out (the overlap's mark) with nobody free here: called before the cut, not after.
    const soon = chainStep(wheel({ holder: 'claude6' as any, phase: 'trabaja' }), [m('claude6', { state: 'trabajando', workingHere: true, fiveUsed: 96 }), m('claude3', away), m('claude1', { state: 'sin-uso' })], NOW)
    expect(soon).toEqual([expect.objectContaining({ kind: 'llamar', account: 'claude3', holder: 'claude6' })])
    // One free here goes first (the overlap, as before), and nobody is called.
    const free = chainStep(wheel({ holder: 'claude6' as any, phase: 'trabaja' }), [m('claude6', { state: 'trabajando', workingHere: true, fiveUsed: 96 }), m('claude3', away), m('claude1')], NOW)
    expect(free).toEqual([{ kind: 'solapar', from: 'claude6', to: 'claude1' }])
    // Never one that could not take the turn anyway: set aside, nearly out, or out of usage.
    expect(callable(m('claude1', { ...away, status: 'pausada' }), wheel())).toBe(false)
    expect(callable(m('claude1', { ...away, fiveUsed: 97 }), wheel())).toBe(false)
    expect(callable(m('claude1', away), wheel({ paused: ['claude1'] as any }))).toBe(false)
    expect(callable(m('claude1'), wheel())).toBe(false)
    // Once free there, it takes the turn as anybody free would.
    expect(chainStep(wheel({ holder: 'claude3' as any, phase: 'espera' }), [m('claude3', { state: 'sin-uso' }), m('claude1'), m('claude6', { state: 'sin-uso' })], NOW)[0])
      .toMatchObject({ kind: 'pasar', from: 'claude3', to: 'claude1' })
    const text = callText({ account: 'claude1' as any, holder: 'claude3' as any, project: 'Mi Juego', elsewhere: 'Mission Control', why: 'Claude 3 se ha quedado sin uso' })
    expect(text).toContain('Deja Mission Control a salvo')
    expect(text).toContain('pmc guarda')
    expect(text).toContain('el turno de Mi Juego')
  })

  it('empieza la rueda por la primera con uso si nadie tiene el turno', () => {
    const acts = chainStep(wheel(), [m('claude3', { state: 'sin-uso' }), m('claude1'), m('claude6')], NOW)
    expect(acts[0]).toMatchObject({ kind: 'pasar', to: 'claude1' })
    expect((acts[0] as any).from).toBeUndefined()
  })

  it('con «al 95 %», pasa el turno cuando la que lo tiene termina casi sin uso', () => {
    const ms = [m('claude3', { fiveUsed: 96 }), m('claude1'), m('claude6')]
    expect(chainStep(wheel({ holder: 'claude3' as any, passAt: 'casi' }), ms, NOW)[0]).toMatchObject({ kind: 'pasar', to: 'claude1' })
    // Without «casi» the turn stays; a holder idle with usage is called to go on instead.
    expect(chainStep(wheel({ holder: 'claude3' as any }), ms, NOW)).toEqual([{ kind: 'despertar', account: 'claude3' }])
  })

  it('despierta a la que tiene el turno si lleva un rato parada con uso, no si te espera a ti', () => {
    const c = wheel({ holder: 'claude1' as any, phase: 'trabaja', since: NOW - 3600_000 })
    expect(chainStep(c, [m('claude1', { lastActiveAt: NOW - 20 * 60_000 }), m('claude6'), m('claude3')], NOW)).toEqual([{ kind: 'despertar', account: 'claude1' }])
    expect(chainStep(c, [m('claude1', { lastActiveAt: NOW - 60_000 }), m('claude6'), m('claude3')], NOW)).toEqual([])
    expect(chainStep(c, [m('claude1', { state: 'esperando', lastActiveAt: NOW - 20 * 60_000 }), m('claude6'), m('claude3')], NOW)).toEqual([])
  })

  it('solapa: si a la que tiene el turno le queda poco, entra ya la siguiente y la saliente sigue con lo pequeño', () => {
    const c = wheel({ holder: 'claude1' as any, phase: 'trabaja' })
    const ms = [m('claude1', { state: 'trabajando', workingHere: true, fiveUsed: 92 }), m('claude6'), m('claude3', { state: 'sin-uso' })]
    expect(chainStep(c, ms, NOW)).toEqual([{ kind: 'solapar', from: 'claude1', to: 'claude6' }])
    expect(chainStep({ ...c, overlap: false }, ms, NOW)).toEqual([])
    // The week has a later mark: at 92 % of the week there are still hours left; at 97 %, or 15 min left, it is time.
    const at = (x: object) => chainStep(c, [m('claude1', { state: 'trabajando', workingHere: true, ...x }), m('claude6'), m('claude3', { state: 'sin-uso' })], NOW)
    expect(at({ weekUsed: 92 })).toEqual([])
    expect(at({ weekUsed: 97 })).toEqual([{ kind: 'solapar', from: 'claude1', to: 'claude6' }])
    expect(at({ fiveUsed: 40, minutesLeft: 15 })).toEqual([{ kind: 'solapar', from: 'claude1', to: 'claude6' }])
    // During the overlap both work and nobody is told to wait; when the outgoing one runs out, the overlap ends.
    const during = { ...c, holder: 'claude6' as any, outgoing: 'claude1' as any }
    expect(chainStep(during, [m('claude1', { state: 'trabajando', workingHere: true, fiveUsed: 97 }), m('claude6', { state: 'trabajando', workingHere: true }), m('claude3', { state: 'sin-uso' })], NOW)).toEqual([])
    expect(chainStep(during, [m('claude1', { state: 'sin-uso' }), m('claude6', { state: 'trabajando', workingHere: true }), m('claude3', { state: 'sin-uso' })], NOW)).toEqual([{ kind: 'fin-solape', account: 'claude1', holder: 'claude6' }])
  })

  it('apagada no hace nada', () => {
    expect(chainStep(wheel({ on: false }), [m('claude1')], NOW)).toEqual([])
  })

  it('dice quién seguiría y cuándo', () => {
    const c = wheel({ holder: 'claude1' as any })
    expect(nextInLine(c, [m('claude1'), m('claude6', { state: 'sin-uso', backAt: NOW + 3600_000 }), m('claude3', { state: 'sin-uso', backAt: NOW + 7200_000 })], NOW)).toEqual({ id: 'claude6', at: NOW + 3600_000 })
    expect(nextInLine(c, [m('claude1'), m('claude6', { state: 'sin-uso' }), m('claude3')], NOW)).toEqual({ id: 'claude3' })
    const v = memberViews(c, [m('claude1', { workingHere: true, state: 'trabajando' }), m('claude6', { state: 'sin-uso', backAt: NOW + 1 }), m('claude3')], NOW)
    expect(v.map((x) => x.status)).toEqual(['lista', 'turno', 'sin-uso'])
  })

  it('una cuenta solo puede estar en una rueda encendida', () => {
    const chains = { a: wheel(), b: wheel({ on: false, order: ['claude1'] as any }) }
    expect(wheelsOf(chains, 'claude1' as any)).toEqual(['a'])
    expect(wheelsOf(chains, 'claude1' as any, 'a')).toEqual([])
  })

  it('los ganchos saben de quién es el turno según la carpeta', () => {
    const file = { at: NOW, projects: [{ id: 'fp', name: 'Juego de prueba', roots: ['C:\\Users\\P\\Downloads\\Juego'], holder: 'claude1' as any, phase: 'trabaja' as const, members: ['claude3', 'claude1', 'claude6'] as any }] }
    expect(turnFor(file, 'claude3' as any, 'C:/Users/P/Downloads/Juego/.claude/worktrees/rachas')).toMatchObject({ inWheel: true, mine: false, holder: 'claude1' })
    expect(turnFor(file, 'claude1' as any, 'C:\\Users\\P\\Downloads\\Juego')).toMatchObject({ inWheel: true, mine: true })
    expect(turnFor(file, 'claude4' as any, 'C:\\Users\\P\\Downloads\\Juego')).toEqual({ inWheel: false })
    expect(turnFor(file, 'claude3' as any, 'C:\\Users\\P\\Downloads\\JuegoGY')).toEqual({ inWheel: false })
    // Waiting for anyone to be back: whoever is back may go on.
    expect(turnFor({ ...file, projects: [{ ...file.projects[0], phase: 'espera' }] }, 'claude3' as any, 'C:\\Users\\P\\Downloads\\Juego')).toMatchObject({ mine: true })
  })

  it('la agenda se da por hecha cuando su sección no tiene nada abierto, nunca si no la encuentra', () => {
    const until = { section: 'Rediseño general', next: 'juego' }
    expect(agendaDone(until, [{ section: 'Rediseño general (13-11)', open: false }, { section: 'Fase 6', open: true }])).toBe(true)
    expect(agendaDone(until, [{ section: 'Rediseño general (13-11)', open: true }])).toBe(false)
    expect(agendaDone(until, [{ section: 'Otra', open: false }])).toBe(false)
    expect(agendaDone(undefined, [])).toBe(false)
    // EV148: blocked ones (waiting for something real) hold it only while skipBlocked is off; they are named when it moves.
    const rows = [{ section: 'Rediseño general (13-11)', open: false }, { section: 'Rediseño general, segunda vuelta', open: true, blocked: true, id: 'EV120' }]
    expect(agendaDone(until, rows)).toBe(false)
    expect(agendaDone(until, rows, { skipBlocked: true })).toBe(true)
    expect(agendaDone(until, [...rows, { section: 'Rediseño general (13-11)', open: true }], { skipBlocked: true })).toBe(false)
    expect(agendaBlocked(until, rows)).toEqual(['EV120'])
    const file = { at: NOW, projects: [{ id: 'mc', name: 'MC', roots: ['C:\\x'], holder: 'claude1' as any, members: ['claude1', 'claude6'] as any }] }
    expect(wheelProjectOf(file, 'claude6' as any)).toBe('mc')
    expect(wheelProjectOf(file, 'claude3' as any)).toBeUndefined()
  })
})
