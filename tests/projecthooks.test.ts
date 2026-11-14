// EV52: Mission Control's hooks in a project folder, for any account, keeping the project's own.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installProjectHooks, HOOK_EVENTS } from '../src/core/integrations'

describe('ganchos en el proyecto (EV52)', () => {
  // The copy made before writing goes to the app's data folder: a temporary one here, never the real one (13-11: 63
  // copies of this test's file had piled up in %LOCALAPPDATA%\PakitronMC\backups\config).
  process.env.PMC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pmc-phooks-data-'))
  it('añade los de Mission Control sin cuenta y deja los del proyecto; dos veces no duplica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-phooks-'))
    mkdirSync(join(dir, '.claude'))
    const own = { hooks: { StopFailure: [{ hooks: [{ type: 'command', command: 'powershell -File wake_after_limit.ps1' }] }] }, permissions: { allow: ['Bash(git:*)'] } }
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify(own))
    installProjectHooks(dir, 'C:\\node\\node.exe', 'C:\\pmc\\pmc.mjs')
    installProjectHooks(dir, 'C:\\node\\node.exe', 'C:\\pmc\\pmc.mjs')
    const s = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'))
    expect(s.permissions).toEqual(own.permissions)
    const cmds = (e: string) => (s.hooks[e] ?? []).flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(cmds('StopFailure')).toContain('powershell -File wake_after_limit.ps1')
    for (const h of HOOK_EVENTS) expect(cmds(h.event).filter((c: string) => /pmc\.mjs" hook$/.test(c))).toHaveLength(1)
  })
})
