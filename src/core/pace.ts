// How fast an account is spending and when to tell it to close its block. A session that hits the limit in the middle
// of an edit leaves the next account half a change and no hand-off note; one that was told at 85 % leaves a commit and a
// «Último latido». The figures are the status line's (confirmed); the time left is an estimate and is called that.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountId, UsageSnapshot } from './types'
import { paths } from './paths'
import { readUsageHistory, readUsageSnapshot, type UsageReading } from './accounts'

export const WARN_AT = [85, 95] as const
const STALE_MS = 15 * 60_000

/** Minutes until the 5-hour window fills at the pace of its last readings; undefined when there is nothing to go by. */
export function minutesLeft(history: UsageReading[], snap: UsageSnapshot, now = Date.now()): number | undefined {
  const w = snap.fiveHour
  if (!w || w.usedPct >= 100) return undefined
  const mine = history.filter((h) => h.fiveResets === w.resetsAt && typeof h.five === 'number' && now - h.at < 90 * 60_000).sort((a, b) => a.at - b.at)
  if (mine.length < 2) return undefined
  const first = mine[0], last = mine[mine.length - 1]
  const dt = (last.at - first.at) / 60_000
  const dp = last.five! - first.five!
  if (dt < 5 || dp <= 0) return undefined
  return Math.max(1, Math.round((100 - last.five!) / (dp / dt)))
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const warnedFile = (account: string) => join(paths.usageDir(), `${account}.warned.json`)

export interface PaceInput { snapshot?: UsageSnapshot; history: UsageReading[]; warned: Record<string, number>; autoRelay?: boolean; now?: number }

/**
 * The warning due now, if any: once per window and threshold. Returns the text and the key to remember.
 * Nothing is said from an old reading: it would be about another moment.
 */
export function paceWarning(i: PaceInput): { text: string; key: string } | undefined {
  const now = i.now ?? Date.now()
  const s = i.snapshot
  if (!s || now - s.capturedAt > STALE_MS) return undefined
  const windows = [
    { name: 'tus 5 horas', short: '5h', w: s.fiveHour },
    { name: 'tu semana', short: 'sem', w: s.sevenDay }
  ].filter((x) => x.w && x.w.resetsAt > now && x.w.usedPct < 100) as { name: string; short: string; w: { usedPct: number; resetsAt: number } }[]
  // The window nearest its end decides.
  const hit = windows.sort((a, b) => b.w.usedPct - a.w.usedPct)[0]
  if (!hit) return undefined
  const level = [...WARN_AT].reverse().find((t) => hit.w.usedPct >= t)
  if (!level) return undefined
  const key = `${hit.short}:${hit.w.resetsAt}:${level}`
  if (i.warned[key]) return undefined
  const left = hit.short === '5h' ? minutesLeft(i.history, s, now) : undefined
  const after = i.autoRelay ? 'Si te paras, Mission Control abrirá otra cuenta para seguir: lo que no esté guardado y apuntado, lo tendrá que adivinar.' : 'Si te paras, otra cuenta seguirá cuando el usuario la abra: lo que no esté guardado y apuntado, lo tendrá que adivinar.'
  // With the automatic hand-off on, stopping early wastes what is left and the hand-off waits for a limit error that never
  // comes (claude3 stopped by itself at 99 %, 12-11; the user: «que no se paren al 99 %»). So: save, write the note, go on.
  const text = level >= 95 && i.autoRelay
    ? `Mission Control: llevas el ${Math.round(hit.w.usedPct)} % de ${hit.name} (vuelve a las ${hhmm(hit.w.resetsAt)}). NO TE PARES NI TE DESPIDAS: el relevo automático está activo y otra cuenta seguirá sola cuando el límite te corte. Ahora mismo: deja lo que tienes en un estado que compile y ejecuta pmc guarda "qué has hecho y qué queda" --probado "qué y cómo" --siguiente "el paso concreto" --no-rehacer "lo que ya está" (escribe el latido, hace el commit de lo tuyo y guarda tus reservas para quien te releve). Después SIGUE TRABAJANDO hasta que el límite te corte, en pasos pequeños, con un pmc guarda al cerrar cada uno. No escribas un resumen final para el usuario ni termines el turno por tu cuenta: gastar hasta el último punto es lo que él quiere.`
    : level >= 95
    ? `Mission Control: llevas el ${Math.round(hit.w.usedPct)} % de ${hit.name} (vuelve a las ${hhmm(hit.w.resetsAt)}). No empieces nada nuevo: deja lo que tienes en un estado que compile y ejecuta YA pmc guarda "qué has hecho y qué queda" --probado "qué y cómo" --siguiente "el paso concreto" --no-rehacer "lo que ya está" (latido, commit de lo tuyo y reservas guardadas). ${after}`
    : `Mission Control: llevas el ${Math.round(hit.w.usedPct)} % de ${hit.name} (vuelve a las ${hhmm(hit.w.resetsAt)}${left ? `; a este ritmo te quedan unos ${left} min, es una estimación` : ''}). Cierra el bloque en el que estás en un punto que compile y ejecuta pmc guarda "qué has hecho y qué queda" --probado "qué y cómo" --siguiente "el paso concreto" --no-rehacer "lo que ya está" ahora, no al final; después sigue, pero con pasos pequeños que puedas cerrar.${i.autoRelay ? ' No te pares por tu cuenta aunque te quede poco: trabaja hasta que el límite te corte.' : ''} ${after}`
  return { text, key }
}

/** For the hook: reads what is on disk, and remembers what it said so it is said once. */
export function takePaceWarning(account: AccountId, autoRelay: boolean, now = Date.now()): string | undefined {
  let warned: Record<string, number> = {}
  const f = warnedFile(account)
  try { if (existsSync(f)) warned = JSON.parse(readFileSync(f, 'utf8')) } catch { /* start over */ }
  const snapshot = readUsageSnapshot(account)
  const w = paceWarning({ snapshot, history: readUsageHistory(account, now - 6 * 3600_000), warned, autoRelay, now })
  if (!w) return undefined
  // Old windows are forgotten so the file never grows.
  const fresh: Record<string, number> = { [w.key]: now }
  for (const [k, at] of Object.entries(warned)) if (now - at < 8 * 86400_000) fresh[k] = at
  try { writeFileSync(f, JSON.stringify(fresh)) } catch { return undefined }
  return w.text
}

/** Usage that must go up, with nothing to show for it, before an account counts as stuck. */
export const STALL_POINTS = 10
export const STALL_MS = 30 * 60_000

/**
 * An account spending without getting anywhere (scenario I): its 5-hour figure rose by ten points or more in half an hour
 * and in that time it wrote no file, reserved or delivered nothing. Reading and thinking are work too, so this only raises
 * a notice for the user; it stops nobody. `progressAt`: the times of its file writes, reservations and deliveries.
 */
export function isStalled(history: UsageReading[], progressAt: number[], now = Date.now()): { points: number; minutes: number } | undefined {
  const recent = history.filter((h) => typeof h.five === 'number' && now - h.at <= STALL_MS).sort((a, b) => a.at - b.at)
  if (recent.length < 2) return undefined
  const first = recent[0], last = recent[recent.length - 1]
  // A new window starts from zero: the fall is not progress undone, just another window.
  if (first.fiveResets !== last.fiveResets) return undefined
  const points = Math.round(last.five! - first.five!)
  if (points < STALL_POINTS || last.at - first.at < STALL_MS * 0.6) return undefined
  if (progressAt.some((at) => at >= first.at)) return undefined
  return { points, minutes: Math.round((last.at - first.at) / 60_000) }
}
