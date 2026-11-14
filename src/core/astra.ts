// What Astra (the Codex app the user draws with) delivers lands outside the projects, in Documents\Codex\<date>\<chat>.
// Until 12-11 a project's gallery only took the folders its notes cited (5 of 57). The chat folder's name usually says
// whose it is («hola-astra-soy-claude-mi-juego», «encargo-para-astra-el-proyecto-de-ciencia», «castillos»): it is
// placed in that project by the same reading that routes requests (core/route.ts), when one project clearly stands out.
// The user asked for it (12-11): «colocación de carpetas para el usuario sin que tenga que colocar él la galería».
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { guessProject, type RouteProject } from './route'

const IMAGE = /\.(png|jpe?g|webp|gif)$/i

/** An image in the folder or a few levels below (Astra often leaves them in a subfolder of the chat). */
function hasImages(dir: string, depth: number, budget = { n: 400 }): boolean {
  let entries: import('node:fs').Dirent[] = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    if (--budget.n < 0) return false
    if (e.isFile() && IMAGE.test(e.name)) return true
  }
  if (depth > 0) for (const e of entries) if (e.isDirectory() && hasImages(join(dir, e.name), depth - 1, budget)) return true
  return false
}

/** Every chat folder of Astra's with at least one image in it, newest date first. */
export function codexChats(codex = join(homedir(), 'Documents', 'Codex')): { dir: string; name: string }[] {
  const out: { dir: string; name: string }[] = []
  let days: string[] = []
  try { days = readdirSync(codex).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() } catch { return out }
  for (const day of days) {
    let chats: string[] = []
    try { chats = readdirSync(join(codex, day), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { continue }
    for (const c of chats) {
      const dir = join(codex, day, c)
      if (hasImages(dir, 3)) out.push({ dir, name: c })
    }
  }
  return out
}

/** Which project each chat folder not yet placed belongs to, when its name points clearly to one. */
export function placeCodexChats(chats: { dir: string; name: string }[], projects: RouteProject[], taken: Set<string>): { dir: string; projectId: string; why: string }[] {
  const out: { dir: string; projectId: string; why: string }[] = []
  for (const c of chats) {
    if (taken.has(c.dir.toLowerCase())) continue
    const g = guessProject(c.name.replace(/[-_]+/g, ' '), projects)
    // A folder name is a few words: it must name the project, or have three words only that project uses (13-11: «importante
    // sobre el contexto esta es», a CV app, went to Mission Control for «importante» and «contexto»).
    if (g && (g.byName > 0 || g.own >= 3)) out.push({ dir: c.dir, projectId: g.id, why: g.why })
  }
  return out
}
