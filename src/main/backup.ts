import { t, tn } from '../core/i18n'
// Runs the backups of core/backup.ts (EV44): git and robocopy as child processes, never blocking the app (EV115). One
// project at a time; the result goes to the timeline (Rutinas y avisos) and, if it fails, a notice once a day.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  backupSettings, backupTarget, dueBackup, emptyBackupMemory, pushedRefs, rejectedBranches, rememberBackup, rewrittenRefspec,
  type BackupMemory, type BackupSettings
} from '../core/backup'
import { nightWindow } from '../core/routines'

export interface BackupDeps {
  root: () => string
  projects: () => { id: string; name: string; root: string }[]
  settings: () => BackupSettings | undefined
  /** The user plays or edits video: nothing heavy now. */
  busy: () => boolean
  event: (projectId: string, ok: boolean, title: string, detail: string) => void
  warn: (title: string, body: string) => void
  log: (line: string) => void
}

interface RunResult { code: number; out: string }

function run(cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = ''
    let child: ReturnType<typeof spawn>
    try { child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { resolve({ code: -1, out: String(e) }); return }
    const keep = (b: Buffer) => { out += String(b); if (out.length > 200_000) out = out.slice(-100_000) }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const kill = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, timeoutMs)
    child.on('error', (e) => { clearTimeout(kill); resolve({ code: -1, out: out + String(e) }) })
    child.on('close', (code) => { clearTimeout(kill); resolve({ code: code ?? -1, out }) })
  })
}

const MIN = 60_000

/** Copies one project. ok false with the reason when it could not. */
export async function backupProject(root: string, target: string, now = Date.now()): Promise<{ ok: boolean; summary: string; detail: string }> {
  const common = await run('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], MIN)
  if (common.code !== 0) return { ok: false, summary: t('no es un repositorio git'), detail: common.out }
  const gitDir = common.out.trim().split(/\r?\n/).pop()!.trim()
  const lines: string[] = []
  let first = false
  if (!existsSync(target)) {
    // First time: a bare clone copies the object files as they are (34 GB for the game project, no repacking).
    first = true
    try { mkdirSync(join(target, '..'), { recursive: true }) } catch (e) { return { ok: false, summary: t('no se puede crear la carpeta de copias ({v0})', { v0: (e as Error).message }), detail: '' } }
    const c = await run('git', ['clone', '--bare', '--no-hardlinks', root, target], 4 * 60 * MIN)
    if (c.code !== 0) return { ok: false, summary: t('falló la primera copia (git clone)'), detail: c.out }
    lines.push(c.out.trim())
  } else {
    const bare = await run('git', ['-C', target, 'rev-parse', '--is-bare-repository'], MIN)
    if (bare.code !== 0 || bare.out.trim() !== 'true') return { ok: false, summary: t('{target} existe y no es una copia de git: no se toca', { target: target }), detail: bare.out }
  }
  // Every branch and tag; only fast-forwards (nothing in the copy is overwritten); no hooks (Git LFS would try to upload).
  const push = await run('git', ['-C', root, 'push', '--porcelain', '--no-verify', target, 'refs/heads/*:refs/heads/*', 'refs/tags/*:refs/tags/*'], 60 * MIN)
  lines.push(push.out.trim())
  let changed = pushedRefs(push.out)
  const rejected = rejectedBranches(push.out)
  for (const b of rejected) {
    const k = await run('git', ['-C', root, 'push', '--porcelain', '--no-verify', target, rewrittenRefspec(b, now)], 60 * MIN)
    lines.push(k.out.trim())
    if (k.code !== 0) return { ok: false, summary: t('no se pudo guardar la rama reescrita {b}', { b: b }), detail: lines.join('\n') }
    changed++
  }
  if (push.code !== 0 && !rejected.length) return { ok: false, summary: t('falló git push'), detail: lines.join('\n') }
  // LFS files: copied as files, only the new ones (robocopy skips what is already there; never deletes).
  let lfs = ''
  const lfsDir = join(isAbsolute(gitDir) ? gitDir : join(root, gitDir), 'lfs', 'objects')
  if (existsSync(lfsDir) && process.platform !== 'win32') {
    // macOS and Linux: rsync does the same (only what is missing, never deletes); each new file is one «>f» line.
    mkdirSync(join(target, 'lfs', 'objects'), { recursive: true })
    const r = await run('rsync', ['-a', '--ignore-existing', '--itemize-changes', `${lfsDir}/`, `${join(target, 'lfs', 'objects')}/`], 4 * 60 * MIN)
    lines.push(r.out.trim().split(/\r?\n/).slice(-12).join('\n'))
    if (r.code !== 0) return { ok: false, summary: t('falló la copia de los archivos LFS (rsync)'), detail: lines.join('\n') }
    lfs = /^>f/m.test(r.out) ? t(', con los archivos LFS nuevos') : ''
  } else if (existsSync(lfsDir)) {
    const r = await run('robocopy', [lfsDir, join(target, 'lfs', 'objects'), '/E', '/R:1', '/W:1', '/MT:8', '/NFL', '/NDL', '/NJH', '/NP'], 4 * 60 * MIN)
    lines.push(r.out.trim().split(/\r?\n/).slice(-12).join('\n'))
    // robocopy: 0-7 is fine (1 = files copied), 8 or more is a failure.
    if (r.code < 0 || r.code >= 8) return { ok: false, summary: t('falló la copia de los archivos LFS (robocopy)'), detail: lines.join('\n') }
    lfs = r.code & 1 ? t(', con los archivos LFS nuevos') : ''
  }
  const what = first ? t('primera copia completa hecha') : changed ? tn(changed, '{n} rama o etiqueta puesta al día', '{n} ramas o etiquetas puestas al día', { n: changed }) : t('ya estaba al día')
  const kept = rejected.length ? '; ' + tn(rejected.length, 'una rama reescrita guardada aparte (reescritas/), sin perder la anterior', '{n} ramas reescritas guardadas aparte (reescritas/), sin perder la anterior', { n: rejected.length }) : ''
  return { ok: true, summary: `${what}${lfs}${kept}`, detail: lines.filter(Boolean).join('\n').slice(-4000) }
}

export function createBackup(deps: BackupDeps) {
  const file = () => join(deps.root(), 'backup.json')
  let mem: BackupMemory | undefined
  let running: string | undefined
  const load = (): BackupMemory => {
    if (mem) return mem
    try { mem = { ...emptyBackupMemory(), ...JSON.parse(readFileSync(file(), 'utf8')) } } catch { mem = emptyBackupMemory() }
    return mem!
  }
  const save = () => { try { writeFileSync(file(), JSON.stringify(mem)) } catch { /* next time */ } }

  async function runOne(projectId: string, night: string): Promise<void> {
    const m = load()
    const p = deps.projects().find((x) => x.id === projectId)
    if (!p) return
    const s = backupSettings(deps.settings())
    const target = backupTarget(s.dir, p.id)
    running = p.id
    m.tries[p.id] = Date.now()
    save()
    const started = Date.now()
    let r: { ok: boolean; summary: string; detail: string }
    try {
      // The other disk must be there (an unplugged drive is a failure to tell, not a folder to create on C:).
      // On a Mac the other disk is /Volumes/<name>.
      const drive = s.dir.match(/^[a-z]:/i)?.[0] ?? s.dir.match(/^\/Volumes\/[^/]+/)?.[0]
      r = drive && !existsSync(drive.startsWith('/') ? drive : drive + '\\') ? { ok: false, summary: t('no está el disco {drive}', { drive: drive }), detail: '' } : await backupProject(p.root, target)
    } catch (e) { r = { ok: false, summary: (e as Error).message, detail: '' } }
    running = undefined
    const mins = Math.round((Date.now() - started) / MIN)
    const { tell } = rememberBackup(m, p.id, night, r.ok, r.summary, Date.now())
    save()
    deps.log(`copia de seguridad de ${p.name} en ${target}: ${r.ok ? 'bien' : 'FALLA'} · ${r.summary} (${mins} min)`)
    const title = r.ok
      ? t('Copia de seguridad de {name} en {dir}: {summary}{v0}', { name: p.name, dir: s.dir, summary: r.summary, v0: mins >= 2 ? ` (${mins} min)` : '' })
      : t('Copia de seguridad de {name}: no se pudo ({summary}). Se vuelve a intentar en media hora.', { name: p.name, summary: r.summary })
    // A good copy with nothing new is not worth a line in the timeline every night.
    if (!r.ok || !r.summary.startsWith(t('ya estaba al día'))) deps.event(p.id, r.ok, title, `${target}\n${r.detail}`)
    if (!r.ok && tell) deps.warn(t('{name}: la copia de seguridad falla', { name: p.name }), r.summary)
  }

  return {
    /** «Copiar ahora» (Ajustes › Proyecto): this project's copy at once, unless one is already running. */
    now(projectId: string): boolean {
      if (running) return false
      const s = backupSettings(deps.settings())
      void runOne(projectId, nightWindow(s.hora, Date.now()).key)
      return true
    },
    /** Every minute: starts the copy that is due, if any and none is running. */
    tick(now = Date.now()): void {
      if (running || process.env.PMC_SHOT_DIR) return
      const m = load()
      const list = deps.projects().map((p) => ({ id: p.id, git: existsSync(join(p.root, '.git')) }))
      const due = dueBackup(list, deps.settings(), m, now, deps.busy())
      if (due) void runOne(due.projectId, due.night)
    },
    /** For the screens: where it copies, and the last result of this project. */
    info(projectId: string) {
      const s = backupSettings(deps.settings())
      const m = load()
      return { on: s.on && !s.off.includes(projectId), dir: s.dir, hora: s.hora, target: backupTarget(s.dir, projectId), running: running === projectId, last: m.last[projectId] }
    },
    running: () => running
  }
}
