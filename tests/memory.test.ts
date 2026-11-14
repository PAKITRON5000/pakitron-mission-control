import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../src/core/db'
import { addMemory, editMemory, forgetMemory, listMemories, memoryText, memoryLine, MEMORY_MAX } from '../src/core/memory'

describe('memoria del proyecto', () => {
  it('guarda, ordena (reglas primero), no repite y olvida', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-mem-')), 'm.db'))
    addMemory(db, { projectId: 'p', kind: 'dato', text: 'La copia de trabajo es rachas', source: 'usuario' }, 1)
    const r = addMemory(db, { projectId: 'p', kind: 'regla', text: 'No toques la aceleración del personaje', source: 'claude1' }, 2)
    addMemory(db, { projectId: 'p', kind: 'regla', text: '  no toques la aceleración   del personaje ', source: 'claude3' }, 3)
    expect(listMemories(db, 'p').map((m) => m.kind)).toEqual(['regla', 'dato'])
    editMemory(db, r.id, { kind: 'preferencia' })
    expect(listMemories(db, 'p')[0].kind).toBe('preferencia')
    forgetMemory(db, r.id)
    expect(listMemories(db, 'p').length).toBe(1)
    expect(() => addMemory(db, { projectId: 'p', kind: 'dato', text: '   ', source: 'x' })).toThrow()
    db.close()
  })

  it('lo que lee cada sesión cabe en su presupuesto y empieza por lo importante', () => {
    const mems = Array.from({ length: 40 }, (_, i) => ({ id: i, projectId: 'p', kind: (i < 2 ? 'regla' : 'dato') as any, text: `cosa número ${i} que no se debe olvidar nunca jamás`, source: 'u', at: i }))
    const t = memoryText('Juego de prueba', mems, ['Castillos: B («más grandes»)'], 600)
    expect(t.length).toBeLessThanOrEqual(650)
    expect(t).toContain('Regla: cosa número 0')
    expect(t).toContain('hay más en Mission Control')
    // On its own line (14-11: «…el 13-11.- (hay más…»).
    expect(t).toMatch(/\n- \(hay más en Mission Control › Memoria\)$/)
    expect(memoryText('X', [], [])).toBe('')
  })

  it('una demasiado larga se corta por una palabra, con «…» (14-11: «…flujos, estructuras) s»)', () => {
    const long = 'Encargo del usuario (13-11 16:20): terminar primero la app y luego el juego. ' + 'La app, lo más optimizada posible, que ayude a los Claude a entender cualquier proyecto. '.repeat(5) + 'según cada uno'
    const line = memoryLine(long)
    expect(line.length).toBeLessThanOrEqual(MEMORY_MAX)
    expect(line.endsWith('…')).toBe(true)
    expect(line).not.toMatch(/ \S…$/)
    expect(long.startsWith(line.slice(0, -1))).toBe(true)
    expect(memoryLine('  corta   y   bien ')).toBe('corta y bien')
  })
})
