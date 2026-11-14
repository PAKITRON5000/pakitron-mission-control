// Routines (EV44): what the app runs by itself for a project, with the project's own checks (pmc.json), so no Claude
// spends usage on it. The user, 12-11: «ayudar a crear cualquier tipo de proyectos con automatizaciones que la app
// entienda cómo necesita cada proyecto». Two to start with, both only ever read and record (nothing is changed or deleted):
// - after each commit, the light checks (no shared resource), once the copy is clean or nobody is working on the project,
//   so a half-made edit does not raise a false alarm;
// - every night, all the checks, the heavy ones included, when nobody is working there (runVerification itself puts a
//   heavy one off while the user plays or edits video, and takes the resource's turn).
// The result goes to the project's verifications (Inicio › «Tus proyectos») and the timeline; only a failure notifies.
// No node imports: the screens show the defaults.

export interface RoutineSettings { trasCommit?: boolean; noche?: boolean; hora?: string }
export type RoutineKind = 'tras-commit' | 'noche'

export interface RoutineProject {
  id: string
  copies: { path: string; head?: string; dirty: number }[]
  /** Checks with no resource: the after-commit routine runs these. */
  light: number
  /** All declared checks. */
  all: number
  /** Some declared check needs a shared resource or is heavy. */
  heavy: boolean
  working: boolean
}

export interface RoutineMemory { heads: Record<string, string>; nights: Record<string, string>; nightTry: Record<string, number> }

export interface DueRoutine { projectId: string; copy: string; kind: RoutineKind; head?: string; /** The night it is for (nightWindow › key). */ night?: string }

export const DEFAULT_HOUR = '03:30'
const NIGHT_END_HOUR = 8
const NIGHT_RETRY_MS = 30 * 60_000

/** What applies when the user has not chosen: after each commit if there is a light check; at night only when nothing is heavy. */
export function routineDefaults(p: { light: number; all: number; heavy: boolean }): Required<RoutineSettings> {
  return { trasCommit: p.light > 0, noche: p.all > 0 && !p.heavy, hora: DEFAULT_HOUR }
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/**
 * The night a routine may run in: from its hour until 08:00. An evening hour (22:00, the user's choice for the game project,
 * 12-11) crosses midnight: at 01:00 it is still the night that began the day before. Named by the day it began, so a run
 * after midnight does not count for the next evening.
 */
export function nightWindow(hora: string, now: number): { inside: boolean; key: string } {
  const [hh, mm] = hora.split(':').map(Number)
  const d = new Date(now)
  const start = new Date(d); start.setHours(hh || 0, mm || 0, 0, 0)
  if ((hh || 0) >= 12 && now < start.getTime() && d.getHours() < NIGHT_END_HOUR) start.setDate(start.getDate() - 1)
  const end = new Date(start)
  if ((hh || 0) >= 12) end.setDate(end.getDate() + 1)
  end.setHours(Math.max(NIGHT_END_HOUR, (hh || 0) < 12 ? (hh || 0) + 2 : NIGHT_END_HOUR), 0, 0, 0)
  return { inside: now >= start.getTime() && now < end.getTime(), key: dayKey(start) }
}

/**
 * What is due now. One routine at a time for the whole machine: the first due one. A commit seen for the first time is
 * only remembered (starting the app is not a commit). `memory` is updated by the caller once the routine has run.
 */
export function dueRoutines(projects: RoutineProject[], settings: Record<string, RoutineSettings | undefined>, memory: RoutineMemory, now: number): DueRoutine[] {
  const out: DueRoutine[] = []
  const d = new Date(now)
  for (const p of projects) {
    const s = { ...routineDefaults(p), ...(settings[p.id] ?? {}) }
    if (s.trasCommit && p.light > 0) {
      for (const c of p.copies) {
        if (!c.head) continue
        const seen = memory.heads[c.path]
        if (seen === undefined) { memory.heads[c.path] = c.head; continue }
        if (seen !== c.head && (c.dirty === 0 || !p.working)) out.push({ projectId: p.id, copy: c.path, kind: 'tras-commit', head: c.head })
      }
    }
    if (s.noche && p.all > 0 && !p.working) {
      const w = nightWindow(s.hora || DEFAULT_HOUR, now)
      const done = memory.nights[p.id] === w.key
      const recent = now - (memory.nightTry[p.id] ?? 0) < NIGHT_RETRY_MS
      const copy = p.copies[0]?.path
      if (w.inside && !done && !recent && copy) out.push({ projectId: p.id, copy, kind: 'noche', night: w.key })
    }
  }
  return out
}

/** After a routine ran: what to remember so it does not run again for the same commit or night. */
export function remember(memory: RoutineMemory, r: DueRoutine, outcome: 'bien' | 'falla' | 'aplazada' | 'nada', now: number): void {
  if (r.kind === 'tras-commit' && r.head) memory.heads[r.copy] = r.head
  if (r.kind === 'noche') {
    memory.nightTry[r.projectId] = now
    // Put off (the user was playing, a resource was taken): tried again in half an hour, until the night is over.
    if (outcome !== 'aplazada') memory.nights[r.projectId] = r.night ?? dayKey(new Date(now))
  }
}
