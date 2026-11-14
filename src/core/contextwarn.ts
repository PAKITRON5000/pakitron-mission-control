// When a conversation's context is getting full (EV93; research, D1-D3: Claude works worse the fuller it is, and at
// the end it is compacted). The status line already writes each session's `context_window.used_percentage` to its live
// file; after a file write, the session is told once at 60 % and once at 80 % to leave its hand-off ready.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

export const CONTEXT_WARN_AT = [60, 80] as const

/** The warning due now for a session at `pct` % of its context, given the levels already said; undefined if none. */
export function contextWarning(pct: number | undefined | null, said: number[]): { level: number; text: string } | undefined {
  if (typeof pct !== 'number') return undefined
  const level = [...CONTEXT_WARN_AT].reverse().find((l) => pct >= l)
  if (!level || said.includes(level)) return undefined
  const text = level >= 80
    ? `Mission Control: esta conversación lleva el ${Math.round(pct)} % de su contexto y pronto se compactará. Deja ya el relevo listo (pmc guarda "…" --probado "…" --siguiente "…" --no-rehacer "…") y sigue con pasos pequeños: lo que no esté escrito puede perderse en el resumen.`
    : `Mission Control: esta conversación lleva el ${Math.round(pct)} % de su contexto; Claude rinde peor cuanto más llena está. Cierra el bloque en el que estás en un punto que compile, guarda el relevo con la plantilla (pmc guarda) y no empieces nada grande en esta misma conversación sin haberlo guardado.`
  return { level, text }
}

const warnedFile = () => join(paths.usageDir(), 'context-warned.json')

/** Reads the session's context from its live file and returns the warning once per level (remembered on disk). */
export function takeContextWarning(sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined
  const id = sessionId.replace(/[^\w-]/g, '')
  let pct: number | undefined
  try { pct = JSON.parse(readFileSync(join(paths.liveSessionsDir(), `${id}.json`), 'utf8')).contextPct ?? undefined } catch { return undefined }
  let all: Record<string, number[]> = {}
  try { if (existsSync(warnedFile())) all = JSON.parse(readFileSync(warnedFile(), 'utf8')) } catch { /* start again */ }
  const w = contextWarning(pct, all[id] ?? [])
  if (!w) return undefined
  all[id] = [...(all[id] ?? []), w.level]
  // Keep the file small: the last 200 sessions.
  const keys = Object.keys(all)
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete all[k]
  try { writeFileSync(warnedFile(), JSON.stringify(all)) } catch { /* said again next time */ }
  return w.text
}
