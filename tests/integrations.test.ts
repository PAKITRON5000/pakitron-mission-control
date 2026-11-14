// statusLine install/uninstall on a throwaway account folder: backup first, settings kept, an existing statusLine chained
// and restored. The real accounts are never touched by the tests.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountConfig } from '../src/core/types'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-int-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('statusLine integration', async () => {
  const { installStatusLine, uninstallStatusLine, statusLineState, readChain } = await import('../src/core/integrations')
  const acc = (folder: string): AccountConfig => ({ id: 'claude2', alias: 'x', configDir: folder, color: '#fff' })

  it('keeps every other setting and leaves a backup', () => {
    const folder = join(dir, 'acc-a')
    require('node:fs').mkdirSync(folder)
    writeFileSync(join(folder, 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { Stop: [] }, autoContinueAtUsageLimit: true }, null, 2))
    const r = installStatusLine(acc(folder), 'C:\\Program Files\\nodejs\\node.exe', 'C:\\data\\bin\\pmc.mjs')
    const s = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
    expect(s.theme).toBe('dark')
    expect(s.hooks).toEqual({ Stop: [] })
    expect(s.statusLine.type).toBe('command')
    expect(s.statusLine.command).toBe('"C:/Program Files/nodejs/node.exe" "C:/data/bin/pmc.mjs" statusline claude2')
    expect(r.backup).toBeTruthy()
    expect(readdirSync(join(dir, 'data', 'backups', 'config')).length).toBe(1)
    expect(statusLineState(acc(folder)).ours).toBe(true)
    uninstallStatusLine(acc(folder))
    const after = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
    expect(after.statusLine).toBeUndefined()
    expect(after.theme).toBe('dark')
  })

  it('chains a statusLine the account already had, and gives it back on uninstall', () => {
    const folder = join(dir, 'acc-b')
    require('node:fs').mkdirSync(folder)
    writeFileSync(join(folder, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-line.sh', padding: 1 } }))
    installStatusLine(acc(folder), 'node', 'pmc.mjs')
    expect(readChain().claude2).toBe('my-line.sh')
    const s = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
    expect(s.statusLine.padding).toBe(1)
    const u = uninstallStatusLine(acc(folder))
    expect(u.restored).toBe('my-line.sh')
    expect(JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8')).statusLine.command).toBe('my-line.sh')
    expect(readChain().claude2).toBeUndefined()
  })
})
