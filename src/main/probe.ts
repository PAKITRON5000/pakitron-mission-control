// EV120: asks Claude Code, with no window, whether an account the app believes out of usage has usage again (a manual
// recharge, a reset coupon, a window that came back early). core/probe.ts says whom and when and reads the answer; this
// runs it as a child process (never blocking the app) and, on «allowed», gives the account back to the wheel exactly as
// the «Ya está recargada» button does, with the real figures written where the status line writes them.
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { backSooner, dueProbe, hasUsage, parseProbe, probeWords, PROBE_ARGS, type ProbeCandidate, type ProbeReading } from '../core/probe'
import { paths } from '../core/paths'

export interface ProbeDeps {
  candidates: () => ProbeCandidate[]
  env: (account: string) => NodeJS.ProcessEnv
  claude: () => string
  /** The account has usage again: tell the app (recharged) and the timeline. */
  back: (account: string, reading: ProbeReading) => void
  /** Still out, but back sooner than the app believed: its limits older than `at` are dropped (the reading, taken at `at`, stays). */
  sooner: (account: string, reading: ProbeReading, at: number) => void
  log: (line: string) => void
}

export function runProbe(exe: string, env: NodeJS.ProcessEnv, cwd: string): Promise<{ out: string; reading?: ProbeReading }> {
  return new Promise((resolve) => {
    execFile(exe, PROBE_ARGS, { cwd, env, windowsHide: true, timeout: 90_000, maxBuffer: 4 << 20 }, (_e, so, se) => {
      const out = `${so ?? ''}${se ?? ''}`
      resolve({ out, reading: parseProbe(out) })
    })
  })
}

/** The reading where the status line keeps it (usage/<account>.json and its history), so every screen shows it. */
export function writeReading(account: string, r: ProbeReading, now = Date.now()): void {
  const snap: Record<string, unknown> = { account, capturedAt: now, source: 'statusline', sessionId: 'sonda', model: 'haiku' }
  if (r.five) snap.fiveHour = { usedPct: r.five.pct, resetsAt: r.five.resetsAt }
  if (r.week) snap.sevenDay = { usedPct: r.week.pct, resetsAt: r.week.resetsAt }
  const file = paths.usageFile(account as never)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(snap))
  renameSync(tmp, file)
  appendFileSync(paths.usageHistory(account as never), JSON.stringify({ at: now, five: r.five?.pct, week: r.week?.pct, fiveResets: r.five?.resetsAt, weekResets: r.week?.resetsAt }) + '\n')
}

export function createProbe(deps: ProbeDeps) {
  const file = () => join(paths.root(), 'probe.json')
  let asked: Record<string, number> | undefined
  let running = false
  const load = () => {
    if (asked) return asked
    try { asked = JSON.parse(readFileSync(file(), 'utf8')) } catch { asked = {} }
    return asked!
  }
  /** Asks one account and acts on the answer: back with usage, or still out but back sooner than believed. */
  async function ask(id: string, how: string): Promise<ProbeReading | undefined> {
    const last = load()
    last[id] = Date.now()
    try { writeFileSync(file(), JSON.stringify(last)) } catch { /* next time */ }
    // An empty folder of its own: no project settings, no CLAUDE.md, no hooks.
    const cwd = join(paths.root(), 'sonda')
    mkdirSync(cwd, { recursive: true })
    const { out, reading } = await runProbe(deps.claude(), deps.env(id), cwd)
    if (!reading) { deps.log(`sonda de uso de ${id}${how}: sin respuesta legible (${out.replace(/\s+/g, ' ').slice(0, 200)})`); return undefined }
    deps.log(`sonda de uso de ${id}${how}: ${reading.status} (${reading.type ?? '?'}) · ${probeWords(reading)}`)
    const backAt = deps.candidates().find((c) => c.id === id)?.backAt
    const usage = hasUsage(reading)
    if (!usage && !backSooner(backAt, reading)) return reading
    const at = Date.now()
    try { writeReading(id, reading, at) } catch (e) { deps.log(`sonda: no se pudo apuntar la lectura de ${id}: ${(e as Error).message}`) }
    if (usage) deps.back(id, reading)
    else deps.sooner(id, reading, at)
    return reading
  }

  return {
    /** The user's «Ya está recargada»: asked now, whatever the last time was. */
    now: (id: string) => ask(id, ' (pedida)'),
    async tick(now = Date.now()): Promise<void> {
      if (running || process.env.PMC_SHOT_DIR) return
      const id = dueProbe(deps.candidates(), load(), now)
      if (!id) return
      running = true
      try { await ask(id, '') } finally { running = false }
    }
  }
}
