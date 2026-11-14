// Long jobs a Claude leaves running on the PC (generating a video, recording films): a small file per job, so the user
// always knows whether it is going, how much is left, and above all if it was cut short (the PC was turned off, say) and
// nothing will come out. The state is read from the job's log and its output file; nothing is estimated beyond that.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

export interface Job {
  id: string
  title: string
  projectId?: string
  account?: string
  pid?: number
  log?: string
  output?: string
  startedAt: number
}

export type JobState = 'en-marcha' | 'terminado' | 'cortado'

export interface JobView extends Job {
  state: JobState
  done?: number
  total?: number
  /** Time left according to the job itself, in seconds. */
  leftSec?: number
  lastAt?: number
}

const dir = () => join(paths.root(), 'jobs')

export function addJob(j: Omit<Job, 'id' | 'startedAt'> & { startedAt?: number }, now = Date.now()): Job {
  mkdirSync(dir(), { recursive: true })
  const job: Job = { ...j, id: now.toString(36), startedAt: j.startedAt ?? now }
  writeFileSync(join(dir(), `${job.id}.json`), JSON.stringify(job))
  return job
}

export function removeJob(id: string): void {
  if (!/^\w+$/.test(id)) return
  try { unlinkSync(join(dir(), `${id}.json`)) } catch { /* already gone */ }
}

function tail(file: string, bytes = 4096): string {
  const size = statSync(file).size
  const n = Math.min(bytes, size)
  const buf = Buffer.alloc(n)
  const fd = openSync(file, 'r')
  try { readSync(fd, buf, 0, n, size - n) } finally { closeSync(fd) }
  return buf.toString('utf8')
}

const seconds = (s?: string) => (s ? s.split(':').reduce((t, x) => t * 60 + Number(x), 0) : undefined)

/** The last progress bar in a log: « 32%|███ | 13/40 [1:00:44<2:20:52, 313.06s/it]». */
export function parseProgress(text: string): { done?: number; total?: number; leftSec?: number } {
  let last: RegExpMatchArray | undefined
  for (const m of text.matchAll(/(\d+)\/(\d+)\s*\[([\d:?]+)<([\d:?]+)/g)) if (Number(m[2]) > 5) last = m
  if (!last) return {}
  const left = last[4].includes('?') ? undefined : seconds(last[4])
  return { done: Number(last[1]), total: Number(last[2]), leftSec: left }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

export function jobView(j: Job, now = Date.now()): JobView {
  const v: JobView = { ...j, state: 'en-marcha' }
  if (j.log && existsSync(j.log)) {
    try {
      v.lastAt = statSync(j.log).mtimeMs
      Object.assign(v, parseProgress(tail(j.log)))
    } catch { /* being written */ }
  }
  let made = false
  if (j.output && existsSync(j.output)) {
    try {
      const st = statSync(j.output)
      made = st.size > 0 && st.mtimeMs >= j.startedAt
      v.lastAt = Math.max(v.lastAt ?? 0, st.mtimeMs)
    } catch { /* being written */ }
  }
  if (made) v.state = 'terminado'
  else if (j.pid != null) v.state = alive(j.pid) ? 'en-marcha' : 'cortado'
  // Without a process to ask about: a log that has been silent for a long time. A step can take minutes, so the margin is wide.
  else if (now - (v.lastAt ?? j.startedAt) > 30 * 60_000) v.state = 'cortado'
  return v
}

/** Newest first. Finished ones go away by themselves after three days, cut ones after two (or when the user dismisses them). */
export function listJobs(projectId?: string, now = Date.now()): JobView[] {
  let names: string[] = []
  try { names = readdirSync(dir()).filter((f) => f.endsWith('.json')) } catch { return [] }
  const out: JobView[] = []
  for (const n of names) {
    try {
      const j = JSON.parse(readFileSync(join(dir(), n), 'utf8')) as Job
      if (projectId && j.projectId && j.projectId !== projectId) continue
      const v = jobView(j, now)
      if (v.state === 'terminado' && now - (v.lastAt ?? j.startedAt) > 3 * 86400_000) { removeJob(j.id); continue }
      // A cut one is news for a day; after two it only fills «Para ti» (12-11: three from days before stayed there).
      if (v.state === 'cortado' && now - (v.lastAt ?? j.startedAt) > 2 * 86400_000) { removeJob(j.id); continue }
      out.push(v)
    } catch { /* being written */ }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
}
