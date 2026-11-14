// Pruebas B, C and J of the brief, plus instruction delivery at session start and hook installation.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-coord-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('coordination', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const { syncTasks } = await import('../src/core/engine')
  const coord = await import('../src/core/coord')
  const { addInstruction, listInstructions } = await import('../src/core/review')

  const setup = () => {
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const root = join(dir, 'game-' + Math.random().toString(36).slice(2))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'TASKS.md'), '## Lo de claude1 (asignado a claude1)\n- [~] AN1 · Animaciones del guerrero\n- [ ] AN2 · Animaciones del minero\n')
    const p = { id: 'game', name: 'Game', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p)
    syncTasks(db, p)
    return { db, p }
  }

  it('C: two accounts cannot hold the same task; the second is told who has it', () => {
    const { db } = setup()
    const key = coord.taskKeyFor(db, 'game', 'AN1').key
    expect(coord.claimTask(db, 'game', key, 'claude1').ok).toBe(true)
    const r = coord.claimTask(db, 'game', key, 'claude2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.holder.account).toBe('claude1')
    // The same account renews instead of conflicting.
    const again = coord.claimTask(db, 'game', key, 'claude1')
    expect(again.ok && again.renewed).toBe(true)
  })

  it('J: a reservation from a session that died expires and can be taken over, and it shows as abandoned', () => {
    const { db } = setup()
    const key = coord.taskKeyFor(db, 'game', 'AN2').key
    const t0 = Date.now() - 3 * 3600_000
    coord.claimTask(db, 'game', key, 'claude3', { now: t0 })
    expect(coord.listClaims(db, 'game')[0].abandoned).toBe(true)
    const r = coord.claimTask(db, 'game', key, 'claude4')
    expect(r.ok).toBe(true)
    expect(coord.claimHistory(db, 'game', key)[0].action).toContain('caducada')
  })

  it('B: a hand-off moves the reservations and says exactly where to continue', () => {
    const { db, p } = setup()
    const k1 = coord.taskKeyFor(db, 'game', 'AN1').key
    coord.claimTask(db, 'game', k1, 'claude1')
    const text = coord.handoffText({
      project: p, from: 'claude1', to: 'claude3', reason: 'se ha quedado sin uso semanal',
      tasks: [{ key: k1, extId: 'AN1', title: 'Animaciones del guerrero', status: 'en-desarrollo' }],
      heartbeat: { at: Date.now(), text: 'Guerrero: ataque hecho, falta el cargado.' },
      copies: [{ label: 'rachas', branch: 'rachas', dirty: 3, path: 'C:/x' }]
    })
    expect(text).toContain('AN1 · Animaciones del guerrero (a medias)')
    expect(text).toContain('falta el cargado')
    expect(text).toContain('3 archivos')
    expect(text).toContain('No los borres')
    expect(coord.transferClaims(db, 'game', [k1], 'claude1', 'claude3')).toBe(1)
    expect(coord.listClaims(db, 'game').find((c) => c.taskKey === k1)?.account).toBe('claude3')
  })

  it('instructions reach the agent when its session starts, and only then count as received', () => {
    const { db, p } = setup()
    const mine = addInstruction(db, { projectId: 'game', kind: 'mensaje', body: 'Revisa el vídeo del guerrero', target: 'claude2' })
    addInstruction(db, { projectId: 'game', kind: 'mensaje', body: 'Para otro', target: 'claude4' })
    addInstruction(db, { projectId: 'game', kind: 'nota', body: 'Solo para mí' })
    expect(listInstructions(db, 'game').find((i) => i.id === mine.id)?.status).toBe('guardada')
    const ctx = coord.sessionContext(db, p, 'claude2')
    expect(ctx).toContain('Revisa el vídeo del guerrero')
    expect(ctx).not.toContain('Para otro')
    expect(ctx).not.toContain('Solo para mí')
    expect(listInstructions(db, 'game').find((i) => i.id === mine.id)?.status).toBe('recibida')
    expect(coord.sessionContext(db, p, 'claude2')).not.toContain('Revisa el vídeo')
  })

  it('a session learns how the other accounts are: who is out of usage, until when, and which of their tasks are stuck', () => {
    const now = new Date(2026, 10, 2, 14, 0).getTime()
    const file = join(dir, 'team.json')
    writeFileSync(file, JSON.stringify({ at: now - 60_000, team: [
      { id: 'claude1', state: 'sin-uso', backAt: new Date(2026, 10, 6, 15, 0).getTime(), stuck: ['RA8', 'BZ26'] },
      { id: 'claude2', state: 'trabajando', doing: 'BZ53 balcones' },
      { id: 'claude3', state: 'disponible', weekFree: 6, fiveFree: 63 },
      { id: 'claude4', state: 'disponible', weekFree: 63 }
    ] }))
    const t = coord.teamContext('claude3', now, file)
    expect(t).toContain('claude1 sin uso hasta el vie 6 a las 15:00, con tareas suyas paradas: RA8, BZ26')
    expect(t).toContain('claude2 trabajando (BZ53 balcones)')
    expect(t).toContain('claude4 libre, semana 63 % libre')
    expect(t).toContain('A ti te queda el 6 % de la semana')
    expect(t).toContain('pmc claim')
    expect(t).not.toContain('claude3 libre')
    // A stale summary is ignored instead of misleading.
    expect(coord.teamContext('claude3', now + 3600_000, file)).toBe('')
  })

  it('only this project’s stuck tasks are named; the ones elsewhere are counted (14-11: game project tasks in Mission Control’s package)', () => {
    const now = new Date(2026, 10, 14, 0, 40).getTime()
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-team-')), 'team.json')
    writeFileSync(file, JSON.stringify({ at: now - 60_000, team: [
      { id: 'claude6', state: 'sin-uso', backAt: new Date(2026, 10, 14, 1, 10).getTime(), stuck: ['F10', 'F10b', 'MP9', 'EV25'], stuckIn: { 'mi-juego': ['F10', 'F10b', 'MP9'], 'mission-control': ['EV25'] } },
      { id: 'claude3', state: 'sin-uso', stuck: ['G4'], stuckIn: { 'mi-juego': ['G4'] } },
      { id: 'claude1', state: 'trabajando' }
    ] }))
    const t = coord.teamContext('claude1', now, file, 'mission-control')
    expect(t).toContain('claude6 sin uso hasta el sáb 14 a las 01:10, con tareas suyas paradas aquí: EV25 (y 3 paradas en otros proyectos)')
    expect(t).toContain('claude3 sin uso, con 1 parada en otros proyectos')
    expect(t).not.toContain('F10')
    expect(t).toContain('pmc claim')
    // The game project's own package names them; with no project, as before.
    expect(coord.teamContext('claude1', now, file, 'mi-juego')).toContain('con tareas suyas paradas aquí: F10, F10b, MP9 (y 1 parada en otros proyectos)')
    expect(coord.teamContext('claude1', now, file)).toContain('con tareas suyas paradas: F10, F10b, MP9, EV25')
    // Nothing stuck here: no «you may pick up a stopped task» line.
    writeFileSync(file, JSON.stringify({ at: now - 60_000, team: [{ id: 'claude3', state: 'sin-uso', stuck: ['G4'], stuckIn: { 'mi-juego': ['G4'] } }, { id: 'claude1', state: 'trabajando' }] }))
    expect(coord.teamContext('claude1', now, file, 'mission-control')).not.toContain('pmc claim')
  })

  it('an old reading that said "nothing left" is not passed on as a fact: the session exists, so the account has use again', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pmc-team-')), 'team.json')
    const now = Date.now()
    writeFileSync(file, JSON.stringify({ at: now, team: [{ id: 'claude3', state: 'sin-uso', weekFree: 0, usageAt: now - 9 * 3600_000 }] }))
    const t = coord.teamContext('claude3', now, file)
    expect(t).toContain('dato de hace 9 h')
    expect(t).toContain('trabaja con normalidad')
    expect(t).not.toContain('te queda el 0 %')
  })

  it('a note on an image is «recibido» when it reaches a Claude, which is told its number to send it back (12-11)', async () => {
    const { db, p } = setup()
    const { addComment, listComments } = await import('../src/core/review')
    const { comment } = addComment(db, { projectId: 'game', body: 'La mano no agarra el arma', x: 0.5, y: 0.5, shape: 'circle' } as any, 'Logs/hero/a.png')
    const text = coord.deliverPending(db, p, 'claude1')
    expect(text).toContain('La mano no agarra el arma')
    expect(text).toContain(`Notas sobre imágenes (n.º ${comment.id})`)
    expect(text).toMatch(/corregido <n\.º>/)
    expect(listComments(db, 'game').find((c) => c.id === comment.id)?.status).toBe('recibido')
  })

  it('an unread hand-off message older than 12 hours is set aside; the user’s answers are still delivered (12-11)', () => {
    const { db, p } = setup()
    const old = addInstruction(db, { projectId: 'game', kind: 'mensaje', body: 'Relevo en Juego: sigues el trabajo de claude6.', target: 'claude3' })
    db.prepare('UPDATE instructions SET created_at = ? WHERE id = ?').run(Date.now() - 13 * 3600_000, old.id)
    addInstruction(db, { projectId: 'game', kind: 'mensaje', body: 'Decisión del usuario sobre «Copias viejas»: elige «A».', target: 'claude3' })
    const text = coord.deliverPending(db, p, 'claude3')
    expect(text).toContain('elige «A»')
    expect(text).not.toContain('sigues el trabajo de claude6')
    expect(listInstructions(db, 'game').find((i) => i.id === old.id)?.status).toBe('anulada')
  })

  it('relevo: claude4 takes over claude2, and claude2 is told once, when it comes back to that project', () => {
    const { db, p } = setup()
    const k = coord.taskKeyFor(db, 'game', 'AN1').key
    coord.claimTask(db, 'game', k, 'claude2')
    const text = coord.takeOver(db, {
      project: p, from: 'claude2', to: 'claude4', enCurso: ['En curso (claude2, desde las 14:08): AN1, animaciones del guerrero'],
      copies: [{ label: 'rachas', branch: 'rachas', dirty: 679, path: p.root }], fromState: 'sin uso', backAt: Date.now() + 3600_000
    })
    expect(text).toContain('Reservas que pasan a ti: AN1')
    expect(text).toContain('679 archivos')
    expect(text).toContain('En curso (claude2')
    expect(coord.listClaims(db, 'game').find((c) => c.taskKey === k)?.account).toBe('claude4')
    // Elsewhere nothing; in the project, once.
    expect(coord.takeNotice('claude2', 'C:\\otro\\sitio')).toBeUndefined()
    const n = coord.takeNotice('claude2', p.root + '\\Assets')
    expect(n).toContain('claude4 ha seguido tu trabajo')
    expect(n).toContain('No rehagas')
    expect(coord.takeNotice('claude2', p.root)).toBeUndefined()
  })

  it('relevo: the other account’s blocked tasks are said apart, not as work to carry on (14-11: EV25)', () => {
    const { db, p } = setup()
    writeFileSync(join(p.root, 'docs', 'TASKS.md'), '## Lo de claude1 (asignado a claude1)\n- [~] AN1 · Animaciones del guerrero\n- [~] SY1 · *Bloqueada (13-11): espera a que el usuario tenga el segundo PC.* **Sincronización**\n')
    syncTasks(db, p)
    const text = coord.takeOver(db, { project: p, from: 'claude1', to: 'claude3', enCurso: [], copies: [] })
    expect(text).toMatch(/Otras tareas suyas sin terminar: AN1/)
    expect(text).not.toMatch(/sin terminar:[^\n]*SY1/)
    expect(text).toContain('Bloqueadas, esperan al usuario o un hecho real (no son para ahora): SY1')
  })

  it('notes that describe the same problem on several images become one order to check every similar case', () => {
    const lines = coord.groupedLines([
      { kind: 'correccion', body: 'El agarre del hacha está mal — sobre Logs/golpes/obrero.png (punto 40 %, 30 %)' },
      { kind: 'correccion', body: 'el agarre del arma está mal — sobre Logs/golpes/guerrero.png' },
      { kind: 'correccion', body: 'Agarre del arma mal colocado — sobre Logs/golpes/arquera.png' },
      { kind: 'correccion', body: 'El cielo se ve oscuro — sobre Logs/mapas/granja.png' },
      { kind: 'general', body: 'Prioriza los fallos visuales' }
    ])
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('el mismo problema en 3 archivos')
    expect(lines[0]).toContain('guerrero.png')
    expect(lines[0]).toContain('revisa también los demás casos parecidos')
    expect(lines[1]).toContain('El cielo se ve oscuro — sobre Logs/mapas/granja.png')
    expect(lines[2]).toContain('Prioriza los fallos visuales')
  })

  it('every session start explains what «sigue» means', () => {
    const { db, p } = setup()
    const ctx = coord.sessionContext(db, p, 'claude1')
    expect(ctx).toContain('«sigue»')
    expect(ctx).toContain('relevo <cuenta>')
    // The bare word once the launchers are on this machine's PATH (core/shim.ts), the full form otherwise.
    expect(ctx).toMatch(/(pmc\.mjs"|\bpmc) claim <ID>/)
    // EV37: the next free task comes with it, so «sigue» needs no pmc next first.
    expect(ctx).toMatch(/Tu siguiente tarea libre, si no hay encargo ni relevo: \S+ · /)
  })

  it('hooks are added next to the existing ones and removed without touching them', async () => {
    const { installHooks, uninstallHooks, hooksState } = await import('../src/core/integrations')
    const folder = join(dir, 'acc')
    mkdirSync(folder)
    const theirs = { StopFailure: [{ matcher: 'rate_limit', hooks: [{ type: 'command', command: 'powershell wake_after_limit.ps1' }] }] }
    writeFileSync(join(folder, 'settings.json'), JSON.stringify({ hooks: theirs, theme: 'dark' }))
    const acc = { id: 'claude2' as const, alias: 'x', configDir: folder, color: '#fff' }
    installHooks(acc, 'C:\\node\\node.exe', 'C:\\data\\pmc.mjs')
    const s = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
    expect(s.hooks.StopFailure).toHaveLength(2)
    expect(s.hooks.StopFailure[0].hooks[0].command).toBe('powershell wake_after_limit.ps1')
    expect(s.hooks.SessionStart[0].hooks[0].command).toBe('"C:/node/node.exe" "C:/data/pmc.mjs" hook claude2')
    expect(s.hooks.PostToolUse[0].matcher).toBe('Write|Edit|MultiEdit|NotebookEdit')
    expect(hooksState(acc).installed).toBe(true)
    installHooks(acc, 'C:\\node\\node.exe', 'C:\\data\\pmc.mjs')
    expect(JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8')).hooks.SessionStart).toHaveLength(1)
    uninstallHooks(acc)
    const after = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
    expect(after.hooks).toEqual(theirs)
    expect(after.theme).toBe('dark')
  })

  it('a CLAUDE.md read twice is left out for the copy, keeping the hooks already there (EV24)', async () => {
    const { excludeClaudeMd } = await import('../src/core/integrations')
    const copy = join(dir, 'copia')
    mkdirSync(join(copy, '.claude'), { recursive: true })
    writeFileSync(join(copy, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { StopFailure: [{ hooks: [{ type: 'command', command: 'wake.ps1' }] }] } }))
    expect(excludeClaudeMd(copy, 'C:\\p\\Juego\\CLAUDE.md').added).toBe(true)
    expect(excludeClaudeMd(copy, 'C:/p/Juego/CLAUDE.md').added).toBe(false)
    const s = JSON.parse(readFileSync(join(copy, '.claude', 'settings.local.json'), 'utf8'))
    expect(s.claudeMdExcludes).toEqual(['C:/p/Juego/CLAUDE.md'])
    expect(s.hooks.StopFailure[0].hooks[0].command).toBe('wake.ps1')
  })

  it('the Stop hook waits for its answer, and one installed in the background reads as out of date (12-11)', async () => {
    const { installHooks, hooksState } = await import('../src/core/integrations')
    const folder = join(dir, 'acc-stop')
    mkdirSync(folder)
    writeFileSync(join(folder, 'settings.json'), '{}')
    const acc = { id: 'claude3' as const, alias: 'x', configDir: folder, color: '#fff' }
    installHooks(acc, 'C:\\node\\node.exe', 'C:\\data\\pmc.mjs')
    const s = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
    expect(s.hooks.Stop[0].hooks[0].async).toBeUndefined()
    expect(hooksState(acc).outdated).toBe(false)
    // As every account had it until 0.16.26: autonomous mode's «do not stop» was never read.
    s.hooks.Stop[0].hooks[0].async = true
    writeFileSync(join(folder, 'settings.json'), JSON.stringify(s))
    expect(hooksState(acc).outdated).toBe(true)
  })
})

describe('dependencies and model size written in the task', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const { syncTasks } = await import('../src/core/engine')
  const coord = await import('../src/core/coord')
  it('reads «(tras: …)» and «[modelo]»', () => {
    expect(coord.taskTags('Relevo automático. (tras: EV4, EV5) [fable u opus]')).toEqual({ after: ['EV4', 'EV5'], model: 'fable u opus', needs: [] })
    expect(coord.taskTags('Sin nada [x] (tras: lo de antes)')).toEqual({ after: [], model: undefined, needs: [] })
    expect(coord.taskTags('Ejecutable nuevo {Unity} {gpu} [sonnet]').needs).toEqual(['unity', 'gpu'])
    // 13-11: what a task says about the tags is not its tags; its own are the ones at the end.
    expect(coord.taskTags('Reparto: añadir «{unity}», «{gpu}» a taskTags y marcas {build}. (tras: EV8) [fable u opus]')).toEqual({ after: ['EV8'], model: 'fable u opus', needs: [] })
    expect(coord.taskTags('Próximo decía «[fable u opus] 3,3 puntos». Se da por buena cuando no. [sonnet]').model).toBe('sonnet')
    // A note written after the tags: the last ones not quoted.
    expect(coord.taskTags('Exportar en 4K. [opus] {gpu} **Hecho: no hacía falta (la etiqueta «[sonnet]» no).**')).toEqual({ after: [], model: 'opus', needs: ['gpu'] })
  })
  it('pmc next does not offer a task that waits for an open one, and offers it once that one is done', () => {
    const root = join(dir, 'deps-' + Math.random().toString(36).slice(2))
    mkdirSync(join(root, 'docs'), { recursive: true })
    const write = (first: string) => writeFileSync(join(root, 'docs', 'TASKS.md'), `## Plan\n- [ ] EV16 · Relevo automático (tras: EV4) [opus]\n- [${first}] EV4 · Puerta de verificación [sonnet]\n`)
    write(' ')
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const p = { id: 'd', name: 'D', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p)
    syncTasks(db, p)
    expect(coord.nextTasks(db, 'd', 'claude1').map((t) => `${t.extId}:${t.model}`)).toEqual(['EV4:sonnet'])
    write('x')
    syncTasks(db, p)
    expect(coord.nextTasks(db, 'd', 'claude1').map((t) => `${t.extId}:${t.model}`)).toEqual(['EV16:opus'])
  })
})

describe('two accounts in the same file', async () => {
  const { openDb, addEvent } = await import('../src/core/db')
  const coord = await import('../src/core/coord')
  it('the second one is told once, only if the other wrote it in the last half hour', () => {
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const now = 50_000_000
    const file = 'C:\\juego\\Assets\\_Juego\\Match.cs'
    addEvent(db, { projectId: 'g', at: now - 10 * 60_000, account: 'claude6', kind: 'archivo', title: 'Claude 6 escribió Match.cs', detail: file, source: 'hook PostToolUse' })
    addEvent(db, { projectId: 'g', at: now - 5 * 60_000, account: 'claude1', kind: 'archivo', title: 'Claude 1 escribió Match.cs', detail: file, source: 'hook PostToolUse' })
    const text = coord.sharedFileWarning(db, 'claude1', 'C:/juego/Assets/_Juego/match.cs', 's1', 'g', now)!
    expect(text).toContain('claude6 escribió este mismo archivo')
    expect(text).toContain('hace 10 min')
    expect(coord.sharedFileWarning(db, 'claude1', file, 's1', 'g', now + 1000)).toBeUndefined()
    expect(coord.sharedFileWarning(db, 'claude1', file, 's2', 'g', now + coord.SHARED_FILE_MS)).toBeUndefined()
    expect(coord.sharedFileWarning(db, 'claude6', 'C:\\juego\\Otro.cs', 's3', 'g', now)).toBeUndefined()
  })
})
