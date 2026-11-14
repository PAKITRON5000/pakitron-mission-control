// EV129: what is only this PC's (the user's own game, a project's hook folder) lives in este-pc.json, not in the code.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandVars, limitDirs, thisPc } from '../src/core/thispc'
import { games, COMMON_GAMES, detectBusy } from '../src/core/resources'

beforeAll(() => { process.env.PMC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pmc-thispc-')) })

describe('este-pc.json', () => {
  it('without the file: no hook folders and only the common games', () => {
    expect(thisPc()).toEqual({})
    expect(limitDirs()).toEqual([])
    expect(games()).toEqual(COMMON_GAMES)
  })

  it("with it: the user's own game counts as playing, and its folders come with %VARIABLES% expanded", () => {
    writeFileSync(join(process.env.PMC_DATA_DIR!, 'este-pc.json'), '﻿' + JSON.stringify({ juegos: ['MiJuego.exe', ''], carpetasDeLimites: ['%LOCALAPPDATA%\\Avisos', ' '] }))
    expect(games()).toEqual([...COMMON_GAMES, 'MiJuego.exe'])
    expect(limitDirs()).toEqual([`${process.env.LOCALAPPDATA}\\Avisos`])
    const busy = detectBusy((cmd) => (cmd === 'tasklist' ? '"System","4"\r\n"MiJuego.exe","99"\r\n' : ''))
    expect(busy.playing).toBe('MiJuego.exe')
    expect(expandVars('%NO_EXISTE%\\x', {})).toBe('%NO_EXISTE%\\x')
  })
})
