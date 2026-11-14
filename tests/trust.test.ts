import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureTrusted, isTrusted, projectFolders, trustKey, trustEverywhere } from '../src/core/trust'

describe('carpetas de confianza (EV103)', () => {
  it('escribe la ruta como Claude Code', () => {
    expect(trustKey('C:\\Users\\ana\\Downloads\\Pakitron Mission Control\\')).toBe('C:/Users/ana/Downloads/Pakitron Mission Control')
    expect(trustKey('/c/Users/ana/Downloads/Juego')).toBe('C:/Users/ana/Downloads/Juego')
    expect(trustKey('b:\\Video')).toBe('B:/Video')
    expect(trustKey('B:\\')).toBe('B:/')
  })

  it('una carpeta de confianza cubre las de dentro', () => {
    const projects = { 'B:/': { hasTrustDialogAccepted: true }, 'B:/Video App': { hasTrustDialogAccepted: false } }
    expect(isTrusted(projects, 'B:\\Video')).toBe(true)
    expect(isTrusted(projects, 'B:\\Video App\\src')).toBe(true)
    expect(isTrusted({ 'C:/Users/ana': { hasTrustDialogAccepted: false } }, 'C:\\Users\\ana\\Downloads\\X')).toBe(false)
    expect(isTrusted(undefined, 'C:\\X')).toBe(false)
  })

  it('añade la marca sin tocar lo demás y solo escribe si cambia algo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-trust-'))
    const file = join(dir, '.claude.json')
    const before = {
      numStartups: 41,
      oauthAccount: { emailAddress: 'a@b.c' },
      projects: {
        'C:/Users/X/Juego': { hasTrustDialogAccepted: true, allowedTools: ['Bash'] },
        'C:/Users/X/Lab': { hasTrustDialogAccepted: false, lastSessionId: 'abc', allowedTools: ['Read'] }
      }
    }
    writeFileSync(file, JSON.stringify(before, null, 2))
    const r = ensureTrusted(file, ['C:\\Users\\X\\Juego\\.claude\\worktrees\\rachas', 'C:\\Users\\X\\Lab', 'C:\\Users\\X\\Mission Control'])
    // the copy inside a trusted folder gets its own mark too: Claude Code asked under a trusted «B:/» (13-11)
    expect(r.added).toEqual(['C:/Users/X/Juego/.claude/worktrees/rachas', 'C:/Users/X/Lab', 'C:/Users/X/Mission Control'])
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after.numStartups).toBe(41)
    expect(after.oauthAccount.emailAddress).toBe('a@b.c')
    expect(after.projects['C:/Users/X/Juego']).toEqual(before.projects['C:/Users/X/Juego'])
    expect(after.projects['C:/Users/X/Lab']).toEqual({ ...before.projects['C:/Users/X/Lab'], hasTrustDialogAccepted: true })
    expect(after.projects['C:/Users/X/Mission Control'].hasTrustDialogAccepted).toBe(true)
    expect(after.projects['C:/Users/X/Mission Control'].allowedTools).toEqual([])
    expect(after.projects['C:/Users/X/Juego/.claude/worktrees/rachas'].hasTrustDialogAccepted).toBe(true)
    expect(ensureTrusted(file, ['B:\\Video']).added).toEqual(['B:/Video'])
    // second time: nothing to add, nothing written, no side files left
    expect(ensureTrusted(file, ['C:\\Users\\X\\Lab']).added).toEqual([])
    expect(readdirSync(dir)).toEqual(['.claude.json'])
  })

  it('no rompe un archivo que no se lee ni crea uno que no existe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-trust-'))
    const bad = join(dir, '.claude.json')
    writeFileSync(bad, '{ "projects": {')
    expect(ensureTrusted(bad, ['C:\\X']).skipped).toBeTruthy()
    expect(readFileSync(bad, 'utf8')).toBe('{ "projects": {')
    const none = join(dir, 'otra', '.claude.json')
    expect(ensureTrusted(none, ['C:\\X']).skipped).toBeTruthy()
    expect(existsSync(none)).toBe(false)
  })

  it('el barrido marca las carpetas de los proyectos en cada cuenta', () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-trust-'))
    const root = join(base, 'Proyecto'); const copy = join(base, 'Proyecto-copia')
    mkdirSync(root); mkdirSync(copy)
    const folders = projectFolders([{ root, copies: [{ path: copy }, { path: join(base, 'no-existe') }] }])
    expect(folders).toEqual([root, copy])
    const acc = join(base, '.claude-quinta'); mkdirSync(acc)
    writeFileSync(join(acc, '.claude.json'), '{}')
    const out = trustEverywhere([{ id: 'claude5', configDir: acc }], folders)
    expect(out[0].account).toBe('claude5')
    expect(out[0].added).toEqual([trustKey(root), trustKey(copy)])
  })
})
