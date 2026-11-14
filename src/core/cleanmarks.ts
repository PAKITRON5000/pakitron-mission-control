// The Claudes' notes for the cleaning (EV100): `pmc desechable <ruta> "por qué"` while they work («this render was a test»)
// and `pmc conservar <ruta> "por qué"` («keep it: the final cut uses it»). One small file that the app reads when it
// measures; a disposable one only becomes doubtful (set aside and watched), never deleted on a Claude's word.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { paths } from './paths'

export type Mark = { kind: 'desechable' | 'conservar'; why: string; by?: string; at: number }

export const marksFile = () => join(paths.root(), 'limpieza-notas.json')
const key = (p: string) => p.split('\\').join('/').toLowerCase()

export function readMarks(): Map<string, Mark> {
  try { return new Map(Object.entries(JSON.parse(readFileSync(marksFile(), 'utf8')) as Record<string, Mark>)) } catch { return new Map() }
}

export function addMark(path: string, kind: Mark['kind'], why: string, by?: string, cwd = process.cwd()): string {
  const full = resolve(cwd, path)
  const all = Object.fromEntries(readMarks())
  all[key(full)] = { kind, why: why.trim().slice(0, 200), by, at: Date.now() }
  writeFileSync(marksFile(), JSON.stringify(all, null, 1))
  return full
}
