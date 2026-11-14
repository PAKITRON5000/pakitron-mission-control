import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAccounts } from '../src/core/accounts'

/** A home folder with accounts: `name` is the folder, `login` whether it has a session. */
function casa(cuentas: { name: string; login?: boolean; email?: string; launcher?: number }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pmc-cuentas-'))
  mkdirSync(join(dir, 'claude-accesos'))
  for (const c of cuentas) {
    const carpeta = join(dir, c.name)
    mkdirSync(carpeta)
    if (c.login) writeFileSync(join(carpeta, '.credentials.json'), '{}')
    if (c.email) writeFileSync(join(carpeta, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: c.email } }))
    if (c.launcher) writeFileSync(join(dir, 'claude-accesos', `claude${c.launcher}.cmd`), `@echo off\r\nset "CLAUDE_CONFIG_DIR=%USERPROFILE%\\${c.name}"\r\ncall claude %*\r\n`)
  }
  return dir
}

describe('Cuentas ya iniciadas en este PC', () => {
  it('encuentra las que tienen sesión, con el número de su lanzador', () => {
    const dir = casa([{ name: '.claude-sexta', login: true, email: 'seis@x.com', launcher: 6 }, { name: '.claude-quinta', login: true, launcher: 5 }])
    const r = detectAccounts([{ id: 'claude1', configDir: '' }], dir)
    expect(r.map((x) => x.id)).toEqual(['claude5', 'claude6'])
    expect(r[1]).toMatchObject({ alias: 'Sexta', email: 'seis@x.com', configDir: join(dir, '.claude-sexta') })
  })
  it('no enseña las que ya se siguen', () => {
    const dir = casa([{ name: '.claude-quinta', login: true, launcher: 5 }])
    expect(detectAccounts([{ id: 'claude5', configDir: join(dir, '.claude-quinta') }], dir)).toEqual([])
    expect(detectAccounts([{ id: 'claude5', configDir: join(dir, '.CLAUDE-QUINTA') + '\\' }], dir)).toEqual([])
  })
  it('no enseña carpetas sin sesión iniciada', () => {
    const dir = casa([{ name: '.claude-vacia', launcher: 7 }, { name: '.claude-otra' }])
    expect(detectAccounts([], dir)).toEqual([])
  })
  it('con withoutLogin da también las carpetas sin archivo de credenciales, marcadas, para preguntar a Claude Code (EV146: Console o pago por uso)', () => {
    const dir = casa([{ name: '.claude-console', launcher: 7 }, { name: '.claude-pro', login: true, launcher: 8 }])
    const r = detectAccounts([], dir, { withoutLogin: true })
    expect(r.map((x) => [x.id, x.signedIn])).toEqual([['claude7', false], ['claude8', undefined]])
  })
  it('encuentra también una carpeta sin lanzador, y entonces no impone número', () => {
    const dir = casa([{ name: '.claude-suelta', login: true }])
    const r = detectAccounts([], dir)
    expect(r).toHaveLength(1)
    expect(r[0].id).toBeUndefined()
    expect(r[0].alias).toBe('Suelta')
  })
  it('si el número ya está cogido por otra cuenta, no lo pide', () => {
    const dir = casa([{ name: '.claude-quinta', login: true, launcher: 5 }])
    const r = detectAccounts([{ id: 'claude5', configDir: join(dir, '.claude-otra') }], dir)
    expect(r[0].id).toBeUndefined()
  })
  it('no se confunde con lanzadores que no son de una cuenta', () => {
    const dir = casa([{ name: '.claude-quinta', login: true }])
    writeFileSync(join(dir, 'claude-accesos', 'continuar-claude2.cmd'), 'set "CLAUDE_CONFIG_DIR=%USERPROFILE%\\.claude-quinta"')
    expect(detectAccounts([], dir)[0].id).toBeUndefined()
  })
})
