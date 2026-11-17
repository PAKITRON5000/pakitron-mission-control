// EV205 (the user, 16-11 19:40: «no sé si hay ya alguna skill que instale las skills sugeridas o que cuando toque según
// lo que pida el usuario se le instalen, deberíamos hacerlo»; and «un botón de "instalar todas las skills sugeridas"… o
// que claude detecte y entienda cuales sí y cuales no»). The app already searched skills.sh alone for each project; now it
// also installs the few most trusted that fit, in the project only (the accounts' skills weigh on every session of every
// project: Decidir #149), out of git, written down as «put by the app», and never again one the user took away.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from './paths'
import type { FoundSkill } from './skills'

/** Installed alone only above this many installs (suggested from 1000: MIN_INSTALLS). */
export const AUTO_MIN_INSTALLS = 5000
/** At most this many put alone in a project at each search: each one's description is read by every session there. */
export const AUTO_MAX = 3

export interface AutoRecord { auto: { name: string; id: string; at: number; by: string }[]; removed: string[] }
export const autoFile = (): string => join(paths.root(), 'skills-puestas.json')

export function readAuto(file = autoFile()): Record<string, AutoRecord> {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, AutoRecord> } catch { return {} }
}

function writeAuto(all: Record<string, AutoRecord>, file: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 1))
}

const rec = (all: Record<string, AutoRecord>, projectId: string): AutoRecord => (all[projectId] ??= { auto: [], removed: [] })
const bare = (s: string) => s.toLowerCase().replace(/^.*[:@]/, '')

/**
 * The ones that fit well enough to go in without asking: from the suggestions (already only trusted authors, naming what
 * was searched, none installed, in skills.sh's order with the project's kind first), the very popular ones, none the user
 * removed from this project, at most `max`.
 */
export function pickAutoInstall(suggestions: FoundSkill[], removed: string[], max = AUTO_MAX, min = AUTO_MIN_INSTALLS): FoundSkill[] {
  const gone = new Set(removed.map(bare))
  return suggestions.filter((f) => f.installs >= min && !gone.has(bare(f.skill))).slice(0, max)
}

/** Written down when the app (or a Claude with pmc skills-instala) puts one: Skills says so, and it can be told apart. */
export function noteInstalled(projectId: string, f: { name: string; id: string; by: string }, file = autoFile(), now = Date.now()): void {
  const all = readAuto(file)
  const r = rec(all, projectId)
  r.auto = [...r.auto.filter((x) => bare(x.name) !== bare(f.name)), { ...f, at: now }]
  r.removed = r.removed.filter((x) => bare(x) !== bare(f.name))
  writeAuto(all, file)
}

/** The user took one away from the project: it is never put there alone again (a click on «Instalar» still does). */
export function noteRemoved(projectId: string, name: string, file = autoFile()): void {
  const all = readAuto(file)
  const r = rec(all, projectId)
  r.auto = r.auto.filter((x) => bare(x.name) !== bare(name))
  if (!r.removed.some((x) => bare(x) === bare(name))) r.removed.push(name)
  writeAuto(all, file)
}

/** What `npx skills add` takes: owner/repo@skill. */
export const SKILL_ID_RE = /^[\w.-]+\/[\w.-]+@[\w.:-]+$/

/**
 * EV205 step 3: why `pmc skills-instala <id>` will not put one (undefined: it can). The same trust as the suggestions:
 * skills.sh must list that exact one with at least `min` installs (searched by its name), and the user must not have
 * taken it away from this project (then it is the user's to bring back, from Skills).
 */
export function refuseInstall(id: string, found: FoundSkill[], removed: string[], min: number): 'nombre' | 'desconocida' | 'pocas' | 'quitada' | undefined {
  if (!SKILL_ID_RE.test(id)) return 'nombre'
  const name = id.split('@')[1]
  if (removed.some((x) => bare(x) === bare(name))) return 'quitada'
  const f = found.find((x) => x.id.toLowerCase() === id.toLowerCase())
  if (!f) return 'desconocida'
  if (f.installs < min) return 'pocas'
  return undefined
}

/**
 * EV205 step 3: what `pmc skills-busca "tema"` lists: skills.sh's results for that search that are trusted (min installs)
 * and not installed yet, in its order. No «names what was searched» rule here (the app's own search needs it to keep
 * «3d modeling» from bringing «domain-modeling»): a Claude reads them and picks.
 */
export function pickForSearch(found: FoundSkill[], installed: string[], min: number, max = 8): FoundSkill[] {
  const have = new Set(installed.map(bare))
  const out: FoundSkill[] = []
  for (const f of found) if (f.installs >= min && !have.has(bare(f.skill)) && !out.some((x) => x.id === f.id)) out.push(f)
  return out.slice(0, max)
}

/**
 * A skill installed in a project's folder is kept out of its git (it is not the user's work), as EV145 does; so is the
 * `skills-lock.json` the skills CLI leaves at the top (17-11: a test install left it as a new file for `git status`).
 * Only untracked files are affected: a project that keeps its own lock file in git goes on as it was.
 */
export function excludeFromGit(gitExclude: string | undefined, name: string): void {
  if (!gitExclude) return
  let cur = ''
  try { cur = readFileSync(gitExclude, 'utf8') } catch { /* new */ }
  const have = cur.split(/\r?\n/)
  const add = [`.claude/skills/${name}/`, '/skills-lock.json'].filter((l) => !have.includes(l))
  if (!add.length) return
  if (!existsSync(dirname(gitExclude))) mkdirSync(dirname(gitExclude), { recursive: true })
  appendFileSync(gitExclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`)
}
