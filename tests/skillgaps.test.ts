// EV191 steps 2 and 3: subjects with nothing installed searched in English, and suggestions never used dropped.
import { describe, it, expect } from 'vitest'
import { englishTerms, hintStats, neverUseful, noteGap, repeatedSubjects, usedHelper, type HintLine } from '../src/core/skillgaps'
import { roots } from '../src/core/taskhints'

describe('step 2: subjects that keep coming with nothing installed', () => {
  it('a subject in two tasks is repeated; in one, not yet', () => {
    let g = noteGap({}, 'fp', 'F1', 'Rehacer el mapa del bosque', 1000)
    expect(repeatedSubjects(g, 'fp')).toEqual([])
    g = noteGap(g, 'fp', 'F2', 'Un mapa nuevo para la ballesta', 2000)
    g = noteGap(g, 'fp', 'F2', 'Un mapa nuevo para la ballesta', 3000)
    const mapa = [...roots('mapa')][0]
    expect(repeatedSubjects(g, 'fp')).toEqual([mapa])
    expect(g.fp[mapa].tasks).toEqual(['F1', 'F2'])
  })
  it('in English: the name of a skill whose Spanish phrase says it, else the dictionary', () => {
    const es = { 'level-design': 'Diseña niveles y mapas de juego jugables', 'unity-cli': 'Maneja Unity desde fuera' }
    expect(englishTerms([...roots('mapas')], es)).toEqual(['level design'])
    expect(englishTerms([...roots('subtítulos')], {})).toEqual(['subtitles'])
    expect(englishTerms([...roots('ballesta')], es)).toEqual([])
  })
})

describe('step 3: what was suggested and what was used', () => {
  it('the hook sees a skill or agent loaded, nothing else', () => {
    expect(usedHelper({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'frontend-design:frontend-design' } })).toBe('frontend-design')
    expect(usedHelper({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'revisor-mapas' } })).toBe('revisor-mapas')
    expect(usedHelper({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })).toBeUndefined()
  })
  it('a use counts for the same account within 12 h of the suggestion', () => {
    const h = 3600_000
    const lines: HintLine[] = [
      { kind: 'dada', at: 0, account: 'claude1', names: ['level-design', 'unity-cli'] },
      { kind: 'usada', at: 1 * h, account: 'claude1', name: 'level-design' },
      { kind: 'usada', at: 1 * h, account: 'claude2', name: 'unity-cli' },
      { kind: 'dada', at: 20 * h, account: 'claude1', names: ['unity-cli'] },
      { kind: 'usada', at: 40 * h, account: 'claude1', name: 'unity-cli' }
    ]
    expect(hintStats(lines)).toEqual({ 'level-design': { given: 1, used: 1 }, 'unity-cli': { given: 2, used: 0 } })
  })
  it('given five times and never used: not suggested any more', () => {
    const lines: HintLine[] = Array.from({ length: 5 }, (_, i) => ({ kind: 'dada' as const, at: i * 100 * 3600_000, account: 'claude1', names: ['ruido'] }))
    expect([...neverUseful(hintStats(lines))]).toEqual(['ruido'])
    expect(neverUseful(hintStats(lines.slice(0, 4))).size).toBe(0)
  })
})
