import { describe, expect, it } from 'vitest'
import { understand, timeRange, planRequest, answerDid, answerWaiting, answerUsage, answerWho, answerPhotos, answerTasks, answerWheel, sentText, norm, type AgentInfo } from '../src/core/assistant'

const projects = [{ id: 'juego', name: 'Juego de prueba' }, { id: 'mission-control', name: 'Mission Control' }, { id: 'laboratorio', name: 'Laboratorio de prueba' }]
const accounts = [{ id: 'claude1' }, { id: 'claude3' }, { id: 'claude6' }]
const ctx = { projects, accounts }
// 13-11-2026 02:30, local time.
const NOW = new Date(2026, 10, 13, 2, 30).getTime()
const u = (t: string) => understand(t, ctx, NOW)

describe('understand (EV85)', () => {
  it('tells the questions the user asked for apart', () => {
    expect(u('¿Qué me espera?').intent).toBe('espera')
    expect(u('¿quién trabaja ahora?').intent).toBe('quien')
    expect(u('¿Cuánto uso queda?').intent).toBe('uso')
    expect(u('fotos del Glaciar')).toMatchObject({ intent: 'fotos', topic: 'glaciar' })
    expect(u('enséñame las imágenes de Juego de prueba')).toMatchObject({ intent: 'fotos', topic: '', projectId: 'juego' })
    const did = u('¿Qué hizo Claude 3 anoche?')
    expect(did).toMatchObject({ intent: 'hizo', account: 'claude3' })
    expect(did.range?.label).toBe('anoche')
    expect(u('¿cómo va la rueda?').intent).toBe('rueda')
    expect(u('¿En qué va EV85?')).toMatchObject({ intent: 'tareas', taskId: 'EV85' })
    expect(u('¿qué queda en el laboratorio?')).toMatchObject({ intent: 'tareas', projectId: 'laboratorio' })
    expect(u('hola').intent).toBe('ayuda')
    expect(u('gracias').intent).toBe('gracias')
  })

  it('takes orders as requests, and a question that only sounds like one stays a question', () => {
    expect(u('Arregla la foto del glaciar en Juego de prueba')).toMatchObject({ intent: 'pedido', projectId: 'juego' })
    expect(u('que Claude 6 mire el menú de pausa')).toMatchObject({ intent: 'pedido', account: 'claude6' })
    expect(u('el botón de pausa no funciona en el móvil').intent).toBe('pedido')
    expect(u('¿puedes decirme qué hace Claude 1?').intent).toBe('quien')
    expect(u('¿cuál es la capital de Francia?').intent).toBe('nose')
  })

  it('knows a Claude by the name the user gave it (EV99)', () => {
    expect(understand('¿qué hace Pakitrón?', { projects, accounts: [{ id: 'claude3', name: 'Pakitrón', alias: 'cuenta3' }] }, NOW)).toMatchObject({ intent: 'quien', account: 'claude3' })
  })

  it('does not read «claude3» as a task id', () => {
    expect(u('¿qué hace claude3?').taskId).toBeUndefined()
  })
})

describe('timeRange', () => {
  it('«anoche» at 02:30 runs from 20:00 until now; «ayer» is the whole day', () => {
    const r = timeRange(norm('anoche'), NOW)!
    expect(new Date(r.from).getHours()).toBe(20)
    expect(new Date(r.from).getDate()).toBe(12)
    expect(r.to).toBe(NOW)
    const y = timeRange('ayer', NOW)!
    expect(new Date(y.from).getDate()).toBe(12)
    expect(y.to - y.from).toBe(24 * 3600_000)
    expect(timeRange('ultimas 3 horas', NOW)!.from).toBe(NOW - 3 * 3600_000)
  })
})

const agent = (id: string, x: Partial<AgentInfo> = {}): AgentInfo => ({ id, state: 'disponible', windows: [], ...x })

describe('planRequest: to whom and when', () => {
  const base = { text: 'arregla el menú', kind: 'correccion', project: { id: 'mission-control', name: 'Mission Control' }, now: NOW }
  it('the holder of the turn, working there, sees it at its next step', () => {
    const r = planRequest({ ...base, holder: 'claude3', agents: [agent('claude3', { state: 'trabajando', windows: [{ projectId: 'mission-control', working: true }] })] })
    expect(r.send).toMatchObject({ target: 'claude3', start: false, kind: 'correccion' })
    expect(r.text).toContain('tiene el turno en Mission Control')
    expect(r.send!.when).toContain('próximo paso')
  })
  it('one out of usage is not waited for: the first that works there takes it', () => {
    const r = planRequest({ ...base, holder: 'claude1', agents: [agent('claude1', { state: 'sin-uso', backAt: NOW + 2 * 3600_000 })] })
    expect(r.send!.target).toBeUndefined()
    expect(r.text).toBe('Lo apunto como corrección en Mission Control. Claude 1 está sin uso hasta las 04:30: lo verá el primer Claude que trabaje en Mission Control.')
    expect(r.send!.when).toContain('sin uso hasta las 04:30')
  })
  it('a free one is opened there; one named by the user goes first', () => {
    const r = planRequest({ ...base, named: 'claude6', holder: 'claude3', agents: [agent('claude6'), agent('claude3', { state: 'trabajando', windows: [{ projectId: 'mission-control', working: true }] })] })
    expect(r.send).toMatchObject({ target: 'claude6', start: true })
    expect(r.text).toContain('es a quien nombras')
  })
  it('an idea is kept, not sent', () => {
    const r = planRequest({ ...base, kind: 'idea', agents: [] })
    expect(r.send).toMatchObject({ kind: 'idea', start: false })
    expect(sentText(r.send!)).toContain('Ideas')
  })
})

describe('answers', () => {
  it('what Claude 3 did last night: tasks it reserved, its commits and its limit', () => {
    const range = timeRange('anoche', NOW)!
    const at = (h: number, m = 0) => new Date(2026, 10, h < 12 ? 13 : 12, h, m).getTime()
    const r = answerDid({
      account: 'claude3', range, projects, now: NOW,
      claims: [{ ref: 'EV79', account: 'claude3', at: at(23) }, { ref: 'EV76', account: 'claude6', at: at(23) }],
      events: [
        { at: at(1, 10), kind: 'tarea-hecha', title: 'EV79 · Decisiones: marcada como hecha', ref: 'EV79', projectId: 'mission-control' },
        { at: at(1, 20), kind: 'tarea-hecha', title: 'EV76 · Compactar: marcada como hecha', ref: 'EV76', projectId: 'mission-control' },
        { at: at(1, 30), kind: 'commit', title: 'Punto de control (claude3): EV79', projectId: 'mission-control' },
        { at: at(1, 40), kind: 'commit', title: 'Punto de control (claude6): EV76', projectId: 'mission-control' },
        { at: at(2, 0), kind: 'limite', account: 'claude3', title: 'Claude 3 se ha parado: rate_limit', projectId: 'mission-control' },
        { at: at(18), kind: 'commit', title: 'Punto de control (claude3): de la tarde', projectId: 'mission-control' }
      ]
    })
    expect(r.text).toContain('terminó 1 tarea (EV79)')
    expect(r.text).toContain('1 commit')
    expect(r.text).toContain('Se quedó sin uso a las 02:00')
    expect(r.text).not.toContain('EV76')
  })

  it('what waits: the questions first, in every project', () => {
    const r = answerWaiting([
      { id: 'mission-control', name: 'Mission Control', decisions: [{ id: 130, title: 'Recarga', askedBy: 'claude3', at: NOW - 60_000 }], review: [], comments: 0 },
      { id: 'juego', name: 'Juego de prueba', decisions: [], review: [{ id: 5, extId: 'PJ1', title: 'Carretilla' }], comments: 2 }
    ], ['claude5'], NOW)
    expect(r.text).toBe('Te esperan 1 pregunta en Decidir (Mission Control), 1 tarea terminada para revisar (Juego de prueba), 2 correcciones en Revisar y una cosa que solo puedes pulsar tú. Lo primero, las preguntas: hay Claude esperando tu respuesta.')
    expect(r.rows![0].go).toEqual({ route: 'decisiones', projectId: 'mission-control', focus: { kind: 'decision', id: 130 } })
    expect(answerWaiting([], [], NOW).text).toContain('Nada te espera')
  })

  it('usage: a window already reset counts as full, an account out says when it is back', () => {
    const r = answerUsage([
      agent('claude3', { week: { used: 41, resetsAt: NOW + 86400_000 }, five: { used: 90, resetsAt: NOW - 1000 } }),
      agent('claude1', { state: 'sin-uso', backAt: NOW + 2 * 3600_000 }),
      agent('claude4', { out: 'pausada' })
    ], undefined, NOW)
    expect(r.rows).toHaveLength(2)
    expect(r.rows![0].sub).toBe('Le queda el 59 % de la semana y el 100 % de sus 5 horas')
    expect(r.text).toContain('Claude 1 (vuelve a las 04:30)')
  })

  it('who works, photos, tasks and the wheel answer in plain words', () => {
    const w = answerWho([agent('claude3', { state: 'trabajando', windows: [{ projectId: 'mission-control', working: true }], focus: { text: 'EV85', at: NOW - 60_000 } }), agent('claude1', { state: 'sin-uso', backAt: NOW + 3600_000 })], projects, undefined, NOW)
    expect(w.text).toBe('Trabaja Claude 3 en Mission Control; Claude 1 vuelve a las 03:30 (sin uso).')
    expect(answerPhotos('glaciar', [], 0).text).toContain('No encuentro imágenes con «glaciar»')
    expect(answerPhotos('glaciar', [{ id: 1, name: 'a.png', projectId: 'juego', projectName: 'Juego de prueba' }], 30).text).toContain('Hay 30 imágenes con «glaciar» en Juego de prueba; aquí tienes las 1 más nuevas')
    const t = answerTasks({ project: projects[1], projects, claims: [{ key: 'EV85', account: 'claude3' }], agenda: 'Rediseño',
      tasks: [{ id: 1, extId: 'EV85', title: 'Asistente', status: 'pendiente', section: 'Rediseño general', projectId: 'mission-control' }, { id: 2, extId: 'EV1', title: 'Vieja', status: 'terminada', projectId: 'mission-control' }] })
    expect(t.text).toContain('queda 1 tarea abierta')
    expect(t.rows![0].sub).toContain('la lleva Claude 3')
    expect(answerWheel(projects[1], undefined, [], NOW).text).toContain('está apagada')
  })
})
