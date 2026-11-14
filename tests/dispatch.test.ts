// The one gate for automatic windows: one window per account, a cap per project, nothing for accounts set aside.
import { describe, it, expect } from 'vitest'
import { decideLaunch, workingMap, OPEN_COOLDOWN_MS, type AccountWindow } from '../src/core/dispatch'

const now = 1_000_000_000
const win = (account: string, projectId: string, working: boolean, pid = 100): AccountWindow => ({ account: account as any, sessionId: `${account}-${projectId}`, pid, projectId, working })
const world = (windows: AccountWindow[], extra: Partial<Parameters<typeof decideLaunch>[1]> = {}) =>
  ({ windows, status: {}, workingOn: workingMap(windows), maxPerProject: 1, lastOpened: {}, now, ...extra })

describe('one gate for automatic windows', () => {
  it('12-11, 06:03: the start scheduled for claude3 does not open a second window while its first works there', () => {
    const d = decideLaunch({ account: 'claude3', projectId: 'mission-control', reason: 'arranque' }, world([win('claude3', 'mission-control', true)]))
    expect(d.action).toBe('nada')
    expect(d.why).toContain('ya está trabajando en su ventana')
  })

  it('an account with its window idle on the project is told there, not opened again', () => {
    const d = decideLaunch({ account: 'claude1', projectId: 'juego', reason: 'vuelta' }, world([win('claude1', 'juego', false, 4242)]))
    expect(d).toMatchObject({ action: 'avisar', pid: 4242 })
  })

  it('an account with a window on another project is left there: one account, one window', () => {
    const d = decideLaunch({ account: 'claude1', projectId: 'mission-control', reason: 'relevo' }, world([win('claude1', 'laboratorio', false)]))
    expect(d.action).toBe('nada')
    expect(d.why).toContain('una cuenta, una ventana')
  })

  it('a project with someone working gets nobody else unless the user raised the cap', () => {
    const ws = [win('claude6', 'juego', true)]
    expect(decideLaunch({ account: 'claude5', projectId: 'juego', reason: 'reparto' }, world(ws)).why).toContain('ya trabaja Claude 6')
    expect(decideLaunch({ account: 'claude5', projectId: 'juego', reason: 'reparto' }, world(ws, { maxPerProject: 2 })).action).toBe('abrir')
  })

  it('never an account set aside or unpaid, and not twice within the cooldown', () => {
    expect(decideLaunch({ account: 'claude4', projectId: 'p', reason: 'relevo' }, world([], { status: { claude4: 'pausada' } })).why).toContain('No usar')
    expect(decideLaunch({ account: 'claude2', projectId: 'p', reason: 'relevo' }, world([], { status: { claude2: 'baja' } })).why).toContain('de baja')
    expect(decideLaunch({ account: 'claude5', projectId: 'p', reason: 'relevo' }, world([], { lastOpened: { claude5: now - 60_000 } })).action).toBe('nada')
    expect(decideLaunch({ account: 'claude5', projectId: 'p', reason: 'relevo' }, world([], { lastOpened: { claude5: now - OPEN_COOLDOWN_MS - 1 } })).action).toBe('abrir')
  })

  it('background sessions are not windows', () => {
    const bg = { ...win('claude3', 'juego', false), pid: undefined }
    expect(decideLaunch({ account: 'claude3', projectId: 'juego', reason: 'relevo' }, world([bg])).action).toBe('abrir')
  })
})
