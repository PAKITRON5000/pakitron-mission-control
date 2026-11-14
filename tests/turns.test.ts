// Each account on its own project (12-11): who waits for heavy work, who is called back, and in which window.
import { describe, it, expect } from 'vitest'
import { heavyProjects, heavyTurns, shouldCallBack, relayModeOf, waitMessage, goMessage, RESUME_WINDOW_MS } from '../src/core/turns'

const projects = [
  { id: 'juego', roots: ['C:\\Users\\ana\\Downloads\\Juego'] },
  { id: 'lab', roots: ['C:\\Users\\ana\\Downloads\\Laboratorio de prueba'] },
  { id: 'mc', roots: ['C:\\Users\\ana\\Downloads\\Pakitron Mission Control'] }
]

describe('heavy work, by project', () => {
  it('a Unity or a Blender counts for the project its command line names, a copy inside it included', () => {
    const lines = [
      '"C:\\Program Files\\Unity\\Hub\\Editor\\6000.3.9f1\\Editor\\Unity.exe" -projectPath "C:\\Users\\ana\\Downloads\\Juego\\.claude\\worktrees\\rachas" -batchmode',
      '"C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --python C:/Users/ana/Downloads/Laboratorio de prueba/scenes/render.py'
    ]
    expect(heavyProjects(lines, projects).sort()).toEqual(['juego', 'lab'])
    // A program started from nowhere known counts for nobody: never a guess.
    expect(heavyProjects(['"C:\\Program Files\\Unity\\Editor\\Unity.exe" -projectPath "D:\\otro"'], projects)).toEqual([])
  })
})

describe('heavy work by turns', () => {
  const now = 1_000_000_000
  it('the one that comes back while another project has heavy work running is told to keep to light work or wait', () => {
    const a = heavyTurns({
      now,
      accounts: [{ id: 'claude1', projectId: 'lab', working: true }, { id: 'claude6', projectId: 'juego', working: true, resumedAt: now - 60_000 }],
      heavy: ['lab'],
      waiting: {}
    })
    expect(a).toEqual([{ kind: 'esperar', account: 'claude6', holder: 'claude1', projectId: 'juego', holderProjectId: 'lab' }])
  })

  it('both at work on light things: nobody waits; a comeback long ago has already chosen', () => {
    expect(heavyTurns({ now, accounts: [{ id: 'claude1', projectId: 'lab', working: true }, { id: 'claude6', projectId: 'juego', working: true, resumedAt: now - 60_000 }], heavy: [], waiting: {} })).toEqual([])
    expect(heavyTurns({ now, accounts: [{ id: 'claude1', projectId: 'lab', working: true }, { id: 'claude6', projectId: 'juego', working: true, resumedAt: now - RESUME_WINDOW_MS - 1 }], heavy: ['lab'], waiting: {} })).toEqual([])
  })

  it('heavy work of its own project never makes an account wait', () => {
    expect(heavyTurns({ now, accounts: [{ id: 'claude6', projectId: 'juego', working: true, resumedAt: now }], heavy: ['juego'], waiting: {} })).toEqual([])
  })

  it('the waiting one is told it is its turn once the holder ran out or let the heavy work go, and not before', () => {
    const waiting = { claude6: { since: now - 600_000, holder: 'claude1' as const, projectId: 'juego' } }
    const still = heavyTurns({ now, accounts: [{ id: 'claude1', projectId: 'lab', working: true }, { id: 'claude6', projectId: 'juego', working: false }], heavy: ['lab'], waiting })
    expect(still).toEqual([])
    const ranOut = heavyTurns({ now, accounts: [{ id: 'claude1', projectId: 'lab', working: false }, { id: 'claude6', projectId: 'juego', working: false }], heavy: ['lab'], waiting })
    expect(ranOut).toEqual([{ kind: 'seguir', account: 'claude6', projectId: 'juego', holder: 'claude1' }])
    const done = heavyTurns({ now, accounts: [{ id: 'claude1', projectId: 'lab', working: true }, { id: 'claude6', projectId: 'juego', working: false }], heavy: [], waiting })
    expect(done.map((x) => x.kind)).toEqual(['seguir'])
  })

  it('the messages say who has the heavy work, where, and what to do', () => {
    expect(waitMessage('claude1', 'Laboratorio de prueba')).toContain('Claude 1 está usando Unity o Blender en Laboratorio de prueba')
    expect(goMessage('claude1', 'Juego de prueba')).toContain('Sigue con tu trabajo en Juego de prueba')
  })
})

describe('calling a window back when its usage returns', () => {
  it('only if its conversation has not moved since it stopped; with joint relays, not if another took over the project', () => {
    expect(shouldCallBack({ stoppedAt: 1000, lastMovedAt: 500, mode: 'proyecto', othersOnProject: 1 })).toBe(true)
    expect(shouldCallBack({ stoppedAt: 1000, lastMovedAt: 120_000, mode: 'proyecto', othersOnProject: 0 })).toBe(false)
    expect(shouldCallBack({ stoppedAt: 1000, lastMovedAt: 500, mode: 'conjunto', othersOnProject: 1 })).toBe(false)
    expect(shouldCallBack({ stoppedAt: 1000, mode: 'conjunto', othersOnProject: 0 })).toBe(true)
  })

  it('the mode is the joint one unless the user chose one project each', () => {
    expect(relayModeOf({})).toBe('conjunto')
    expect(relayModeOf({ relayMode: 'proyecto' })).toBe('proyecto')
  })
})
