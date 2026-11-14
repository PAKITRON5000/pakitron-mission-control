import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTasks } from '../src/core/parse/tasks'
import { parseRelevo } from '../src/core/parse/relevo'
import { parseCreditsFile, parseWakeLog } from '../src/core/parse/limits'
import { buildUsage } from '../src/core/accounts'
import { guessKind } from '../src/core/review'

beforeAll(() => {
  process.env.PMC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pmc-'))
})

describe('TASKS.md', () => {
  const md = [
    '# Tareas',
    '## Lo que dejó a medias claude1 (asignado a claude3 el 1-11)',
    '- [ ] C1a · Plumas de la Arquera: una con sombra oscura en el borde.',
    '- [~] F10 · **Cada castillo distinto en cada mapa:** forma y materiales. Hecho: remate.',
    '## Otra',
    '- [x] BZ54 · *Hecho y visto (1-11): en JUGAR sonríe.* **Gesto del cerdito del menú:** «cuando se abre…»',
    '- [x] PJ2: cuerpo nuevo para los siete oficios.',
    '  - [ ] Tirolina del castillo bien puesta.',
    '- [~] RA7 · *En curso (31-10, claude3, rama `rachas`): esculpidas por volumen*',
    '- [~] SV9 · Dónde se aparece (lo propone el usuario y está por decidir con él)'
  ].join('\n')
  const t = parseTasks(md)
  it('reads ids, titles and marks', () => {
    expect(t.map((x) => x.extId)).toEqual(['C1a', 'F10', 'BZ54', 'PJ2', undefined, 'RA7', 'SV9'])
    expect(t[1].title).toBe('Cada castillo distinto en cada mapa')
    expect(t[2].title).toBe('Gesto del cerdito del menú')
    expect(t[2].agentChecked).toBe(true)
    expect(t[3].agentChecked).toBe(false)
    expect(t[4].depth).toBe(1)
  })
  it('owner from section and from "En curso"', () => {
    expect(t[0].owner).toBe('claude3')
    expect(t[5].owner).toBe('claude3')
  })
  it('status mapping', () => {
    expect(t[0].status).toBe('pendiente')
    expect(t[1].status).toBe('en-desarrollo')
    expect(t[2].status).toBe('terminada')
    expect(t[6].status).toBe('revision')
  })
  it('a half-done task belongs to the account that signs its latest note, not to any account it names (12-11)', () => {
    const own = (line: string) => parseTasks(line)[0].owner
    expect(own('- [~] EV32 · *Primera medida (12-11, 12:40): solo 8 al genérico (claude1 y claude5).* Medir')).toBeUndefined()
    expect(own('- [~] F10 · *12-11 (claude6): reabierta.* Antes: Hecho (26-10, claude3).')).toBe('claude6')
    expect(own('- [~] APP6-3 · *(claude1, 11-11: `src/a.ts` (guion con Opus)).* Guion')).toBe('claude1')
    expect(own('- [~] A7 · **Usuario (8-11, 15:40): «bots».** *Causa encontrada (claude3): el vigilante.*')).toBe('claude3')
    expect(own('- [~] APP5 · Rediseño (usuario, 10-11). Fable lo repartió; claude6 lo sigue.')).toBe('claude6')
  })
  it('a leading italic note is detail whatever word it starts with (EV28 read as «Primera parte», 12-11)', () => {
    const [x] = parseTasks('- [~] EV28 · *Primera parte (12-11, 0.13.15, claude6): la cuenta que vuelve sigue en ella.* Relevos sin perder la ventana (el usuario, 12-11): que retome su conversación.')
    expect(x.title).toBe('Relevos sin perder la ventana')
    // An italic that is the whole line stays the title.
    expect(parseTasks('- [ ] Z1 · *Solo cursiva*')[0].title).toBe('Solo cursiva')
  })
})

describe('RELEVO.md', () => {
  it('reads heartbeats with account', () => {
    const r = parseRelevo(
      [
        '**Último latido:** 2026-11-01 23:55 · claude3 · **Ramas unificadas en `rachas`** (copia).',
        '**Latido anterior (claude1, cabeza):** 2026-11-01 21:04 · claude1 (`juego-02`) · Golpes de los 7 oficios.',
        '## Latido: 2026-10-31 20:39 (claude4 retoma tras claude1)',
        '**En curso (desde el 30-10, prioridad del usuario):** personajes nuevos según las fichas.'
      ].join('\n'),
      'RELEVO.md'
    )
    expect(r.heartbeats.map((h) => h.account)).toEqual(['claude3', 'claude1', 'claude4'])
    expect(r.heartbeats[0].text.startsWith('Ramas unificadas en rachas')).toBe(true)
    expect(r.heartbeats[1].text.startsWith('Golpes')).toBe(true)
    expect(new Date(r.heartbeats[0].at).getHours()).toBe(23)
    expect(r.enCurso).toContain('personajes nuevos')
  })
})

describe('limits', () => {
  it('credits file', () => {
    const h = parseCreditsFile('2026-11-02 00:40;2026-11-02 03:40;5 horas;8a1b3f2d')!
    expect(h.kind).toBe('5 horas')
    expect(new Date(h.resetsAt).getHours()).toBe(3)
    expect(h.sessionShort).toBe('8a1b3f2d')
  })
  it('wake.log', () => {
    const l = parseWakeLog(
      "2026-11-01 12:21:53 [73172] 80f0223a limit: 'You've hit your weekly limit · resets Nov 6, 7am (Europe/Madrid)' -> sleeping until 2026-11-06 07:02:00\n" +
        '2026-11-01 22:42:00 [83240] 8a1b3f2d waking the session'
    )
    expect(l).toHaveLength(1)
    expect(l[0].kind).toBe('semanal')
    expect(new Date(l[0].resetsAt).getMinutes()).toBe(0)
  })
  // Prueba A / I: an account at its limit reads "sin uso" until its reset; stale data is not invented.
  it('active limit until reset, cleared by later activity', () => {
    const now = new Date(2026, 10, 2, 4, 0).getTime()
    const hit = { kind: 'semanal' as const, at: now - 3600_000, resetsAt: now + 86400_000, source: 'wake_log' as const }
    expect(buildUsage('claude1', [hit], undefined, now).activeLimit).toBeTruthy()
    expect(buildUsage('claude1', [hit], now - 60_000, now).activeLimit).toBeUndefined()
    // «La he recargado»: the user's word clears a limit hit before it, not one hit after.
    expect(buildUsage('claude1', [hit], undefined, now, hit.at + 1000).activeLimit).toBeUndefined()
    expect(buildUsage('claude1', [hit], undefined, now, hit.at - 1000).activeLimit).toBeTruthy()
    const old = { ...hit, resetsAt: now - 1 }
    const u = buildUsage('claude1', [old], undefined, now)
    expect(u.activeLimit).toBeUndefined()
    expect(u.lastLimit).toBeTruthy()
    expect(u.snapshot).toBeUndefined()
  })
})

describe('instruction routing', () => {
  it('guesses kinds', () => {
    expect(guessKind('Quiero añadir una nueva mecánica al juego, guárdala en ideas').kind).toBe('idea')
    expect(guessKind('Claude 4, encárgate de mejorar los materiales del castillo')).toMatchObject({ kind: 'mensaje', target: 'claude4' })
    expect(guessKind('Prioriza solucionar los errores visuales antes de seguir').kind).toBe('prioridad')
    expect(guessKind('La espada atraviesa el cuerpo del enemigo. Corrige esta animación.').kind).toBe('correccion')
  })
})
