// 14-11: worktrees made for a moment (another Claude's scratchpad, the public export in %TEMP%\mc-limpia) became Mission
// Control's «work copy» (their RELEVO.md was the newest), and «Poner a trabajar» and the Claudes inside the app (EV156)
// opened in a temporary folder.
import { describe, expect, it } from 'vitest'
import { isScratchCopy } from '../src/core/projects'

describe('copias que no son del proyecto', () => {
  const tmp = 'C:\\Users\\U\\AppData\\Local\\Temp'
  const root = 'C:\\Users\\U\\Downloads\\Pakitron Mission Control'
  it('lo que se saca un momento en la carpeta temporal o en la de una sesión de Claude no es una copia', () => {
    expect(isScratchCopy('C:\\Users\\U\\AppData\\Local\\Temp\\claude\\d6ea\\dc93\\scratchpad\\wt-head', tmp, root)).toBe(true)
    expect(isScratchCopy('C:\\Users\\U\\AppData\\Local\\Temp\\mc-limpia', tmp, root)).toBe(true)
    expect(isScratchCopy('D:\\otra\\scratchpad\\wt', tmp, root)).toBe(true)
  })
  it('las de verdad, sí', () => {
    expect(isScratchCopy('C:\\Users\\U\\Downloads\\Game\\.claude\\worktrees\\feature', tmp, root)).toBe(false)
    expect(isScratchCopy('D:\\proyectos\\scratchpads\\juego', tmp, root)).toBe(false)
  })
  it('un proyecto que vive en la carpeta temporal conserva sus copias allí (las pruebas)', () => {
    expect(isScratchCopy('C:\\Users\\U\\AppData\\Local\\Temp\\pmc-test-abc\\copia', tmp, 'C:\\Users\\U\\AppData\\Local\\Temp\\pmc-test-abc\\repo')).toBe(false)
  })
})
