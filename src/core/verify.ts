import { t, locale } from './i18n'
// The verification gate (`pmc verifica [ID]`): "done" stops being the agent's word. A project declares its checks in
// pmc.json at the root of each copy (compile, tests, whatever it has); running them leaves a result tied to the task, the
// commit it ran on and a log. Three states the board can tell apart: says it is done / passes the checks / accepted by the
// user. Where there is no check, that is said too, never passed off as verified.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountId, ProjectConfig } from './types'
import type { DB } from './db'
import { isInside, paths } from './paths'
import { detectBusy, freeResource, holdResource, type Busy } from './resources'

export interface Check {
  nombre: string
  /** Run with the system shell from the root of the copy. */
  orden: string
  /** A shared resource it needs (unity, gpu, build): its turn is taken while it runs. */
  recurso?: string
  /** Heavy: not started while the user plays or edits video. Taken for granted when it needs a resource. */
  pesada?: boolean
  minutos?: number
  /** Regex on the output that means it failed, whatever the exit code (tools that always exit 0). */
  fallaSi?: string
  /** Regex the output must contain to pass. */
  pasaSi?: string
  /** Regex whose match is kept as the one-line summary ("Tests: total=343 passed=340 failed=0"). */
  resumen?: string
}

export type Outcome = 'bien' | 'falla' | 'aplazada'

export interface CheckResult { nombre: string; outcome: Outcome; summary: string; log?: string; seconds: number }

export interface Verification {
  id: number
  projectId: string
  taskKey?: string
  account?: AccountId
  at: number
  outcome: Outcome
  summary: string
  commit?: string
  dirty?: number
  checks: CheckResult[]
}

/** The checks of the copy this folder belongs to. Undefined: the project has declared none. */
export function readChecks(copyRoot: string): Check[] | undefined {
  const f = join(copyRoot, 'pmc.json')
  if (!existsSync(f)) return undefined
  const j = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''))
  const list = Array.isArray(j?.verifica) ? j.verifica : undefined
  if (!list) return undefined
  return list.filter((c: any) => typeof c?.nombre === 'string' && typeof c?.orden === 'string')
}

export function copyRootFor(project: ProjectConfig, cwd: string): string {
  const hit = [...project.copies.map((x) => x.path), project.root].filter((p) => isInside(cwd, p)).sort((a, b) => b.length - a.length)[0]
  return hit ?? project.root
}

export type Runner = (orden: string, cwd: string, timeoutMs: number) => { code: number | null; output: string; timedOut: boolean }

const shellRun: Runner = (orden, cwd, timeoutMs) => {
  const r = spawnSync(orden, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 << 20 })
  return { code: r.status, output: `${r.stdout ?? ''}${r.stderr ? '\n' + r.stderr : ''}`, timedOut: (r.error as any)?.code === 'ETIMEDOUT' }
}

/** Decides one check from what it printed and how it ended. */
export function judge(c: Check, r: { code: number | null; output: string; timedOut: boolean }): { outcome: Outcome; summary: string } {
  // Colour codes split the words a pattern looks for («Tests  200 passed» came as «Tests ESC[22m ESC[1m200 passed», 12-11).
  const text = r.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  const line = (re: string | undefined) => { try { return re ? text.match(new RegExp(re, 'm'))?.[0]?.replace(/\s+/g, ' ').trim().slice(0, 200) : undefined } catch { return undefined } }
  if (r.timedOut) return { outcome: 'falla', summary: t('cortada a los {n} min sin terminar', { n: c.minutos ?? 30 }) }
  const bad = line(c.fallaSi)
  if (bad) return { outcome: 'falla', summary: bad }
  if (c.pasaSi && !line(c.pasaSi)) return { outcome: 'falla', summary: line(c.resumen) ?? t('no apareció lo que debía ({pattern})', { pattern: c.pasaSi }) }
  if (!c.pasaSi && !c.fallaSi && r.code !== 0) return { outcome: 'falla', summary: t('terminó con código {code}', { code: r.code ?? undefined }) }
  if (r.code !== 0 && r.code !== null && !c.pasaSi) return { outcome: 'falla', summary: t('terminó con código {code}', { code: r.code ?? undefined }) }
  return { outcome: 'bien', summary: line(c.resumen) ?? t('bien') }
}

export interface VerifyOptions { now?: number; run?: Runner; busy?: () => Busy; only?: string; git?: (cwd: string) => { commit?: string; dirty?: number } }

const gitState = (cwd: string): { commit?: string; dirty?: number } => {
  try {
    const g = (args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] })
    return { commit: g(['rev-parse', '--short', 'HEAD']).trim(), dirty: g(['status', '--porcelain']).split(/\r?\n/).filter(Boolean).length }
  } catch { return {} }
}

/**
 * Runs the checks in order and stops at the first that fails (tests on code that does not compile say nothing). A heavy
 * check is put off, not failed, while the user needs the machine or another account holds its resource.
 */
export function runVerification(db: DB, project: ProjectConfig, copyRoot: string, account: AccountId, taskKey: string | undefined, checks: Check[], opts: VerifyOptions = {}): Verification {
  const now = opts.now ?? Date.now()
  const run = opts.run ?? shellRun
  const results: CheckResult[] = []
  const logDir = join(paths.root(), 'verifica', project.id)
  mkdirSync(logDir, { recursive: true })
  for (const c of checks.filter((x) => !opts.only || x.nombre === opts.only)) {
    const heavy = c.pesada ?? Boolean(c.recurso)
    if (heavy) {
      const b = (opts.busy ?? detectBusy)()
      const why = b.playing ? t('el usuario está jugando ({game})', { game: b.playing }) : b.userApps.length ? t('el usuario tiene abierto {apps}', { apps: b.userApps.join(t(' y ')) }) : undefined
      if (why) { results.push({ nombre: c.nombre, outcome: 'aplazada', summary: t('no se lanza: {why}', { why }), seconds: 0 }); break }
    }
    if (c.recurso) {
      const h = holdResource(db, c.recurso, account, t('verificación: {name}', { name: c.nombre }), now)
      if (!h.ok) { results.push({ nombre: c.nombre, outcome: 'aplazada', summary: t('{resource} lo tiene {holder}{note}', { resource: c.recurso, holder: h.holder.account, note: h.holder.note ? ` (${h.holder.note})` : '' }), seconds: 0 }); break }
    }
    const t0 = Date.now()
    let r: ReturnType<Runner>
    // MC-273 (claude1, 15-11 03:55: the night's routine ended its tests at 03:45 and Unity stayed «its» until 04:59): the
    // resource is let go whatever happens to the check.
    try { r = run(c.orden, copyRoot, (c.minutos ?? 30) * 60_000) } catch (e) { r = { code: -1, output: String((e as Error).message), timedOut: false } } finally { if (c.recurso) freeResource(db, c.recurso, account, Date.now()) }
    const log = join(logDir, `${now}-${c.nombre.replace(/[^\w.-]+/g, '_')}.log`)
    try { writeFileSync(log, `$ ${c.orden}\n(en ${copyRoot})\n\n${r.output}`) } catch { /* the result still counts */ }
    const j = judge(c, r)
    results.push({ nombre: c.nombre, ...j, log, seconds: Math.round((Date.now() - t0) / 1000) })
    if (j.outcome !== 'bien') break
  }
  const failed = results.find((x) => x.outcome === 'falla')
  const put = results.find((x) => x.outcome === 'aplazada')
  const outcome: Outcome = failed ? 'falla' : put ? 'aplazada' : 'bien'
  const summary = failed ? `${failed.nombre}: ${failed.summary}` : put ? `${put.nombre}: ${put.summary}` : results.map((x) => `${x.nombre}: ${x.summary}`).join(' · ')
  const g = (opts.git ?? gitState)(copyRoot)
  const row = db.prepare('INSERT INTO verifications(project_id, task_key, account, at, outcome, summary, commit_id, dirty, checks) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(project.id, taskKey ?? null, account, now, outcome, summary, g.commit ?? null, g.dirty ?? null, JSON.stringify(results))
  try { writeVerified(db, project) } catch { /* the gate in the hook just knows less */ }
  return { id: Number(row.lastInsertRowid), projectId: project.id, taskKey, account, at: now, outcome, summary, commit: g.commit, dirty: g.dirty, checks: results }
}

function fromRow(r: any): Verification {
  let checks: CheckResult[] = []
  try { checks = JSON.parse(r.checks) } catch { /* none */ }
  return { id: r.id, projectId: r.project_id, taskKey: r.task_key ?? undefined, account: r.account ?? undefined, at: r.at, outcome: r.outcome, summary: r.summary, commit: r.commit_id ?? undefined, dirty: r.dirty ?? undefined, checks }
}

/** The last run that counts for a task: its own, or a later one of the whole project (it ran on code that had the task in). */
export function lastVerification(db: DB, projectId: string, taskKey?: string): Verification | undefined {
  const r = taskKey
    ? db.prepare("SELECT * FROM verifications WHERE project_id = ? AND task_key = ? AND outcome != 'aplazada' ORDER BY at DESC, id DESC LIMIT 1").get(projectId, taskKey)
    : db.prepare("SELECT * FROM verifications WHERE project_id = ? AND outcome != 'aplazada' ORDER BY at DESC, id DESC LIMIT 1").get(projectId)
  return r ? fromRow(r) : undefined
}

/** How many times in a row the checks have failed for a task: what decides who tries next. */
export function failStreak(db: DB, projectId: string, taskKey: string): number {
  const rows = db.prepare("SELECT outcome FROM verifications WHERE project_id = ? AND task_key = ? AND outcome != 'aplazada' ORDER BY at DESC, id DESC LIMIT 10").all(projectId, taskKey) as { outcome: string }[]
  let n = 0
  for (const r of rows) { if (r.outcome !== 'falla') break; n++ }
  return n
}

const hhmm = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

export function verificationLine(v: Verification | undefined): string {
  if (!v) return t('Sin verificar: nadie ha pasado las comprobaciones con esta tarea.')
  const where = v.commit ? t(' sobre {commit}', { commit: v.commit }) + (v.dirty ? t(' más {n} archivos sin guardar', { n: v.dirty }) : '') : ''
  return v.outcome === 'bien' ? t('Verificada ({when}{where}): {summary}', { when: hhmm(v.at), where, summary: v.summary }) : t('LAS COMPROBACIONES FALLAN ({v0}{where}): {summary}', { v0: hhmm(v.at), where: where, summary: v.summary })
}

/** What the agent reads after a run: the result, and what to do with a failure so it does not loop. */
export function verificationReport(v: Verification, streak: number): string {
  const out: string[] = []
  for (const c of v.checks) out.push(`${c.outcome === 'bien' ? t('BIEN') : c.outcome === 'falla' ? t('FALLA') : t('APLAZADA')}  ${c.nombre}${c.seconds ? ` (${c.seconds} s)` : ''}: ${c.summary}${c.outcome === 'falla' && c.log ? '\n       ' + t('registro: {log}', { log: c.log }) : ''}`)
  if (v.outcome === 'bien') out.push(t('Todo pasa. Ya puedes entregarla (pmc entrega) y liberarla.'))
  else if (v.outcome === 'aplazada') out.push(t('No es un fallo: no se ha podido lanzar ahora. Sigue con algo que no lo necesite, apunta en el relevo que queda por verificar y vuelve a intentarlo después.'))
  else if (streak <= 1) out.push(t('No la entregues como hecha. Lee el registro, corrige la causa y vuelve a pasar pmc verifica.'))
  else if (streak === 2) out.push(t('Segunda vez seguida que falla. Un intento más como mucho, y solo si sabes la causa: si no, deja en el relevo qué has probado y qué dice el registro, suelta la tarea (pmc release) para que la coja otra cuenta, y sigue con otra.'))
  else out.push(t('Van {streak} fallos seguidos: para. Deja en el relevo lo probado y el registro, suelta la tarea y pregunta al usuario con pmc decide cómo seguir. No sigas gastando en lo mismo.', { streak }))
  return out.join('\n')
}

// ---- the gate in the hook (EV139) -------------------------------------------------------------------------------------
// A task with broken checks cannot be marked done in TASKS.md: the PreToolUse hook (core/live.ts › guardUnverified) reads
// the last result of each task from a small file, never the database, so it answers in a millisecond.

export interface VerifiedFile { projects: Record<string, { roots: string[]; tasks: Record<string, { outcome: Outcome; at: number; summary: string }> }> }

export const verifiedFile = () => join(paths.root(), 'verified.json')

export function readVerified(file = verifiedFile()): VerifiedFile {
  try { return JSON.parse(readFileSync(file, 'utf8')) as VerifiedFile } catch { return { projects: {} } }
}

/** The project's part of verified.json rebuilt from the database: the last result of each task and of the whole project («*»). */
export function writeVerified(db: DB, project: ProjectConfig, file = verifiedFile()): void {
  const rows = db.prepare('SELECT task_key, outcome, at, summary FROM verifications WHERE project_id = ? ORDER BY at, id').all(project.id) as { task_key: string | null; outcome: Outcome; at: number; summary: string }[]
  const tasks: VerifiedFile['projects'][string]['tasks'] = {}
  for (const r of rows) tasks[r.task_key ?? '*'] = { outcome: r.outcome, at: r.at, summary: String(r.summary ?? '').slice(0, 200) }
  const all = readVerified(file)
  all.projects[project.id] = { roots: [project.root, ...project.copies.map((c) => c.path)], tasks }
  writeFileSync(file, JSON.stringify(all))
}

const LINE = /^\s*- \[([ x~])\] ([A-Z]{1,4}\d{1,4})\b(.*)$/gm

/** The tasks a TASKS.md edit takes from «[ ]» or «[~]» to «[x]»; one whose line says «sin comprobación» is left out. */
export function newlyDone(before: string, after: string): string[] {
  const was = new Map<string, string>()
  for (const m of before.matchAll(LINE)) was.set(m[2], m[1])
  const out: string[] = []
  for (const m of after.matchAll(LINE)) {
    if (m[1] !== 'x' || /sin comprobaci[oó]n|no checks?:/i.test(m[3])) continue
    const old = was.get(m[2])
    if (old === ' ' || old === '~') out.push(m[2])
  }
  return out
}

const inside = (file: string, root: string) => {
  const n = (s: string) => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return n(file).startsWith(n(root) + '\\')
}

/**
 * EV139: the PreToolUse gate. Marking a task done in TASKS.md needs its last `pmc verifica` to pass (or to have been put
 * off, when the user plays or the checks need what is busy). A project that never ran pmc verifica is not held to it.
 */
export function guardUnverified(data: any, v = readVerified(), read = (f: string) => readFileSync(f, 'utf8'), now = Date.now()): string | undefined {
  const tool = String(data?.tool_name ?? '')
  const input = data?.tool_input ?? {}
  const target = String(input.file_path ?? '')
  if (!/^(Write|Edit|MultiEdit)$/.test(tool) || !/(^|[\\/])TASKS\.md$/i.test(target)) return undefined
  const project = Object.values(v.projects ?? {}).find((p) => p.roots.some((r) => inside(target, r)))
  if (!project) return undefined
  const pairs: { before: string; after: string }[] = tool === 'Write'
    ? [{ before: (() => { try { return read(target) } catch { return '' } })(), after: String(input.content ?? '') }]
    : tool === 'Edit' ? [{ before: String(input.old_string ?? ''), after: String(input.new_string ?? '') }]
    : ((input.edits ?? []) as any[]).map((e) => ({ before: String(e?.old_string ?? ''), after: String(e?.new_string ?? '') }))
  const ids = [...new Set(pairs.flatMap((p) => newlyDone(p.before, p.after)))]
  for (const id of ids) {
    const r = project.tasks[id]
    // A run of the whole project in the last two hours also counts: it ran on the code that has the task in.
    const all = project.tasks['*']
    if (r?.outcome === 'bien' || r?.outcome === 'aplazada' || (!r && all?.outcome === 'bien' && now - all.at < 2 * 3600_000)) continue
    if (r?.outcome === 'falla') return t('Mission Control: {id} no pasa sus comprobaciones ({summary}). Arréglalo y vuelve a pasar pmc verifica {v0} antes de marcarla hecha.', { id: id, summary: r.summary, v0: id })
    return t('Mission Control: antes de marcar {id} como hecha, pasa pmc verifica {v0} (las comprobaciones del proyecto). Si de verdad no hay nada que comprobar, escribe en su línea «sin comprobación: por qué» y márcala.', { id: id, v0: id })
  }
  return undefined
}
