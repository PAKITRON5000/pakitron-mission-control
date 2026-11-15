// EV191 (the user, 15-11 04:05: «que haya algún agente que detecte cuándo se necesita alguna skill o cuando alguna skill
// va a ser más útil y se la dé al claude que está trabajando… o que lo que vaya a hacer lo haga mejor con un programa
// abierto, plugin o skill… optimizándolo para que no chupe demasiado»). When a Claude reserves a task, the skills it can
// load, the project's agents and the programs open that fit it, found by their words: no model, no tokens, one line.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSkillMd, pluginSkills, skillsIn } from './skills'
import { t } from './i18n'

export interface Helper { kind: 'skill' | 'agente'; name: string; description: string; es?: string }

const STOP = new Set(('para como cuando donde desde hasta sobre entre este esta estos estas todo toda todos todas cada ' +
  'pero porque tambien solo sola mismo misma hace hacer hecho tiene tener puede poder debe deben sirve usar usado ' +
  'with when what that this from your into have will about which them they then than more most also only each ' +
  'skill skills claude tarea tareas project proyecto archivo archivos usar using used make made should could would ' +
  'here there such some other others like just ' +
  // Verbs any task has («arreglar», «sigue lo de claude6»): they matched half the skills of the game project.
  'arreglar arregla arreglo seguir sigue siguen mejorar mejora cambiar cambia poner pone quitar quita anadir anade crear crea ' +
  'revisar revisa hacerlo dejar deja falta faltan nuevo nueva nuevos nuevas cosa cosas parte partes bien vez veces').split(' '))

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** The words that say something, cut to a common root (plurals and endings: «mapas» and «mapa», «modelado» and «modelos»). */
export function roots(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of strip(s).split(/[^a-z0-9ñ]+/)) {
    // «claude6», «F10b», «EV191»: the word without its number or code.
    const w = raw.replace(/\d+[a-z]?$/, '')
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue
    // Endings off, up to six letters: «mapas» and «mapa», «modelado» and «modelos», «texturas» and «texturing» meet;
    // «explanada» and «explain» do not (with five letters they did, and a map task got a code-map skill).
    const stem = w.replace(/(aciones|acion|ciones|cion|ados|adas|ado|ada|idos|idas|ido|ida|ando|iendo|mente|ing|es|s)$/, '').replace(/[aeo]$/, '')
    if (stem.length >= 3) out.add(stem.slice(0, 6))
  }
  return out
}

/** The best fits for a task, best first: a word of its name counts three times what a word of its description counts. */
export function bestHelpers(taskText: string, helpers: Helper[], max = 3): (Helper & { score: number })[] {
  const task = roots(taskText)
  if (!task.size) return []
  const scored = helpers.map((h) => {
    const name = roots(h.name.replace(/[-_:./]+/g, ' '))
    const desc = roots(`${h.description} ${h.es ?? ''}`)
    let inName = 0
    let inDesc = 0
    for (const w of task) { if (name.has(w)) inName++; else if (desc.has(w)) inDesc++ }
    return { ...h, score: inName * 3 + inDesc, inName, inDesc }
  })
  // Anything that shares a word with the task, best first and three at most (a task is a line or two: one shared word
  // of the Spanish description, «mapa», is often all there is).
  return scored.filter((h) => h.inName > 0 || h.inDesc >= 1).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, max)
    .map(({ inName: _n, inDesc: _d, ...h }) => h)
}

/** The agents of a project (`.claude/agents/*.md`, name and description from their front matter). */
export function agentsIn(dir: string): Helper[] {
  const d = join(dir, '.claude', 'agents')
  if (!existsSync(d)) return []
  const out: Helper[] = []
  for (const f of readdirSync(d).filter((x) => x.endsWith('.md'))) {
    try { const a = parseSkillMd(readFileSync(join(d, f), 'utf8'), f.replace(/\.md$/, '')); out.push({ kind: 'agente', name: a.name, description: a.description }) } catch { /* unreadable */ }
  }
  return out
}

/** Everything a session there can load: the project's skills, its account's, its account's plugins', and the project's agents. */
export function helpersFor(o: { cwd: string; configDir?: string; spanish?: Record<string, string> }): Helper[] {
  const es = o.spanish ?? {}
  const seen = new Set<string>()
  const out: Helper[] = []
  const add = (list: { name: string; description: string }[]) => {
    for (const s of list) if (!seen.has(s.name)) { seen.add(s.name); out.push({ kind: 'skill', name: s.name, description: s.description, es: es[s.name] ?? es[s.name.split(':').pop()!] }) }
  }
  add(skillsIn(join(o.cwd, '.claude', 'skills')))
  if (o.configDir) { add(skillsIn(join(o.configDir, 'skills'))); add(pluginSkills(o.configDir)) }
  return [...out, ...agentsIn(o.cwd)]
}

/** The programs open that a task of this kind does better with (its words, and what is running now). */
export function openPrograms(taskText: string, busy: { unityEditors: number; blender: number; userApps: string[] }): string[] {
  const w = strip(taskText)
  const out: string[] = []
  if (busy.unityEditors > 0 && /unity|escena|prefab|nivel|mapa|scene|level|build|jugador|enemig/.test(w)) out.push(t('Unity está abierto (míralo con pmc recursos antes de compilar)'))
  if (busy.blender > 0 && /blender|modelo|malla|textura|render|3d|mesh|rig/.test(w)) out.push(t('Blender está abierto'))
  if (busy.userApps.includes('Premiere') && /video|montaje|premiere|corte|clip|subtitul/.test(w)) out.push(t('Premiere está abierto (con su conexión MCP)'))
  return out
}

/** The line a Claude reads after reserving the task; empty when nothing fits. */
export function hintsLine(found: Helper[], programs: string[]): string {
  if (!found.length && !programs.length) return ''
  const one = (h: Helper) => {
    const say = (h.es ?? h.description).replace(/\s+/g, ' ').trim()
    const short = say.length > 70 ? say.slice(0, 70).replace(/\s+\S*$/, '') + '…' : say
    return h.kind === 'agente' ? t('el agente {name} ({what})', { name: h.name, what: short }) : t('la skill {name} ({what})', { name: h.name, what: short })
  }
  return t('Para esta tarea te puede servir: {list}. Úsalo si encaja; no gasta nada hasta que lo cargas.', { list: [...found.map(one), ...programs].join('; ') })
}
