// Skills set aside (EV95: «cuáles llevan 2 semanas sin usarse, con un botón para apartarlas»). Every skill a session can
// load adds its description to every session; one not used in a project can be moved out of `skills` into
// `skills-apartadas`, next to it, where Claude Code does not look, and brought back the same way. Nothing is deleted.
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const swap = (dir: string, from: string, to: string): string => {
  const parent = dirname(dir)
  if (basename(parent).toLowerCase() !== from) throw new Error(`No es una carpeta de ${from}`)
  if (!existsSync(dir)) throw new Error('Esa skill ya no está ahí')
  const target = join(dirname(parent), to, basename(dir))
  if (existsSync(target)) throw new Error(`Ya hay una con ese nombre en ${to}`)
  mkdirSync(dirname(target), { recursive: true })
  renameSync(dir, target)
  return target
}

/** Moves a skill out of reach of the sessions; returns where it went. */
export const setAside = (dir: string): string => swap(dir, 'skills', 'skills-apartadas')

/** Puts a skill set aside back where the sessions find it. */
export const bringBack = (dir: string): string => swap(dir, 'skills-apartadas', 'skills')

/** The skills set aside next to a `skills` folder's parent (an account's folder or a project's `.claude`). */
export function asideIn(base: string): string[] {
  const d = join(base, 'skills-apartadas')
  try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(d, e.name)) } catch { return [] }
}
