// MC-STOP (the user, 16-11): «cuando yo digo a un claude que pare, y sigue insistiendo en que trabajéis».
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountPaused, clearPause, isGoPrompt, isStopPrompt, keepGoing, pauseChange, pausedFor, readPauses, setPause } from '../src/core/autonomy'

describe('la orden de parar, dicha de cualquier forma (MC-STOP)', () => {
  it('reconoce las frases que el aviso no vio el 16-11', () => {
    for (const s of [
      '¿puedes parar un momento? quiero probar una cosa del pc… cuando te avise seguirás',
      'cuando puedas, te detienes en un punto seguro y dejas todo cerrado para poder usar yo el pc',
      'oye, para un momento',
      'deja de trabajar, que voy a jugar',
      'descansa un rato',
      'no hagas nada hasta que te avise',
      'quiero que pares ya',
      'termina lo que tienes y para.',
      'no sigas',
      'Podrías detenerte?',
      'ya basta por hoy',
      'can you stop for a moment?',
      'Stop.'
    ]) expect(isStopPrompt(s), s).toBe(true)
  })

  it('no confunde con una orden de parar lo que no lo es', () => {
    for (const s of [
      'para que funcione el relevo, revisa el gancho',
      'parar el bot cuando pierde la partida',
      'comparar las dos versiones',
      'parametriza el aviso',
      'trabaja sin parar hasta que te quedes sin uso',
      'no quiero que pares',
      'no te detengas',
      'haz la tarea y para ello usa Blender',
      'deja de usar sed en los guiones',
      'don\'t stop working'
    ]) expect(isStopPrompt(s), s).toBe(false)
  })

  it('«sigue» la reanuda, pero no si es negación ni dentro de una orden de parar', () => {
    expect(isGoPrompt('sigue')).toBe(true)
    expect(isGoPrompt('ya puedes seguir con lo tuyo')).toBe(true)
    expect(isGoPrompt('Continúa')).toBe(true)
    expect(pauseChange('para un momento, luego sigues')).toBe('pausa')
    expect(pauseChange('sigue con lo tuyo')).toBe('sigue')
    expect(pauseChange('¿qué estabas haciendo?')).toBeUndefined()
    // What the app itself types into a window neither pauses nor lifts a pause.
    expect(pauseChange('Mission Control: el usuario ha respondido en Decidir. Míralo y sigue.')).toBeUndefined()
  })
})

describe('la pausa es de esa ventana (MC-STOP)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pmc-pausa-')), 'pausas.json')
  it('dura hasta «sigue», solo para esa sesión, y el aviso deja terminar mientras', () => {
    setPause({ account: 'claude3', sessionId: 's1', at: Date.now(), why: 'para' }, file)
    const list = readPauses(file)
    expect(pausedFor(list, 's1', 'claude3')).toBeDefined()
    expect(pausedFor(list, 's2', 'claude3')).toBeUndefined()
    expect(pausedFor(list, 's9', 'claude1')).toBeUndefined()
    expect(accountPaused('claude3', list)).toBe(true)
    expect(keepGoing({ autonomous: true, next: ['EV4 algo'], blocks: [], paused: true })).toBeUndefined()
    expect(keepGoing({ autonomous: true, next: ['EV4 algo'], blocks: [], paused: false })).toBeDefined()
    expect(clearPause('s1', 'claude3', file)).toBe(true)
    expect(readPauses(file)).toHaveLength(0)
  })

  it('un turno nuevo de la rueda quita todas las pausas de esa cuenta', () => {
    setPause({ account: 'claude3', sessionId: 's1', at: Date.now() }, file)
    setPause({ account: 'claude1', sessionId: 's5', at: Date.now() }, file)
    expect(clearPause(undefined, 'claude3', file, true)).toBe(true)
    expect(accountPaused('claude3', readPauses(file))).toBe(false)
    expect(accountPaused('claude1', readPauses(file))).toBe(true)
  })
})
