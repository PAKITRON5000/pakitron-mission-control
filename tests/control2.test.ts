// 0.8.1 (3-11): sounds and videos in decisions with what each is for, likes per item, and what each Claude says it does.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-control2-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('mission control 0.8.1', async () => {
  const { openDb } = await import('../src/core/db')
  const { saveProject } = await import('../src/core/projects')
  const dec = await import('../src/core/decisions')
  const live = await import('../src/core/live')
  const { listInstructions } = await import('../src/core/review')

  it('a decision carries sounds with what they are and for which moment, and the likes go back to the Claude', () => {
    const db = openDb(join(dir, 'data', 'm.db'))
    const root = join(dir, 'game')
    mkdirSync(join(root, 'docs'), { recursive: true })
    const p = { id: 'game', name: 'Game', root, copies: [{ path: root, label: 'Copia principal' }], docsDirs: [join(root, 'docs')], mediaDirs: [], color: '#fff', createdAt: 0, readOnly: true, allowBuzon: false }
    saveProject(db, p)
    for (const f of ['Duck.mp3', 'Calm.ogg', 'Clip.mp4', 'Shot.png']) writeFileSync(join(root, f), 'x')
    expect(dec.parseMediaArg('C:\\a\\Duck.mp3::Fluffing a Duck::Menús')).toEqual({ path: 'C:\\a\\Duck.mp3', caption: 'Fluffing a Duck', group: 'Menús' })
    const d = dec.addDecision(db, {
      projectId: 'game', title: 'Música', askedBy: 'claude2', options: ['Me gusta', 'Cambiar'],
      images: [{ path: join(root, 'Duck.mp3'), caption: 'Fluffing a Duck', group: 'Menús' }, { path: join(root, 'Calm.ogg'), caption: 'Village Consort', group: 'Calma' }, join(root, 'Clip.mp4'), join(root, 'Shot.png')]
    })
    expect(d.images.map((m) => m.kind)).toEqual(['audio', 'audio', 'video', 'image'])
    expect(d.images[1].group).toBe('Calma')
    expect(d.images[3].caption).toBe('Shot')
    const r = dec.answerDecision(db, p, d.id, { choice: d.options[1].id, reactions: { 0: 'si', 1: 'no' } })
    expect(r.reactions).toEqual({ 0: 'si', 1: 'no' })
    const body = listInstructions(db, 'game').find((i) => i.id === r.instructionId)!.body
    expect(body).toContain('Le gusta: «Fluffing a Duck» (Menús)')
    expect(body).toContain('No le gusta: «Village Consort» (Calma)')
  })

  it('what a Claude says it is working on is the headline, kept apart from its last steps', () => {
    expect(live.setFocus('claude8', '  ahora estoy preparando las imágenes de las rachas ')).toBe('Preparando las imágenes de las rachas')
    live.appendActivity('claude8', live.describeHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { description: 'Compila el juego' } })!)
    live.setFocus('claude8', 'Probando el HUD a 3440×1440')
    live.appendActivity('claude8', live.describeHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/x/Hud.uss' } })!)
    const a = live.readActivity('claude8')
    expect(a.focus?.text).toBe('Probando el HUD a 3440×1440')
    expect(a.focusHistory.map((f) => f.text)).toEqual(['Preparando las imágenes de las rachas'])
    expect(a.now?.text).toBe('Edita Hud.uss')
    expect(a.recent.map((r) => r.text)).toEqual(['Edita Hud.uss', 'Compila el juego'])
  })
})
