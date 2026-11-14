// Autonomous mode: a session is told to go on while there is work, and the user's «para» still stops it.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autonomyFor, keepGoing, lastUserPrompt, MAX_BLOCKS } from '../src/core/autonomy'

describe('autonomous mode', () => {
  const now = 50_000_000
  const base = { autonomous: true, next: ['EV4 Puerta de verificación'], blocks: [] as number[], now }
  it('keeps a session going while its queue has work', () => {
    expect(keepGoing(base)).toContain('EV4 Puerta de verificación')
    expect(keepGoing({ ...base, lastPrompt: 'sigue' })).toContain('no termines el turno')
    expect(keepGoing({ ...base, lastPrompt: 'parametriza el aviso' })).toBeDefined()
  })
  it('lets it stop when the mode is off, nothing is left, the user said «para», or it cannot go on', () => {
    expect(keepGoing({ ...base, autonomous: false })).toBeUndefined()
    expect(keepGoing({ ...base, lastPrompt: 'para' })).toBeUndefined()
    expect(keepGoing({ ...base, lastPrompt: 'arregla esto del relevo y para, obviamente si lo pido yo' })).toBeUndefined()
    expect(keepGoing({ ...base, lastPrompt: 'haz la tarea y para ello usa Blender' })).toBeDefined()
    expect(keepGoing({ ...base, lastPrompt: 'Para un momento, que quiero ver una cosa' })).toBeUndefined()
    // «Para» as a preposition is an instruction to go on (12-11).
    expect(keepGoing({ ...base, lastPrompt: 'para que los claude trabajen hasta agotar créditos' })).toBeDefined()
    expect(keepGoing({ ...base, lastPrompt: 'Para mejorar la app, sigue con la lista' })).toBeDefined()
    expect(keepGoing({ ...base, lastPrompt: 'para todas las cuentas tiene que funcionar' })).toBeDefined()
    expect(keepGoing({ ...base, lastPrompt: 'para ya' })).toBeUndefined()
    expect(keepGoing({ ...base, lastPrompt: 'para de trabajar' })).toBeUndefined()
    expect(keepGoing({ ...base, lastPrompt: 'Para.' })).toBeUndefined()
    expect(keepGoing({ ...base, blocks: Array(MAX_BLOCKS).fill(now - 1000) })).toBeUndefined()
    expect(keepGoing({ ...base, blocks: Array(MAX_BLOCKS).fill(now - 3600_000) })).toBeDefined()
  })
  // 13-11: the one leaving in an overlap was told to go on again and again with nothing small left.
  it('lets the one leaving an overlap stop after two refusals in 15 minutes', () => {
    const out = { ...base, outgoing: true }
    expect(keepGoing(out)).toContain('solape')
    expect(keepGoing({ ...out, blocks: [now - 10 * 60_000] })).toContain('solape')
    expect(keepGoing({ ...out, blocks: [now - 10 * 60_000, now - 2 * 60_000] })).toBeUndefined()
    expect(keepGoing({ ...out, blocks: [now - 20 * 60_000, now - 2 * 60_000] })).toContain('solape')
    // The holder is not affected.
    expect(keepGoing({ ...base, blocks: [now - 10 * 60_000, now - 2 * 60_000] })).toContain('no termines el turno')
  })
  // EV121 (the user, 13-11: «que nunca nos quedemos parados»).
  it('with nothing left, asks for improvements here first and then names another project', () => {
    const idle = { ...base, next: [] as string[], project: 'Mission Control' }
    const alone = keepGoing(idle)!
    expect(alone).toContain('no te quedan tareas en Mission Control')
    expect(alone).toContain('docs/TASKS.md')
    expect(alone).toContain('dilo en una línea en el relevo')
    const moved = keepGoing({ ...idle, elsewhere: [{ project: 'Juego de prueba', root: 'C:\\FP', next: ['F10 Rachas', 'MP9 Menú'] }] })!
    expect(moved).toContain('Juego de prueba (C:\\FP)')
    expect(moved).toContain('F10 Rachas; MP9 Menú')
    expect(moved.indexOf('docs/TASKS.md')).toBeLessThan(moved.indexOf('Juego de prueba'))
    // The user's «para» and the refusal limit still let it stop.
    expect(keepGoing({ ...idle, lastPrompt: 'para' })).toBeUndefined()
    expect(keepGoing({ ...idle, blocks: Array(MAX_BLOCKS).fill(now - 1000) })).toBeUndefined()
    expect(keepGoing({ ...idle, autonomous: false })).toBeUndefined()
  })
})

describe('autonomous mode and plans (EV146)', () => {
  it('keeps going plans with limits, never one paying per use (it would spend until its credit ran out)', () => {
    expect(autonomyFor(undefined)).toBe(true)
    expect(autonomyFor({ paysPerUse: false })).toBe(true)
    expect(autonomyFor({ paysPerUse: true })).toBe(false)
  })
})

describe('the last prompt, past big rows (EV141, 14-11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pmc-prompt-'))
  const row = (o: object) => JSON.stringify(o) + '\n'
  const big = (n: number) => row({ type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: ['x'.repeat(n)] } })
  it('finds «Para al terminar» 470 KB back through its last-prompt row, and the stop is let through', () => {
    const f = join(dir, 'bg.jsonl')
    writeFileSync(f, row({ type: 'user', message: { role: 'user', content: 'Para al terminar. Prueba de la rueda sin ventanas' } }) + big(160_000) + big(160_000) + big(150_000)
      + row({ type: 'user', isMeta: true, message: { role: 'user', content: 'Stop hook feedback: no termines el turno' } })
      + row({ type: 'last-prompt', lastPrompt: 'Para al terminar. Prueba de la rueda sin ventanas' }) + big(30_000))
    const p = lastUserPrompt(f)
    expect(p).toMatch(/^Para al terminar/)
    expect(keepGoing({ autonomous: true, next: ['EV141 algo'], blocks: [], project: 'MC', lastPrompt: p })).toBeUndefined()
  })
  it('without last-prompt rows, a user row more than 400 KB back is still found', () => {
    const f = join(dir, 'old.jsonl')
    writeFileSync(f, row({ type: 'user', message: { role: 'user', content: 'para' } }) + big(300_000) + big(300_000))
    expect(lastUserPrompt(f)).toBe('para')
  })
  it('the newest wins: a prompt typed after the last last-prompt row', () => {
    const f = join(dir, 'new.jsonl')
    writeFileSync(f, row({ type: 'last-prompt', lastPrompt: 'para' }) + row({ type: 'user', message: { role: 'user', content: 'sigue con lo tuyo' } }))
    expect(lastUserPrompt(f)).toBe('sigue con lo tuyo')
  })
})
