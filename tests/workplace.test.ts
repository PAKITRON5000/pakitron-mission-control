// EV201: the project a Claude works in now, by what it touches (a window opened in Mission Control's folder working on
// VIDEO DOS is shown in VIDEO DOS).
import { describe, it, expect } from 'vitest'
import { commandPaths, workingProjectOf } from '../src/core/live'

describe('commandPaths', () => {
  it('finds the folders a command names, in quotes with spaces, bare, and Git Bash style', () => {
    expect(commandPaths('cd "B:\\VIDEO DOS" && python tools/check_finales.py --completo')).toEqual(['B:\\VIDEO DOS'])
    expect(commandPaths("ffmpeg -i 'D:\\Video\\in.mp4' C:\\out\\x.mp4")).toEqual(['D:\\Video\\in.mp4', 'C:\\out\\x.mp4'])
    expect(commandPaths('cd "/c/Users/ana/Downloads/MI JUEGO" && git status')).toEqual(['C:\\Users\\ana\\Downloads\\MI JUEGO'])
    expect(commandPaths('ls /b/VIDEODOS/renders | head')).toEqual(['B:\\VIDEODOS\\renders'])
  })
  it('leaves out what is not an absolute path: urls, relative paths, a bare drive', () => {
    expect(commandPaths('curl https://example.com/c/thing && cat src/c/d.ts && dir C:\\')).toEqual([])
    expect(commandPaths('npm test')).toEqual([])
  })
  it('keeps four at most', () => {
    expect(commandPaths('x C:\\a1 C:\\a2 C:\\a3 C:\\a4 C:\\a5')).toHaveLength(4)
  })
})

describe('workingProjectOf', () => {
  const roots: Record<string, string> = { mc: 'c:\\users\\p\\downloads\\pakitron mission control', iv: 'b:\\video dos' }
  const projectOf = (p: string) => {
    const k = p.toLowerCase().replace(/\//g, '\\')
    return Object.keys(roots).find((id) => k === roots[id] || k.startsWith(roots[id] + '\\'))
  }
  const now = 1_000_000_000
  it('the most touched of its last six, inside a project', () => {
    const touches = [
      { at: now - 1000, path: 'C:\\Users\\P\\Downloads\\Pakitron Mission Control\\docs\\RELEVO.md' },
      { at: now - 2000, path: 'B:\\VIDEO DOS\\tools\\check.py' },
      { at: now - 3000, path: 'B:\\VIDEO DOS' },
      { at: now - 4000, path: 'C:\\Users\\P\\.claude\\memory\\x.md' }
    ]
    expect(workingProjectOf(touches, projectOf, now)).toBe('iv')
  })
  it('on a tie, the latest', () => {
    expect(workingProjectOf([{ at: now - 2000, path: 'B:\\VIDEO DOS\\a' }, { at: now - 1000, path: 'C:\\Users\\P\\Downloads\\Pakitron Mission Control\\b' }], projectOf, now)).toBe('mc')
  })
  it('nothing of a project lately: undefined (its window\'s folder says it)', () => {
    expect(workingProjectOf([{ at: now - 3600_000, path: 'B:\\VIDEO DOS\\a' }], projectOf, now)).toBeUndefined()
    expect(workingProjectOf([{ at: now - 1000, path: 'D:\\elsewhere\\a' }], projectOf, now)).toBeUndefined()
    expect(workingProjectOf(undefined, projectOf, now)).toBeUndefined()
  })
})
