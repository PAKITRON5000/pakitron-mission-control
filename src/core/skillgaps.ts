// EV191, steps 2 and 3 (the user, 15-11 04:10: «que haya algún agente que detecte cuándo se necesita alguna skill… o
// aunque no esté instalada… optimizándolo para que no chupe demasiado»). No model anywhere:
// 2) a task reserved with no installed skill or agent that fits leaves its subjects here; a subject that comes back in
//    several tasks is searched on skills.sh (in English, from the names of the skills whose Spanish phrase says it, or a
//    short dictionary), at most once a day per project, and what turns up waits in Skills for the user to install;
// 3) what `pmc claim` suggested to each account, and what that account loaded afterwards (the hook sees the Skill and
//    Agent tools): a suggestion given many times and never used stops being given.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'
import { roots } from './taskhints'

// ---- step 2: subjects with nothing installed for them ----------------------------------------------------------------

export type Gaps = Record<string, Record<string, { tasks: string[]; at: number }>>

const GAPS_KEEP_MS = 30 * 86_400_000
export const gapsFile = (): string => join(paths.root(), 'skill-gaps.json')

/** Adds a task's subjects to its project's gaps (each subject with the tasks that had it); old ones leave. */
export function noteGap(gaps: Gaps, projectId: string, taskId: string, taskText: string, now = Date.now()): Gaps {
  const here = { ...(gaps[projectId] ?? {}) }
  for (const r of roots(taskText)) {
    const g = here[r] ?? { tasks: [], at: now }
    here[r] = { tasks: g.tasks.includes(taskId) ? g.tasks : [...g.tasks, taskId].slice(-8), at: now }
  }
  // The 60 most recent subjects, none older than a month.
  const kept = Object.entries(here).filter(([, g]) => now - g.at < GAPS_KEEP_MS).sort((a, b) => b[1].at - a[1].at).slice(0, 60)
  return { ...gaps, [projectId]: Object.fromEntries(kept) }
}

/** The subjects that came back in `min` tasks or more, the most repeated first. */
export function repeatedSubjects(gaps: Gaps, projectId: string, min = 2): string[] {
  return Object.entries(gaps[projectId] ?? {}).filter(([, g]) => g.tasks.length >= min)
    .sort((a, b) => b[1].tasks.length - a[1].tasks.length || b[1].at - a[1].at).map(([r]) => r)
}

// Spanish task words → what skills.sh calls them, for the subjects no skill's Spanish phrase covers yet. Keyed by the
// same roots tasks are cut to (taskhints.ts › roots).
const DICT_WORDS: Record<string, string> = {
  mapa: 'level design', nivel: 'level design', escenario: 'level design', terreno: 'terrain',
  sonido: 'game audio', musica: 'music production', audio: 'audio', voz: 'voice',
  animacion: 'animation', personaje: 'character design', enemigo: 'enemy ai', jefe: 'boss design',
  textura: 'texturing', material: 'materials', sombreado: 'shaders', shader: 'shaders', iluminacion: 'lighting',
  modelo: '3d modeling', modelado: '3d modeling', malla: '3d modeling', render: 'rendering',
  interfaz: 'ui design', menu: 'ui design', boton: 'ui design', pantalla: 'ui design', tienda: 'in-app purchases',
  fisica: 'physics', colision: 'physics', camara: 'camera', particula: 'particles', efecto: 'visual effects',
  rendimiento: 'performance', memoria: 'performance', optimizacion: 'performance',
  prueba: 'testing', test: 'testing', error: 'debugging', fallo: 'debugging',
  traduccion: 'localization', idioma: 'localization', subtitulo: 'subtitles',
  video: 'video editing', montaje: 'video editing', corte: 'video editing', miniatura: 'thumbnail',
  guion: 'scriptwriting', copy: 'copywriting', texto: 'writing', documentacion: 'documentation',
  base: 'database', dato: 'data analysis', grafica: 'data visualization', red: 'networking', servidor: 'backend',
  movil: 'mobile', android: 'android', publicar: 'deployment', despliegue: 'deployment', seguridad: 'security',
  accesibilidad: 'accessibility', diseño: 'design', logo: 'logo design', icono: 'icons', tipografia: 'typography'
}
let dict: Record<string, string> | undefined
const dictionary = (): Record<string, string> => {
  if (dict) return dict
  dict = {}
  for (const [w, term] of Object.entries(DICT_WORDS)) for (const r of roots(w)) dict[r] ??= term
  return dict
}

/** Generic words of skill names that say nothing searchable on their own. */
const NAME_STOP = new Set(['skill', 'skills', 'guide', 'helper', 'tool', 'tools', 'create', 'make', 'build', 'best', 'practices',
  'pro', 'expert', 'master', 'with', 'and', 'for', 'the', 'new', 'advanced', 'basic', 'agent', 'agents'])

/**
 * English search terms for some subjects: the name of a skill whose Spanish phrase says the subject (the shortest, two or
 * three words: «level-design» → «level design»), else the dictionary. Up to `max`, none twice.
 */
export function englishTerms(subjects: string[], spanish: Record<string, string>, max = 3): string[] {
  const out: string[] = []
  const phrases = Object.entries(spanish).map(([name, es]) => ({ name: name.split(':').pop()!, es: roots(es) }))
  for (const s of subjects) {
    if (out.length >= max) break
    const names = phrases.filter((p) => p.es.has(s)).map((p) => p.name.split(/[-_.]+/).filter((w) => w.length >= 3 && !NAME_STOP.has(w.toLowerCase())))
      .filter((w) => w.length >= 1 && w.length <= 3).sort((a, b) => a.length - b.length || a.join(' ').length - b.join(' ').length)
    const term = (names.find((w) => w.length >= 2) ?? names[0])?.join(' ').toLowerCase() ?? dictionary()[s]
    if (term && !out.includes(term)) out.push(term)
  }
  return out
}

/** Reads and writes the gaps file; never throws (advice only). */
export function readGaps(): Gaps {
  try { return JSON.parse(readFileSync(gapsFile(), 'utf8')) as Gaps } catch { return {} }
}
export function writeGaps(g: Gaps): void {
  try { writeFileSync(gapsFile(), JSON.stringify(g)) } catch { /* next time */ }
}

// ---- step 3: what was suggested, and what was used -------------------------------------------------------------------

export type HintLine = { kind: 'dada'; at: number; account: string; project?: string; task?: string; names: string[] } | { kind: 'usada'; at: number; account: string; name: string }
export const hintsLog = (): string => join(paths.root(), 'sugerencias.jsonl')

/** A use counts for a suggestion given to the same account up to this long before. */
const USE_WINDOW_MS = 12 * 3600_000

/** The skill or agent a tool call loads (Skill tool, Agent or Task tool); undefined for any other tool. */
export function usedHelper(data: any): string | undefined {
  if (data?.hook_event_name !== 'PreToolUse') return undefined
  const tool = String(data?.tool_name ?? '')
  const input = data?.tool_input ?? {}
  if (tool === 'Skill' && typeof input.skill === 'string') return input.skill.split(':').pop()!.trim() || undefined
  if ((tool === 'Agent' || tool === 'Task') && typeof input.subagent_type === 'string') return input.subagent_type.trim() || undefined
  return undefined
}

export function appendHint(line: HintLine): void {
  try {
    const f = hintsLog()
    // Kept small: past 400 KB, the newest 1500 lines stay.
    if (existsSync(f) && statSync(f).size > 400 * 1024) writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-1500).join('\n') + '\n')
    appendFileSync(f, JSON.stringify(line) + '\n')
  } catch { /* advice only */ }
}

export function readHints(): HintLine[] {
  try { return readFileSync(hintsLog(), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as HintLine] } catch { return [] } }) } catch { return [] }
}

/** For each name: how many times it was suggested, and how many of those the account then loaded it (within 12 h). */
export function hintStats(lines: HintLine[]): Record<string, { given: number; used: number }> {
  const out: Record<string, { given: number; used: number }> = {}
  const sorted = [...lines].sort((a, b) => a.at - b.at)
  for (const [i, l] of sorted.entries()) {
    if (l.kind !== 'dada') continue
    for (const n of l.names) {
      const s = (out[n] ??= { given: 0, used: 0 })
      s.given++
      // Used if that account loaded it before the window closed or the next suggestion of the same name came.
      const next = sorted.slice(i + 1).find((x) => x.kind === 'dada' && x.account === l.account && x.names.includes(n))
      const until = Math.min(l.at + USE_WINDOW_MS, next?.at ?? Infinity)
      if (sorted.some((x) => x.kind === 'usada' && x.account === l.account && x.name === n && x.at >= l.at && x.at <= until)) s.used++
    }
  }
  return out
}

/** The names given this many times or more and never used: not suggested any more. */
export function neverUseful(stats: Record<string, { given: number; used: number }>, after = 5): Set<string> {
  return new Set(Object.entries(stats).filter(([, s]) => s.given >= after && s.used === 0).map(([n]) => n))
}
