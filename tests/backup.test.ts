// EV44: nightly backups of each project's git history on another disk (Decidir #135: G:\Copias de proyectos).
import { describe, it, expect } from 'vitest'
import { backupTarget, dueBackup, emptyBackupMemory, pushedRefs, rejectedBranches, rememberBackup, rewrittenRefspec, BACKUP_RETRY_MS } from '../src/core/backup'

const at = (h: number, m = 0, day = 13) => new Date(2026, 10, day, h, m).getTime()
// Turned on: off by default anywhere but Windows (a Mac has no G: disk; 14-11, the tests on macOS).
const ON = { on: true }
const projects = [{ id: 'juego', git: true }, { id: 'mission-control', git: true }, { id: 'sin-git', git: false }]

describe('backups', () => {
  it('names one bare repository per project in the chosen folder', () => {
    expect(backupTarget('G:\\Copias de proyectos', 'juego')).toBe('G:\\Copias de proyectos\\juego.git')
    expect(backupTarget('G:\\Copias de proyectos\\', 'a b')).toBe('G:\\Copias de proyectos\\a_b.git')
  })

  it('copies once per night from the hour, the first time included', () => {
    const mem = emptyBackupMemory()
    // During the day nothing, not even the first copy (41 GB for Juego de prueba).
    expect(dueBackup(projects, ON, mem, at(15), false)).toBeUndefined()
    // From 03:00: the first copy.
    expect(dueBackup(projects, ON, mem, at(3, 5), false)).toMatchObject({ projectId: 'juego', first: true })
    // Not while the user plays or edits video, nor when turned off, nor for a project left out.
    expect(dueBackup(projects, ON, mem, at(3, 5), true)).toBeUndefined()
    expect(dueBackup(projects, { on: false }, mem, at(3, 5), false)).toBeUndefined()
    expect(dueBackup(projects, { ...ON, off: ['juego'] }, mem, at(3, 5), false)?.projectId).toBe('mission-control')
    rememberBackup(mem, 'juego', dueBackup(projects, ON, mem, at(3, 5), false)!.night, true, 'primera copia', at(3, 40))
    rememberBackup(mem, 'mission-control', '2026-11-13', true, 'primera copia', at(3, 41))
    // Done tonight: nothing more; a project without git never.
    expect(dueBackup(projects, ON, mem, at(5), false)).toBeUndefined()
    expect(dueBackup(projects, ON, mem, at(23), false)).toBeUndefined()
    // From 03:00 the next night: each once.
    expect(dueBackup(projects, ON, mem, at(3, 5, 14), false)).toMatchObject({ projectId: 'juego', first: false })
    rememberBackup(mem, 'juego', '2026-11-14', true, 'ya estaba al día', at(3, 6, 14))
    expect(dueBackup(projects, ON, mem, at(3, 7, 14), false)?.projectId).toBe('mission-control')
    rememberBackup(mem, 'mission-control', '2026-11-14', true, 'ya estaba al día', at(3, 7, 14))
    expect(dueBackup(projects, ON, mem, at(5, 0, 14), false)).toBeUndefined()
  })

  it('retries a failure in half an hour and tells the user once a day', () => {
    const mem = emptyBackupMemory()
    expect(rememberBackup(mem, 'juego', 'n', false, 'no está el disco G:', at(3, 5)).tell).toBe(true)
    expect(dueBackup(projects, ON, mem, at(3, 10), false)?.projectId).toBe('mission-control')
    expect(dueBackup([projects[0]], ON, mem, at(3, 5) + BACKUP_RETRY_MS - 1, false)).toBeUndefined()
    expect(dueBackup([projects[0]], ON, mem, at(3, 5) + BACKUP_RETRY_MS, false)).toMatchObject({ first: true })
    expect(rememberBackup(mem, 'juego', 'n', false, 'no está el disco G:', at(3, 35)).tell).toBe(false)
    expect(rememberBackup(mem, 'juego', 'n', false, 'no está el disco G:', at(9, 0, 14)).tell).toBe(true)
  })

  it('reads git push --porcelain: what changed and which branches were rewritten', () => {
    const out = [
      'To G:\\Copias de proyectos\\juego.git',
      '=\trefs/heads/unificada:refs/heads/unificada\t[up to date]',
      ' \trefs/heads/rachas:refs/heads/rachas\t1a2b3c..4d5e6f',
      '*\trefs/heads/nueva:refs/heads/nueva\t[new branch]',
      '!\trefs/heads/cabeza:refs/heads/cabeza\t[rejected] (non-fast-forward)',
      '!\trefs/tags/v1:refs/tags/v1\t[rejected] (already exists)',
      'Done'
    ].join('\n')
    expect(pushedRefs(out)).toBe(2)
    expect(rejectedBranches(out)).toEqual(['cabeza'])
    expect(rewrittenRefspec('cabeza', at(3, 5, 14))).toBe('+refs/heads/cabeza:refs/heads/reescritas/2026-11-14-0305/cabeza')
  })
})
