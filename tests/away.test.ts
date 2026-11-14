import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { awayAnswer, pendingToolUse, riskOf, yesOnScreen } from '../src/core/away'

describe('cuando el usuario no está', () => {
  it('reconoce las cuatro cosas que el usuario quiere confirmar', () => {
    expect(riskOf('Bash', { command: 'rm -rf Assets/_Juego' })).toMatchObject({ risky: true, why: 'borrar trabajo que no se puede recuperar' })
    expect(riskOf('Bash', { command: 'git reset --hard HEAD~3' }).risky).toBe(true)
    expect(riskOf('Bash', { command: 'git push origin main' })).toMatchObject({ why: 'publicar fuera de este PC' })
    expect(riskOf('Edit', { file_path: 'C:/Users/P/.claude-tercera/settings.json' })).toMatchObject({ why: 'tocar credenciales o la seguridad' })
    expect(riskOf('Bash', { command: 'powershell -File tools\\unity.ps1 build' }).risky).toBe(false)
    expect(riskOf('Bash', { command: 'git commit -m "Glaciar"' }).risky).toBe(false)
    expect(riskOf('Write', { file_path: 'docs/TASKS.md', content: 'hola' }).risky).toBe(false)
  })

  it('decide según lo que eligió el usuario', () => {
    expect(awayAnswer('seguro', { risky: false })).toBe('aceptar')
    expect(awayAnswer('seguro', { risky: true })).toBe('rechazar')
    expect(awayAnswer('todo', { risky: true })).toBe('aceptar')
    expect(awayAnswer('esperar', { risky: false })).toBe('esperar')
  })

  it('encuentra la orden que espera permiso al final de la conversación', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'pmc-away-')), 's.jsonl')
    const rows = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ahora' }, { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'git push' } }] } }
    ]
    writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    expect(pendingToolUse(f)).toEqual({ name: 'Bash', input: { command: 'git push' } })
    writeFileSync(f, rows.slice(0, 2).map((r) => JSON.stringify(r)).join('\n') + '\n')
    expect(pendingToolUse(f)).toBeUndefined()
  })

  it('solo pulsa 1 si en la ventana se ve un menú cuyo 1 es «Yes» (13-11: en la carpeta nueva, el primero era «No, exit»)', () => {
    // Read from a real window (EV88 test, 13-11 01:39).
    const permiso = [
      '❯ Prueba de Mission Control. Ejecuta con la herramienta Bash exactamente esta orden',
      ' Bash command', ' echo hola > prueba-ev88.txt', '╌╌╌╌╌╌╌╌', ' Do you want to proceed?', ' ❯ 1. Yes',
      '   2. Yes, and always allow access to C:\\Users\\ana\\carpeta from this project',
      '   3. Yes, and switch to auto mode · auto mode handles these prompts for you', '   4. No', ' Esc to cancel · Tab to amend', ''
    ].join('\n')
    expect(yesOnScreen(permiso)).toEqual({ key: '1', question: 'Do you want to proceed?' })
    const confianza = [
      ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
      ' Security guide', ' ❯ No, exit', '   Yes, I trust this folder', ' Enter to confirm · Esc to cancel'
    ].join('\n')
    expect(yesOnScreen(confianza).key).toBeUndefined()
    expect(yesOnScreen('❯ \n  ? for shortcuts').key).toBeUndefined()
    // An old menu up in the scrollback does not count once the window has moved on.
    expect(yesOnScreen([permiso, ...Array(20).fill('  trabajando…'), '❯ '].join('\n')).key).toBeUndefined()
    // «1. Yesterday…» is not a yes.
    expect(yesOnScreen(' Pick one?\n ❯ 1. Yesterday\n   2. Today\n Enter to confirm').key).toBeUndefined()
  })
})
