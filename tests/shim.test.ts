// `pmc` as a bare word (EV35): two launchers in the user's command folder, never over someone else's `pmc`.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installNodeShim, installShims, shimReady, shimTexts } from '../src/core/shim'
import { nodeArgs } from '../src/main/service'

describe('pmc launchers', () => {
  it('writes pmc.cmd and pmc once, and says pmc is usable only when their folder is on the PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-shim-'))
    const mjs = 'C:\\Users\\x\\AppData\\Local\\PakitronMC\\bin\\pmc.mjs'
    expect(shimReady(mjs, dir, `C:\\Windows;${dir}`)).toBe(false)
    expect(installShims(mjs, dir)).toEqual(['pmc.cmd', 'pmc'])
    expect(installShims(mjs, dir)).toEqual([])
    expect(readFileSync(join(dir, 'pmc.cmd'), 'utf8')).toBe('@echo off\r\nnode "C:\\Users\\x\\AppData\\Local\\PakitronMC\\bin\\pmc.mjs" %*\r\n')
    expect(readFileSync(join(dir, 'pmc'), 'utf8')).toBe('#!/bin/sh\nexec node "C:/Users/x/AppData/Local/PakitronMC/bin/pmc.mjs" "$@"\n')
    expect(shimReady(mjs, dir, `C:\\Windows;${dir.toUpperCase()}\\`)).toBe(true)
    expect(shimReady(mjs, dir, 'C:\\Windows')).toBe(false)
  })

  it('a pmc that is not ours is left alone; one of ours with an old path is brought up to date', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-shim-'))
    writeFileSync(join(dir, 'pmc'), '#!/bin/sh\necho otro programa\n')
    writeFileSync(join(dir, 'pmc.cmd'), shimTexts('D:\\viejo\\pmc.mjs').cmd)
    expect(installShims('C:\\nuevo\\pmc.mjs', dir)).toEqual(['pmc.cmd'])
    expect(readFileSync(join(dir, 'pmc'), 'utf8')).toBe('#!/bin/sh\necho otro programa\n')
    expect(shimReady('C:\\nuevo\\pmc.mjs', dir, dir)).toBe(false)
  })

  it("on a PC without Node.js, pmc runs on the app's own program (EV126)", () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-shim-'))
    const shim = installNodeShim('C:\\Programas\\Mission Control.exe', join(dir, 'bin', 'node.cmd'))
    expect(readFileSync(shim, 'utf8')).toBe('@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Programas\\Mission Control.exe" %*\r\n')
    const t = shimTexts('C:\\datos\\bin\\pmc.mjs', shim)
    expect(t.cmd).toBe(`@echo off\r\n"${shim}" "C:\\datos\\bin\\pmc.mjs" %*\r\n`)
    expect(t.sh).toBe(`#!/bin/sh\nexec "${shim.split('\\').join('/')}" "C:/datos/bin/pmc.mjs" "$@"\n`)
    // Started by the app itself (a routine), the .cmd is skipped: its program, with the variable that makes it Node.
    expect(nodeArgs(shim, ['pmc.mjs', 'verifica'], { A: '1' })).toEqual({ file: process.execPath, args: ['pmc.mjs', 'verifica'], env: { A: '1', ELECTRON_RUN_AS_NODE: '1' } })
    expect(nodeArgs('C:\\node\\node.exe', ['x'], { A: '1' })).toEqual({ file: 'C:\\node\\node.exe', args: ['x'], env: { A: '1' } })
  })
})
