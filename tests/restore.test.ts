// Restoring one of the daily copies of the app's database (EV13): chosen now, put in place at the next start.
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPendingRestore, listBackups, requestRestore } from '../src/core/restore'

describe('restoring a backup', () => {
  it('lists the copies newest first, and only a copy from the backups folder can be chosen', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-rest-'))
    const backups = join(root, 'backups')
    mkdirSync(backups)
    writeFileSync(join(backups, 'mission-2026-11-11T10-00-00.db'), 'vieja')
    writeFileSync(join(backups, 'otra.txt'), 'x')
    expect(listBackups(backups).map((b) => b.name)).toEqual(['mission-2026-11-11T10-00-00.db'])
    expect(() => requestRestore(join(root, 'fuera.db'), root, backups)).toThrow()
  })

  it('at the next start the chosen copy replaces the database and its leftover journal; once', () => {
    const root = mkdtempSync(join(tmpdir(), 'pmc-rest-'))
    const backups = join(root, 'backups')
    mkdirSync(backups)
    const copy = join(backups, 'mission-2026-11-11T10-00-00.db')
    writeFileSync(copy, 'la de ayer')
    const db = join(root, 'mission.db')
    writeFileSync(db, 'la de hoy'); writeFileSync(db + '-wal', 'diario')
    expect(applyPendingRestore(root, db)).toBeUndefined()
    requestRestore(copy, root, backups)
    expect(applyPendingRestore(root, db)).toBe(copy)
    expect(readFileSync(db, 'utf8')).toBe('la de ayer')
    expect(existsSync(db + '-wal')).toBe(false)
    expect(applyPendingRestore(root, db)).toBeUndefined()
    // With the phone's notice keys kept next to the copy, they come back too.
    writeFileSync(copy.replace(/\.db$/, '.remote.json'), '{"subs":[1]}')
    requestRestore(copy, root, backups)
    applyPendingRestore(root, db)
    expect(readFileSync(join(root, 'remote.json'), 'utf8')).toBe('{"subs":[1]}')
  })
})
