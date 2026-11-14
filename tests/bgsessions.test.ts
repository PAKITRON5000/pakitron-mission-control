// EV141: reading `claude agents --json` and the orders for background sessions, with what the real test printed (13-11).
import { describe, it, expect } from 'vitest'
import { bgResumeArgs, bgStartArgs, bgStateOf, parseAgents } from '../src/core/bgsessions'

const REAL = JSON.stringify([
  { pid: 44516, cwd: 'C:\\p', kind: 'interactive', startedAt: 1, sessionId: '40c749d9-ff00-4563-a97a-c4ca881bcacc', name: 'pakitron-mission-control-78', status: 'busy' },
  { pid: 11584, id: '1a1e8f38', cwd: 'C:\\p', kind: 'background', startedAt: 2, sessionId: '1a1e8f38-b36f-4ace-8d83-4578f31cd6bc', name: 'prueba-ev135', status: 'busy', state: 'working' },
  { pid: 50156, id: 'd0622fb5', cwd: 'C:\\p', kind: 'background', sessionId: 'd0622fb5-8aea-4814-8666-93c6e49a4dc1', name: 'prueba-ev136', status: 'idle', state: 'done' },
  { id: '8b3c838a', cwd: 'C:\\p', kind: 'background', sessionId: '8b3c838a-1109-40e7-b884-1862ee5e00e0', name: 'prueba-ev136-otra', status: 'idle', state: 'blocked' },
  { id: '9830a53f', cwd: 'C:\\otro', kind: 'background', sessionId: '9830a53f-358f-485d-9b2c-568a67f6cbf0', name: 'Juego', state: 'done' }
])

describe('sesiones de fondo (EV141)', () => {
  it('lee solo las de fondo y dice cómo está cada una', () => {
    const list = parseAgents(REAL)
    expect(list.map((s) => s.id)).toEqual(['1a1e8f38', 'd0622fb5', '8b3c838a', '9830a53f'])
    expect(list.map((s) => bgStateOf(s))).toEqual(['trabajando', 'terminada', 'espera', 'parada'])
    // «blocked» is the usage limit only when the account is out of usage (14-11: one with usage ended asking, also blocked).
    expect(bgStateOf(list[2], true)).toBe('sin-uso')
    expect(parseAgents('no es json')).toEqual([])
  })
  it('abre con nombre y modelo, y retoma la misma conversación sin más opciones', () => {
    // Where it was opened, not in a worktree of its own (the next account carries on in the same files).
    const stay = ['--settings', '{"worktree":{"bgIsolation":"none"}}']
    expect(bgStartArgs({ name: 'Mission Control · EV141', prompt: 'sigue', model: 'opus' })).toEqual(['--bg', '--name', 'Mission Control · EV141', '--model', 'opus', ...stay, 'sigue'])
    expect(bgStartArgs({ name: 'p', prompt: 'x', extra: ['--permission-mode', 'auto'] })).toEqual(['--bg', '--name', 'p', ...stay, '--permission-mode', 'auto', 'x'])
    expect(bgStartArgs({ name: 'p', prompt: 'x', isolate: true })).toEqual(['--bg', '--name', 'p', 'x'])
    expect(bgResumeArgs('1a1e8f38-b36f-4ace-8d83-4578f31cd6bc', 'segundo')).toEqual(['--bg', '--resume', '1a1e8f38-b36f-4ace-8d83-4578f31cd6bc', 'segundo'])
    expect(() => bgResumeArgs('x; rm -rf', 'a')).toThrow()
  })
})
