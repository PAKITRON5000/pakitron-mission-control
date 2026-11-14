import { t } from './i18n'
// EV145 (Decidir #149 «A», the user, 13-11): a skill of the accounts that only one project uses is taken to that project.
// The accounts' skills reach every session of every project (here the six accounts even share one folder): the Unity,
// Blender and game ones weighed on every Mission Control session without ever being used. Taken to its project, it is
// copied into each of its work copies (`.claude/skills/<name>`, kept out of git so it does not show as a change), and set
// aside in the accounts (core/skillaside.ts: moved, never deleted). Written down, so «Devolver» puts everything back.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from './paths'
import { bringBack, setAside } from './skillaside'

export interface MovedSkill { name: string; projectId: string; aside: string[]; placed: string[]; at: number }

export const movedFile = () => join(paths.root(), 'skills-llevadas.json')

export function readMoved(file = movedFile()): Record<string, MovedSkill> {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, MovedSkill> } catch { return {} }
}

const writeMoved = (all: Record<string, MovedSkill>, file: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(all, null, 1)) }

/** The git «exclude» file of a project's main folder (shared by all its work copies), if it has one. */
export function gitExcludeOf(root: string): string | undefined {
  try { return statSync(join(root, '.git')).isDirectory() ? join(root, '.git', 'info', 'exclude') : undefined } catch { return undefined }
}

function exclude(file: string, line: string): void {
  let cur = ''
  try { cur = readFileSync(file, 'utf8') } catch { /* new */ }
  if (cur.split(/\r?\n/).includes(line)) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
}

export function takeSkillToProject(o: { name: string; projectId: string; accountSkillDirs: string[]; copies: string[]; gitExclude?: string }, file = movedFile(), now = Date.now()): MovedSkill {
  if (!/^[\w.:-]+$/.test(o.name)) throw new Error(t('Nombre de skill raro: {name}', { name: o.name }))
  // Accounts that share one skills folder (a link to another account's) count once.
  const bySkillsDir = new Map<string, string>()
  for (const d of o.accountSkillDirs) {
    const p = join(d, o.name)
    if (!existsSync(join(p, 'SKILL.md'))) continue
    try { const key = realpathSync(d).toLowerCase(); if (!bySkillsDir.has(key)) bySkillsDir.set(key, p) } catch { /* gone */ }
  }
  const sources = [...bySkillsDir.values()]
  if (!sources.length) throw new Error(t('{name} no está en las skills de ninguna cuenta', { name: o.name }))
  const content = realpathSync(sources[0])
  const placed: string[] = []
  for (const c of [...new Set(o.copies)]) {
    const target = join(c, '.claude', 'skills', o.name)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    cpSync(content, target, { recursive: true, dereference: true })
    placed.push(target)
  }
  const aside = sources.map((s) => setAside(s))
  if (o.gitExclude) exclude(o.gitExclude, `.claude/skills/${o.name}/`)
  const m: MovedSkill = { name: o.name, projectId: o.projectId, aside, placed, at: now }
  const all = readMoved(file)
  all[o.name] = m
  writeMoved(all, file)
  return m
}

/** Puts a skill taken to a project back in the accounts, and takes away only the copies that were placed for it. */
export function returnSkill(name: string, file = movedFile()): MovedSkill {
  const all = readMoved(file)
  const m = all[name]
  if (!m) throw new Error(t('{name} no se llevó a ningún proyecto', { name: name }))
  for (const a of m.aside) if (existsSync(a)) bringBack(a)
  for (const p of m.placed) if (existsSync(join(p, 'SKILL.md'))) rmSync(p, { recursive: true, force: true })
  delete all[name]
  writeMoved(all, file)
  return m
}
