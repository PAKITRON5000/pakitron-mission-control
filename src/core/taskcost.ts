// What a task costs (EV43: «cuánto cuesta de media una tarea de cada proyecto y modelo, para repartir mejor y avisar de
// las que se comen la semana»). From what the app already keeps: when an account took a task («se encarga de X», the
// claim) and when X was marked done, and the account's week readings in between (`spent`). An estimate: an account
// that works on two tasks at once charges both. No node imports.
import { spent } from './metrics'
import type { UsageReading } from './accounts'

export interface TaskCost { task: string; account: string; points: number; minutes: number; model?: string; doneAt?: number }

const ID = /\b([A-Z]{1,4}\d+[a-z]?)\b/

/**
 * claims: «reserva» events (account, title naming the task); dones: «tarea-hecha» events; models: the tag of each task
 * ([sonnet], [opus], [fable]). The cost of a task is the week points its account spent from its last claim before the
 * task was marked done until then.
 */
export function taskCosts(
  claims: { at: number; account: string; title: string }[],
  dones: { at: number; title: string }[],
  history: Record<string, UsageReading[]>,
  models: Record<string, string | undefined> = {}
): TaskCost[] {
  const out: TaskCost[] = []
  // What the same account finished in between is not this task's: it counts from the later of its claim and the account's
  // previous «hecha» (13-11: EV19, claimed 27 hours, took 60 points that were the work on other tasks).
  const lastDone: Record<string, number> = {}
  for (const d of [...dones].sort((a, b) => a.at - b.at)) {
    const id = ID.exec(d.title)?.[1]
    if (!id) continue
    const c = claims.filter((x) => x.at <= d.at && ID.exec(x.title)?.[1] === id).sort((a, b) => b.at - a.at)[0]
    if (!c) continue
    const from = Math.max(c.at, lastDone[c.account] ?? 0)
    lastDone[c.account] = d.at
    out.push({ task: id, account: c.account, points: spent(history[c.account] ?? [], from, d.at), minutes: Math.round((d.at - from) / 60_000), model: models[id], doneAt: d.at })
  }
  return out
}

/**
 * The tasks still at work (claimed, not done) that have already spent more than `times` the average of their model
 * (and at least `min` points): «avisar de las que se comen la semana».
 */
export function heavyNow(
  claims: { at: number; account: string; title: string }[],
  doneIds: Set<string>,
  history: Record<string, UsageReading[]>,
  models: Record<string, string | undefined>,
  byModel: { model: string; avgPoints: number }[],
  now: number,
  times = 3,
  min = 6,
  /** When each account last finished a task: an old claim counts only from then (the same rule as taskCosts). */
  lastDone: Record<string, number> = {}
): { task: string; account: string; points: number; avg: number; model: string }[] {
  const latest = new Map<string, { at: number; account: string }>()
  for (const c of claims) { const id = ID.exec(c.title)?.[1]; if (id && !doneIds.has(id) && (latest.get(id)?.at ?? 0) < c.at) latest.set(id, { at: c.at, account: c.account }) }
  const out: { task: string; account: string; points: number; avg: number; model: string }[] = []
  for (const [task, c] of latest) {
    const model = models[task] ?? 'sin etiqueta'
    const avg = byModel.find((m) => m.model === model)?.avgPoints
    if (!avg) continue
    // Once the account took another task (a minute later or more: a takeover claims several at once), what it spends is
    // that one's. 13-11: EV20, claimed at 02:03 of the 12th and waiting on the user since, «lleva 100 puntos», which
    // were everything Claude 1 did afterwards.
    const next = claims.filter((x) => x.account === c.account && x.at > c.at + 60_000 && ID.exec(x.title)?.[1] !== task).reduce((m, x) => Math.min(m, x.at), now)
    const points = spent(history[c.account] ?? [], Math.max(c.at, lastDone[c.account] ?? 0), next)
    if (points >= min && points > avg * times) out.push({ task, account: c.account, points, avg, model })
  }
  return out.sort((a, b) => b.points - a.points)
}

/** The average per model tag (and «sin etiqueta»), the most expensive first. */
export function costByModel(costs: TaskCost[]): { model: string; tasks: number; avgPoints: number }[] {
  const by = new Map<string, number[]>()
  for (const c of costs) { const k = c.model ?? 'sin etiqueta'; by.set(k, [...(by.get(k) ?? []), c.points]) }
  return [...by].map(([model, xs]) => ({ model, tasks: xs.length, avgPoints: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 })).sort((a, b) => b.avgPoints - a.avgPoints)
}
