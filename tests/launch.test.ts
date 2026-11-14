import { describe, expect, it } from 'vitest'
import { launchRefusal, scheduleAfterLaunch } from '../src/core/coord'
import type { AgentCard, LiveSession } from '../src/core/types'

const NOW = 1_000_000
const session = (over: Partial<LiveSession>): LiveSession => ({ sessionId: 's', shortId: 's', cwd: 'C:/x', kind: 'interactive', projectId: 'p1', ...over })
const agent = (state: AgentCard['state'], sessions: LiveSession[] = []) => ({ id: 'claude2' as AgentCard['id'], state, sessions })

describe('Lanzar ahora: el arranque programado', () => {
  it('sin arranque programado no hay nada que hacer', () => {
    expect(scheduleAfterLaunch(undefined, 'p1', NOW)).toBe('nada')
  })
  it('en el mismo proyecto iba a hacer lo mismo: se quita', () => {
    expect(scheduleAfterLaunch({ at: NOW + 3600_000, projectId: 'p1' }, 'p1', NOW)).toBe('repetido')
  })
  it('en otro proyecto es otro trabajo: se queda', () => {
    expect(scheduleAfterLaunch({ at: NOW + 3600_000, projectId: 'p2' }, 'p1', NOW)).toBe('otro')
  })
  it('el que ya saltó solo se limpia, sea del proyecto que sea', () => {
    expect(scheduleAfterLaunch({ at: NOW - 1, projectId: 'p2' }, 'p1', NOW)).toBe('caducado')
  })
})

describe('Lanzar ahora: cuándo no se deja', () => {
  it('una cuenta con uso y sin sesiones puede lanzarse', () => {
    expect(launchRefusal(agent('disponible'), 'p1')).toBeUndefined()
  })
  it('sin uso no se lanza: gastaría una ventana para nada', () => {
    expect(launchRefusal(agent('sin-uso'), 'p1')).toContain('no tiene uso')
  })
  it('trabajando ya en este proyecto no se lanza otra: gastaría el doble', () => {
    expect(launchRefusal(agent('trabajando', [session({ status: 'busy' })]), 'p1')).toContain('ya está trabajando')
  })
  it('una ventana abierta sin hacer nada no impide lanzar', () => {
    expect(launchRefusal(agent('esperando', [session({ status: 'idle' })]), 'p1')).toBeUndefined()
  })
  it('trabajando en otro proyecto no impide lanzar en este', () => {
    expect(launchRefusal(agent('trabajando', [session({ status: 'busy', projectId: 'p2' })]), 'p1')).toBeUndefined()
  })
})

describe('Lanzar ahora: lo que no es estar trabajando', () => {
  it('una sesión en segundo plano que terminó y espera un mensaje no impide lanzar', () => {
    expect(launchRefusal(agent('disponible', [session({ kind: 'background', state: 'blocked' })]), 'p1')).toBeUndefined()
  })
  it('una en segundo plano que sigue en marcha, sí', () => {
    expect(launchRefusal(agent('trabajando', [session({ kind: 'background', state: 'running' })]), 'p1')).toContain('ya está trabajando')
  })
  it('el usuario puede pedir otra ventana aunque esté trabajando', () => {
    expect(launchRefusal(agent('trabajando', [session({ status: 'busy' })]), 'p1', true)).toBeUndefined()
  })
  it('pero sin uso no se puede, ni pidiéndolo', () => {
    expect(launchRefusal(agent('sin-uso'), 'p1', true)).toContain('no tiene uso')
  })
})
