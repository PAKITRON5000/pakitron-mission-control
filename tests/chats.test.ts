import { describe, it, expect } from 'vitest'
import { cleanUserText, limitInSpanish, parseChat } from '../src/core/chats'

const line = (o: any) => JSON.stringify({ timestamp: '2026-11-05T22:00:00Z', uuid: Math.random().toString(), ...o })
const user = (content: any, extra = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra })
const claude = (content: any, stop: string | null = 'end_turn') => line({ type: 'assistant', message: { role: 'assistant', content, stop_reason: stop } })

describe('parseChat', () => {
  it('keeps what was said and gathers the steps in between', () => {
    const text = [
      user('Arregla el reloj'),
      claude([{ type: 'text', text: 'Voy.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\a\\Hud.uss' } }], 'tool_use'),
      user([{ type: 'tool_result', content: 'mucho texto' }]),
      claude([{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\a\\Hud.uss' } }], 'tool_use'),
      user([{ type: 'tool_result', content: 'ok' }]),
      claude([{ type: 'text', text: 'Hecho.' }])
    ].join('\n')
    const { messages, midTurn } = parseChat(text, false, 50)
    expect(messages.map((m) => [m.role, m.text])).toEqual([['user', 'Arregla el reloj'], ['claude', 'Voy.'], ['claude', 'Hecho.']])
    expect(messages[1].steps).toBeUndefined()
    expect(messages[2].steps).toEqual(['Lee: Hud.uss', 'Edita: Hud.uss'])
    expect(midTurn).toBe(false)
  })

  it('shows the steps under way, and none once it has answered', () => {
    const start = [user('Compila'), claude([{ type: 'text', text: 'Voy.' }, { type: 'tool_use', name: 'Bash', input: { description: 'Compila el juego' } }], 'tool_use')]
    expect(parseChat(start.join('\n'), false, 50).live).toEqual(['Ejecuta: Compila el juego'])
    const done = [...start, user([{ type: 'tool_result', content: 'ok' }]), claude([{ type: 'text', text: 'Hecho.' }])]
    expect(parseChat(done.join('\n'), false, 50).live).toEqual([])
  })

  it('knows the question it is waiting on, and forgets it once answered', () => {
    const ask = claude([{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: '¿Cuál?', options: [{ label: 'A' }, { label: 'B' }] }] } }], 'tool_use')
    expect(parseChat(ask, false, 50).asking).toEqual({ question: '¿Cuál?', options: ['A', 'B'] })
    expect(parseChat([ask, user([{ type: 'tool_result', content: 'A' }])].join('\n'), false, 50).asking).toBeUndefined()
  })

  it('says when it is still in the middle of something', () => {
    expect(parseChat(claude([{ type: 'tool_use', name: 'Bash', input: { description: 'Compila' } }], 'tool_use'), false, 50).midTurn).toBe(true)
    expect(parseChat(user('Hola'), false, 50).midTurn).toBe(true)
  })

  it('is not in the middle of anything for what the harness adds or for an interruption', () => {
    const done = claude([{ type: 'text', text: 'Hecho.' }])
    expect(parseChat([done, user('<system-reminder>interno</system-reminder>')].join('\n'), false, 50).midTurn).toBe(false)
    expect(parseChat([done, user('[Request interrupted by user]')].join('\n'), false, 50).midTurn).toBe(false)
  })

  it('hides subagents, meta messages and broken lines, and a line cut by reading only the end', () => {
    const text = ['{"cut in hal', user('Secreto', { isSidechain: true }), user('Meta', { isMeta: true }), 'no json', user('Visible')].join('\n')
    expect(parseChat(text, true, 50).messages.map((m) => m.text)).toEqual(['Visible'])
  })

  it('removes what the harness adds to a message', () => {
    expect(cleanUserText('Hola<system-reminder>interno</system-reminder>')).toBe('Hola')
    expect(cleanUserText('<task-notification>x</task-notification>')).toBe('')
    expect(cleanUserText('<command-name>/clear</command-name><command-args></command-args>')).toBe('/clear')
  })

  it('keeps only the last messages', () => {
    const text = Array.from({ length: 10 }, (_, i) => user(`m${i}`)).join('\n')
    expect(parseChat(text, false, 3).messages.map((m) => m.text)).toEqual(['m7', 'm8', 'm9'])
  })
})

describe('el aviso de límite de Claude Code, en español (13-11)', () => {
  it('dice cuál y cuándo vuelve, en hora de 24', () => {
    expect(limitInSpanish("You've hit your 5-hour limit · resets 5:30pm (Europe/Madrid)")).toBe('Se quedó sin uso de las 5 horas · vuelve a las 17:30')
    expect(limitInSpanish("You've hit your weekly limit · resets 3pm (Europe/Madrid)")).toBe('Se quedó sin uso de la semana · vuelve a las 15:00')
    expect(limitInSpanish("You've hit your weekly limit · resets Nov 18, 1pm (Europe/Madrid)")).toBe('Se quedó sin uso de la semana · vuelve el 18 nov a las 13:00')
    expect(limitInSpanish("You've hit your limit · resets 1am")).toBe('Se quedó sin uso · vuelve a la 1:00')
    expect(limitInSpanish("You've hit your limit")).toBe('Se quedó sin uso')
  })
  it('lo demás no lo toca', () => {
    expect(limitInSpanish('He terminado EV44: you have hit your limit no es esto')).toBe('He terminado EV44: you have hit your limit no es esto')
  })
})
