import { describe, expect, it } from 'vitest'
import { hardRuleTargets, guardRules } from '../src/core/live'

describe('hard rules of the user (EV80)', () => {
  it('finds what a rule forbids touching, only when it is a file or a folder', () => {
    expect(hardRuleTargets('No toques `tools/unity.ps1` ni los ganchos')).toEqual(['tools/unity.ps1'])
    expect(hardRuleTargets('Nunca modifiques settings.local.json.')).toEqual(['settings.local.json'])
    expect(hardRuleTargets('no borres la carpeta «Assets/Art»')).toEqual(['Assets/Art'])
    expect(hardRuleTargets('No toques nada sin probarlo')).toEqual([])
  })
  it('denies editing, deleting or moving it, and lets reading it', () => {
    const rules = [{ target: 'tools/unity.ps1', text: 'No toques tools/unity.ps1' }]
    expect(guardRules({ tool_name: 'Edit', tool_input: { file_path: 'C:\\Juego\\tools\\unity.ps1' } }, rules)).toContain('regla del usuario')
    expect(guardRules({ tool_name: 'Bash', tool_input: { command: 'rm tools/unity.ps1' } }, rules)).toContain('No se puede cambiar ni borrar tools/unity.ps1')
    expect(guardRules({ tool_name: 'PowerShell', tool_input: { command: 'Get-Content tools\\unity.ps1' } }, rules)).toBeUndefined()
    expect(guardRules({ tool_name: 'Edit', tool_input: { file_path: 'C:\\Juego\\tools\\build.ps1' } }, rules)).toBeUndefined()
  })
})
