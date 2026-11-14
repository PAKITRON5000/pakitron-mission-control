// 0.8 (3-11): decisions with pictures, notes as backlog, priorities, protected noted files, live activity, open accounts.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-control-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('mission control 0.8', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const { syncTasks, listTasks } = await import('../src/core/engine')
  const coord = await import('../src/core/coord')
  const dec = await import('../src/core/decisions')
  const live = await import('../src/core/live')
  const { addInstruction, listInstructions } = await import('../src/core/review')

  const setup = () => {
    const db = openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
    const root = join(dir, 'game-' + Math.random().toString(36).slice(2))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'TASKS.md'), '## Varias\n- [ ] AN1 · Animaciones del guerrero\n- [ ] AN2 · Animaciones del minero\n- [~] AN3 · Golpes del brujo\n- [~] AN4 · Ropa del mago (en curso, claude10)\n')
    const p = { id: 'game', name: 'Game', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p)
    syncTasks(db, p)
    return { db, p, root }
  }

  it('a decision keeps its own copy of the pictures, and the answer goes back to the Claude that asked', () => {
    const { db, p, root } = setup()
    const shot = join(root, 'captura.png')
    writeFileSync(shot, 'png-1')
    const d = dec.addDecision(db, { projectId: 'game', title: 'Color del HUD', question: '¿Cuál?', options: ['Rojo: más visible', 'Azul'], images: [shot, join(root, 'no-existe.png')], askedBy: 'claude2', taskExtId: 'HUD9', priority: 1, dedupe: 'hud-color' })
    expect(d.options.map((o) => o.label)).toEqual(['Rojo', 'Azul'])
    expect(d.options[0].detail).toBe('más visible')
    expect(d.images).toHaveLength(1)
    // A new capture with the same name does not change what the user is deciding on.
    writeFileSync(shot, 'png-2-overwritten')
    expect(readFileSync(d.images[0].path, 'utf8')).toBe('png-1')
    // Asking again with the same key updates it instead of adding another.
    const again = dec.addDecision(db, { projectId: 'game', title: 'Color del HUD (2)', options: ['Rojo', 'Azul', 'Verde'], askedBy: 'claude2', dedupe: 'hud-color' })
    expect(again.id).toBe(d.id)
    expect(dec.pendingDecisionCount(db, 'game')).toBe(1)
    const r = dec.answerDecision(db, p, d.id, { choice: again.options[2].id, note: 'Más suave' })
    expect(r.status).toBe('decidida')
    expect(dec.pendingDecisionCount(db, 'game')).toBe(0)
    const ins = listInstructions(db, 'game').find((i) => i.id === r.instructionId)!
    expect(ins.target).toBe('claude2')
    expect(ins.body).toContain('«Verde»')
    expect(ins.body).toContain('Más suave')
    // It reaches that Claude through the usual delivery.
    expect(coord.sessionContext(db, p, 'claude2')).toContain('Color del HUD')
  })

  it('the user\'s notes are filed where they belong, not taken as the main task; priorities go first', () => {
    const { db, p } = setup()
    addInstruction(db, { projectId: 'game', kind: 'general', body: 'El gorro del mago no me convence' })
    addInstruction(db, { projectId: 'game', kind: 'prioridad', body: 'Arregla el cierre del juego' })
    const text = coord.deliverPending(db, p, 'claude1')
    expect(text).toContain('No son tu tarea principal ni te hacen parar')
    expect(text).toContain('donde le toque')
    expect(text).toContain('para hacer antes que lo demás')
    expect(text.indexOf('Arregla el cierre')).toBeLessThan(text.indexOf('El gorro del mago'))
  })

  it('tasks the user raises reach every new session and lead pmc next; one held by another account is skipped', () => {
    const { db, p } = setup()
    const tasks = listTasks(db, 'game')
    const an2 = tasks.find((t) => t.extId === 'AN2')!
    db.prepare('UPDATE tasks SET priority = 0 WHERE id = ?').run(an2.id)
    const ctx = coord.sessionContext(db, p, 'claude1')
    expect(ctx).toContain('Prioridades del usuario')
    expect(ctx).toContain('AN2 · Animaciones del minero [urgente]')
    expect(ctx).toContain('decide "título"')
    let next = coord.nextTasks(db, 'game', 'claude1')
    expect(next[0].extId).toBe('AN2')
    expect(next[1].extId).toBe('AN3') // half-done before the untouched ones
    coord.claimTask(db, 'game', an2.key, 'claude3')
    next = coord.nextTasks(db, 'game', 'claude1')
    expect(next[0].extId).toBe('AN3')
    expect(coord.prioritiesText(db, 'game', 'claude1')).toContain('la tiene claude3')
  })

  it('accounts beyond the fourth are read from TASKS.md', () => {
    const { db } = setup()
    expect(listTasks(db, 'game').find((t) => t.extId === 'AN4')?.owner).toBe('claude10')
  })

  it('a noted file cannot be overwritten or deleted by a Claude, and its copy is kept', () => {
    const f = join(dir, 'Logs', 'captures', 'hud_final.png')
    mkdirSync(join(dir, 'Logs', 'captures'), { recursive: true })
    writeFileSync(f, 'v1')
    const kept = live.keepCopy(7, f, 123)!
    expect(readFileSync(kept, 'utf8')).toBe('v1')
    const files = [f]
    expect(live.guardProtected({ tool_name: 'Write', tool_input: { file_path: f.split('\\').join('/') } }, files)).toContain('nota del usuario')
    expect(live.guardProtected({ tool_name: 'Bash', tool_input: { command: 'rm Logs/captures/hud_final.png' } }, files)).toContain('hud_final_v2.png')
    expect(live.guardProtected({ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item Logs\\captures\\hud_final.png' } }, files)).toBeDefined()
    expect(live.guardProtected({ tool_name: 'Bash', tool_input: { command: 'python view.py Logs/captures/hud_final.png' } }, files)).toBeUndefined()
    expect(live.guardProtected({ tool_name: 'Write', tool_input: { file_path: join(dir, 'otro.png') } }, files)).toBeUndefined()
  })

  it('what an account is doing comes from its hooks: the command it runs, the file it edits, what it said', () => {
    const now = Date.now()
    live.appendActivity('claude7', { ...live.describeHook({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's' })!, at: now - 3000 })
    live.appendActivity('claude7', { ...live.describeHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'tools/unity.ps1 build', description: 'Compila el juego' } })!, at: now - 2000 })
    live.appendActivity('claude7', { ...live.describeHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/x/Hud.uss' } })!, at: now - 1000 })
    live.appendActivity('claude7', { ...live.describeHook({ hook_event_name: 'Stop', last_assistant_message: 'He terminado el HUD.' })!, at: now })
    expect(live.describeHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit' })).toBeUndefined()
    const a = live.readActivity('claude7')
    expect(a.now?.text).toBe('Ha terminado un turno')
    expect(a.recent[1].text).toBe('Edita Hud.uss')
    expect(a.recent[2].text).toBe('Compila el juego')
    expect(a.lastMessage?.text).toBe('He terminado el HUD.')
  })

  it('the CLI knows an added account by its folder', async () => {
    const { accountFromConfigDir, configuredAccounts } = await import('../src/core/accounts')
    const file = join(dir, 'data', 'accounts.json')
    writeFileSync(file, JSON.stringify([{ id: 'claude1', alias: 'P', configDir: '', color: '#000' }, { id: 'claude5', alias: 'Quinta', configDir: 'C:\\Users\\x\\.claude-quinta', color: '#f00' }]))
    expect(configuredAccounts().map((a) => a.id)).toEqual(['claude1', 'claude5'])
    expect(accountFromConfigDir('C:/Users/x/.claude-quinta/')).toBe('claude5')
    expect(accountFromConfigDir('C:\\Users\\x\\.claude-segunda')).toBe('claude2')
    unlinkSync(file)
    expect(existsSync(file)).toBe(false)
  })
})
