// Skills inside the app (EV62; the user asked for it and it was never done): what is installed for each account and each
// project, what each one is for, how much it is used, and what would fit a project, found on skills.sh by what the
// project is (core/profile.ts). Installing and removing go through the official CLI (`npx skills`), always on a click.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ProjectKind } from './profile'

export type SkillScope = 'proyecto' | 'cuenta' | 'plugin'

export interface SkillInfo {
  name: string
  description: string
  scope: SkillScope
  /** Accounts that have it (scope cuenta or plugin). */
  accounts: string[]
  /** Projects that have it in their own `.claude/skills` (scope proyecto). */
  projects: string[]
  /** One folder where it is, to open. */
  dir: string
  /** EV119: where it came from (the skills.sh installer's registry) and when it was last brought up to date. */
  source?: string
  updatedAt?: number
}

/** Name and description from the front matter of a SKILL.md. */
export function parseSkillMd(text: string, fallback: string): { name: string; description: string } {
  const fm = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  const body = fm?.[1] ?? ''
  const field = (k: string) => {
    const m = body.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))
    if (!m) return undefined
    let v = m[1].trim()
    // A folded block («description: >» or «|») goes on in the indented lines below.
    if (/^[>|][-+]?$/.test(v)) {
      const start = body.indexOf(m[0]) + m[0].length
      const lines = body.slice(start).split(/\r?\n/)
      const more: string[] = []
      for (const l of lines.slice(1)) { if (/^\s+\S/.test(l)) more.push(l.trim()); else if (l.trim()) break }
      v = more.join(' ')
    }
    return v.replace(/^["']|["']$/g, '')
  }
  return { name: field('name') || fallback, description: (field('description') ?? '').slice(0, 400) }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

/** The skills in one `skills` folder: each subfolder with a SKILL.md. */
export function skillsIn(dir: string): { name: string; description: string; dir: string }[] {
  if (!isDir(dir)) return []
  const out: { name: string; description: string; dir: string }[] = []
  for (const e of readdirSync(dir)) {
    const d = join(dir, e)
    const f = join(d, 'SKILL.md')
    if (!existsSync(f)) continue
    try { out.push({ ...parseSkillMd(readFileSync(f, 'utf8'), e), dir: d }) } catch { /* unreadable */ }
  }
  return out
}

/** Plugin skills of an account: <config>/plugins/cache/<market>/<plugin>/<version>/skills/<name>/SKILL.md (bounded walk). */
export function pluginSkills(configDir: string): { name: string; description: string; dir: string }[] {
  const cache = join(configDir, 'plugins', 'cache')
  const out: { name: string; description: string; dir: string }[] = []
  const list = (p: string) => { try { return readdirSync(p).filter((x) => isDir(join(p, x))) } catch { return [] } }
  for (const market of list(cache)) for (const plugin of list(join(cache, market))) for (const version of list(join(cache, market, plugin))) {
    for (const s of skillsIn(join(cache, market, plugin, version, 'skills'))) out.push({ ...s, name: `${plugin}:${s.name}` })
  }
  return out
}

export interface ScanInput {
  accounts: { id: string; configDir: string }[]
  projects: { id: string; roots: string[] }[]
  /** The skills.sh installer's registry (default: ~/.agents/.skill-lock.json). */
  lockFile?: string
}

/** EV119: name → where it came from («emilkowalski/skill») and when it was updated, from the installer's registry. */
export function skillLock(file = join(homedir(), '.agents', '.skill-lock.json')): Record<string, { source: string; updatedAt?: number }> {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { skills?: Record<string, { source?: string; sourceUrl?: string; updatedAt?: string; installedAt?: string }> }
    const out: Record<string, { source: string; updatedAt?: number }> = {}
    for (const [name, s] of Object.entries(j.skills ?? {})) {
      const source = String(s.source ?? s.sourceUrl ?? '').replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '')
      if (source) out[name] = { source, updatedAt: Date.parse(s.updatedAt ?? s.installedAt ?? '') || undefined }
    }
    return out
  } catch { return {} }
}

/** Everything installed, merged by name and scope. */
export function scanSkills(i: ScanInput): SkillInfo[] {
  const map = new Map<string, SkillInfo>()
  const put = (scope: SkillScope, s: { name: string; description: string; dir: string }, account?: string, project?: string) => {
    const key = `${scope}|${s.name}`
    const cur = map.get(key) ?? { name: s.name, description: s.description, scope, accounts: [], projects: [], dir: s.dir }
    if (account && !cur.accounts.includes(account)) cur.accounts.push(account)
    if (project && !cur.projects.includes(project)) cur.projects.push(project)
    if (!cur.description && s.description) cur.description = s.description
    map.set(key, cur)
  }
  for (const a of i.accounts) {
    for (const s of skillsIn(join(a.configDir, 'skills'))) put('cuenta', s, a.id)
    for (const s of pluginSkills(a.configDir)) put('plugin', s, a.id)
  }
  for (const p of i.projects) for (const r of [...new Set(p.roots)]) for (const s of skillsIn(join(r, '.claude', 'skills'))) put('proyecto', s, undefined, p.id)
  const lock = skillLock(i.lockFile)
  for (const s of map.values()) { const l = lock[s.name]; if (l) { s.source = l.source; s.updatedAt = l.updatedAt } }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** EV144: lists scanned in parts (one account or one project at a time) merged as scanSkills merges them, by scope and name. */
export function mergeSkills(list: SkillInfo[]): SkillInfo[] {
  const map = new Map<string, SkillInfo>()
  for (const s of list) {
    const key = `${s.scope}|${s.name}`
    const cur = map.get(key)
    if (!cur) { map.set(key, { ...s, accounts: [...s.accounts], projects: [...s.projects] }); continue }
    for (const a of s.accounts) if (!cur.accounts.includes(a)) cur.accounts.push(a)
    for (const p of s.projects) if (!cur.projects.includes(p)) cur.projects.push(p)
    if (!cur.description && s.description) cur.description = s.description
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * EV144: a cheap stamp of where the skills live (when each skills folder, plugin list and the installer's registry last
 * changed). The same stamp means a saved scan still holds: opening Skills reads a dozen dates instead of every SKILL.md.
 */
export function skillsStamp(i: ScanInput): string {
  const t = (p: string) => { try { return String(Math.round(statSync(p).mtimeMs)) } catch { return '-' } }
  return [
    ...i.accounts.flatMap((a) => [t(join(a.configDir, 'skills')), t(join(a.configDir, 'plugins', 'installed_plugins.json')), t(join(a.configDir, 'plugins', 'cache'))]),
    ...i.projects.flatMap((p) => [...new Set(p.roots)].map((r) => t(join(r, '.claude', 'skills')))),
    t(i.lockFile ?? join(homedir(), '.agents', '.skill-lock.json'))
  ].join('|')
}

/** What to look for on skills.sh for each kind of project. */
export const SEARCH_TERMS: Record<ProjectKind, string[]> = {
  unity: ['unity', 'game development', 'shader'],
  unreal: ['unreal', 'game development'],
  godot: ['godot', 'game development'],
  blender: ['blender'],
  electron: ['electron', 'react', 'frontend design'],
  web: ['react', 'frontend design', 'web accessibility'],
  node: ['typescript', 'node testing'],
  python: ['python', 'python testing'],
  video: ['video editing', 'ffmpeg'],
  docs: ['technical writing', 'documentation'],
  rust: ['rust'],
  go: ['golang'],
  dotnet: ['dotnet', 'csharp'],
  java: ['java', 'kotlin'],
  android: ['android', 'kotlin'],
  flutter: ['flutter'],
  swift: ['swift', 'swiftui'],
  cpp: ['cpp', 'cmake'],
  data: ['data analysis', 'jupyter', 'data visualization'],
  writing: ['writing', 'latex', 'editing'],
  audio: ['audio', 'music production']
}

export function termsFor(kinds: ProjectKind[]): string[] {
  return [...new Set(kinds.flatMap((k) => SEARCH_TERMS[k] ?? []))].slice(0, 6)
}

export interface FoundSkill {
  /** owner/repo@skill, what `npx skills add` takes. */
  id: string
  skill: string
  source: string
  installs: number
  url?: string
  term: string
  /** What it does, from its SKILL.md (English, as its author wrote it). */
  description?: string
}

/** The skills of a repository and what each does: `npx skills add <source> -l` prints «name» and its description below. */
export function parseList(text: string): Record<string, string> {
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  const lines = clean.split(/\r?\n/).map((l) => l.replace(/^[│|]\s?/, ''))
  const out: Record<string, string> = {}
  for (let n = 0; n < lines.length; n++) {
    const name = lines[n].match(/^ {2,4}([A-Za-z0-9][\w.:-]*)\s*$/)?.[1]
    if (!name) continue
    const desc: string[] = []
    for (let k = n + 1; k < lines.length; k++) {
      const l = lines[k]
      if (!l.trim()) { if (desc.length) break; continue }
      if (/^ {5,}\S/.test(l)) desc.push(l.trim()); else break
    }
    if (desc.length) out[name] = desc.join(' ').slice(0, 400)
  }
  return out
}

/** Below this many installs a skill is not suggested (the user: «solo autores fiables con muchas instalaciones»). */
export const MIN_INSTALLS = 1000

/** The results of `npx skills find <term>`: «owner/repo@skill 9.9K installs» and its «└ url» line. */
export function parseFind(text: string, term: string): FoundSkill[] {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
  const lines = clean.split(/\r?\n/)
  const out: FoundSkill[] = []
  for (let n = 0; n < lines.length; n++) {
    const m = lines[n].match(/^\s*([\w.-]+\/[\w.-]+)@([\w.:-]+)\s+([\d.,]+)\s*([KkMm])?\s+installs?/)
    if (!m) continue
    const base = Number(m[3].replace(',', '.'))
    const installs = Math.round(base * (/k/i.test(m[4] ?? '') ? 1000 : /m/i.test(m[4] ?? '') ? 1_000_000 : 1))
    const url = lines[n + 1]?.match(/(https?:\/\/\S+)/)?.[1]
    out.push({ id: `${m[1]}@${m[2]}`, source: m[1], skill: m[2], installs, url, term })
  }
  return out
}

/**
 * Suggestions from several searches: only trusted ones (MIN_INSTALLS) that really name what was searched (12-11: «3d
 * modeling» brought a «domain-modeling» skill with a million installs), in the order skills.sh ranks them, a few of
 * each search in turn so one popular topic does not hide the others, and none already installed.
 */
export function pickSuggestions(found: FoundSkill[], installed: string[], max = 18, perTerm = 5, prefer: string[] = []): FoundSkill[] {
  const have = new Set(installed.map((s) => s.toLowerCase().replace(/^.*:/, '')))
  const words = (t: string) => t.toLowerCase().split(/\s+/).filter((w) => w.length >= 4).map((w) => w.replace(/(ment|ing|s)$/, ''))
  const byTerm = new Map<string, FoundSkill[]>()
  for (const f of found) {
    if (f.installs < MIN_INSTALLS || have.has(f.skill.toLowerCase())) continue
    const id = f.id.toLowerCase()
    if (!words(f.term).some((w) => id.includes(w))) continue
    const list = byTerm.get(f.term) ?? []
    if (!list.some((x) => x.id === f.id)) list.push(f)
    byTerm.set(f.term, list)
  }
  // What names the kind of project (unity, blender…) goes first within each search, the rest keeps skills.sh's order.
  const pref = prefer.map((k) => k.toLowerCase())
  // A project made with one engine gets nothing about another (a Unity game: no Godot, Roblox or three.js shaders).
  const ENGINES = ['unity', 'unreal', 'godot', 'roblox', 'threejs', 'phaser', 'bevy', 'gamemaker']
  const mineEngines = ENGINES.filter((e) => pref.includes(e))
  const avoid = mineEngines.length ? ENGINES.filter((e) => !mineEngines.includes(e)) : []
  for (const [t, list] of byTerm) byTerm.set(t, list.filter((f) => !avoid.some((e) => f.id.toLowerCase().includes(e))))
  for (const [t, list] of byTerm) byTerm.set(t, [...list].sort((a, b) => Number(pref.some((k) => b.id.toLowerCase().includes(k))) - Number(pref.some((k) => a.id.toLowerCase().includes(k)))))
  const out: FoundSkill[] = []
  for (let round = 0; round < perTerm && out.length < max; round++)
    for (const list of byTerm.values()) { const f = list[round]; if (f && !out.some((x) => x.id === f.id) && out.length < max) out.push(f) }
  return out
}

/** EV133: what the board says of a project's skills, counted in the background and saved (opening the board reads nothing). */
export interface SkillsTally {
  /** Skills its Claudes have there: the project's own, the accounts' and the plugins', each name once. */
  installed: number
  /** From the last search on skills.sh, the ones that would suit it and are not installed; none if never searched. */
  suggested?: number
  at: number
}

export function skillsTally(installed: SkillInfo[], projectId: string, suggested?: number, now = Date.now()): SkillsTally {
  const here = new Set(installed.filter((s) => s.scope !== 'proyecto' || s.projects.includes(projectId)).map((s) => s.name.toLowerCase().replace(/^.*:/, '')))
  return { installed: here.size, suggested, at: now }
}

/** EV167: how old a project's skill search may get before the app runs it again on its own. */
export const SKILL_SEARCH_EVERY_MS = 7 * 86_400_000

/** The project whose skills the app looks for now: the one just added (`onlyId`), else the first one never searched or searched over a week ago. */
export function projectToSearch<P extends { id: string }>(projects: P[], searchedAt: Record<string, { at: number } | undefined>, now: number, onlyId?: string): P | undefined {
  return projects.find((p) => (onlyId ? p.id === onlyId : now - (searchedAt[p.id]?.at ?? 0) > SKILL_SEARCH_EVERY_MS))
}
