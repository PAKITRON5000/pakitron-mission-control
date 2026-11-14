import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addEvent, openDb } from '../src/core/db'
import { binnable, dropOrphanAssets, forgetProject, loadProjects, PROJECT_TABLES, saveProject, settingsWithoutProject } from '../src/core/projects'
import type { ProjectConfig, Settings } from '../src/core/types'

// EV169 (the user, 14-11: «añade a la app una opción para borrar proyectos»).

const project = (id: string, root: string): ProjectConfig => ({ id, name: id, root, copies: [], docsDirs: [], mediaDirs: [], color: '#fff', createdAt: 1, readOnly: true, allowBuzon: false })

describe('borrar un proyecto (EV169)', () => {
  it('se va con todo lo que la base de datos guardaba de él, y los demás se quedan como estaban', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db'))
    saveProject(db, project('viejo', 'C:\\Users\\u\\Downloads\\Proyecto Viejo'))
    saveProject(db, project('juego', 'C:\\Users\\u\\Downloads\\Juego'))
    for (const p of ['viejo', 'juego']) {
      db.prepare(`INSERT INTO tasks (project_id, key, ext_id, title, detail, status, priority, owner, source, source_line, mark, gone, created_at, updated_at)
        VALUES (?, 'T1', 'T1', 'Tarea', '', 'pendiente', 2, NULL, 'tasks', 1, ' ', 0, 1, 1)`).run(p)
      addEvent(db, { projectId: p, at: 1, kind: 'nota', title: 'algo', source: 'prueba' })
      db.prepare("INSERT INTO claims (project_id, task_key, account, claimed_at, heartbeat_at, expires_at) VALUES (?, 'T1', 'claude1', 1, 1, 9)").run(p)
    }
    forgetProject(db, 'viejo')
    expect(loadProjects(db).map((p) => p.id)).toEqual(['juego'])
    for (const table of PROJECT_TABLES) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = 'viejo'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id = 'juego'").get() as { n: number }).n).toBe(1)
    expect((db.prepare("SELECT COUNT(*) AS n FROM claims WHERE project_id = 'juego'").get() as { n: number }).n).toBe(1)
  })

  it('lo que un escaneo de la galería volvió a apuntar de un proyecto ya borrado se va al arrancar; lo de «*» se queda', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db'))
    saveProject(db, project('juego', 'C:\\Users\\u\\Downloads\\Juego'))
    const asset = (pid: string, path: string) => db.prepare("INSERT INTO assets (project_id, path, rel, name, kind, category, size, mtime, first_seen) VALUES (?, ?, 'a.jpg', 'a.jpg', 'image', 'otros', 1, 1, 1)").run(pid, path)
    asset('juego', 'C:\\j\\a.jpg')
    asset('viejo', 'C:\\c\\a.jpg')
    asset('viejo', 'C:\\c\\b.jpg')
    asset('*', 'C:\\x\\a.jpg')
    expect(dropOrphanAssets(db)).toBe(2)
    expect((db.prepare('SELECT project_id AS p FROM assets ORDER BY project_id').all() as { p: string }[]).map((r) => r.p)).toEqual(['*', 'juego'])
  })

  it('ningún ajuste lo sigue nombrando, deja de ser el abierto y su carpeta no se vuelve a ofrecer', () => {
    const s = {
      activeProjectId: 'viejo',
      relayChains: { viejo: { on: true, order: ['claude1'] }, juego: { on: true, order: ['claude3'] } },
      routines: { viejo: { noche: true }, juego: { noche: false } },
      reserves: [{ account: 'claude4', projectId: 'viejo', on: true }, { account: 'claude5', projectId: 'juego', on: true }],
      schedules: { claude4: { at: 1, projectId: 'viejo' }, claude5: { at: 2, projectId: 'juego' } },
      autonomyOff: ['viejo', 'juego'],
      backup: { on: true, off: ['viejo'] },
      smartClean: { viejo: true },
      nextOrderBy: { viejo: ['claude1'], juego: ['claude3'] },
      declinedFolders: ['D:\\Otra']
    } as unknown as Settings
    const next = settingsWithoutProject(s, 'viejo', 'C:\\Users\\u\\Downloads\\Proyecto Viejo')
    expect(Object.keys(next.relayChains!)).toEqual(['juego'])
    expect(Object.keys(next.routines!)).toEqual(['juego'])
    expect(next.reserves!.map((r) => r.projectId)).toEqual(['juego'])
    expect(Object.keys(next.schedules!)).toEqual(['claude5'])
    expect(next.autonomyOff).toEqual(['juego'])
    expect(next.backup!.off).toEqual([])
    expect(next.smartClean).toEqual({})
    expect(Object.keys(next.nextOrderBy!)).toEqual(['juego'])
    expect(next.declinedFolders).toEqual(['D:\\Otra', 'C:\\Users\\u\\Downloads\\Proyecto Viejo'])
    expect('activeProjectId' in next && next.activeProjectId === undefined).toBe(true)
    expect('activeProjectId' in settingsWithoutProject({ ...s, activeProjectId: 'juego' }, 'viejo', 'X:\\c')).toBe(false)
  })

  it('a la papelera solo va la carpeta del proyecto: nunca una unidad, la carpeta del usuario, Descargas ni la de la app', () => {
    const home = 'C:\\Users\\u'
    const app = 'C:\\Users\\u\\Downloads\\Pakitron Mission Control'
    expect(binnable('C:\\Users\\u\\Downloads\\Proyecto Viejo', app, home, 'win32')).toBe(true)
    expect(binnable('E:\\Videos', app, home, 'win32')).toBe(true)
    expect(binnable('C:\\', app, home, 'win32')).toBe(false)
    expect(binnable('B:', app, home, 'win32')).toBe(false)
    expect(binnable('C:\\Users', app, home, 'win32')).toBe(false)
    expect(binnable(home, app, home, 'win32')).toBe(false)
    expect(binnable('C:\\Users\\u\\Downloads', app, home, 'win32')).toBe(false)
    expect(binnable('c:/users/u/downloads/', app, home, 'win32')).toBe(false)
    expect(binnable(app, app, home, 'win32')).toBe(false)
    expect(binnable('\\\\servidor\\compartido\\x', app, home, 'win32')).toBe(false)
  })
})
