// EV181 (claude3, 14-11 22:07, in the game project: «EL COMMIT NO SE HIZO: spawnSync git ENAMETOOLONG»): `pmc guarda`
// added the files of the checkpoint as arguments of `git add`, and on Windows a command line has a limit (about 32 000
// characters): a few hundred long paths of a Unity project were enough. The paths go through git's input instead.
// 15-11 (claude5, Video Dos: «EL COMMIT NO SE HIZO: warning: … LF will be replaced by CRLF»): one path of the list that
// .gitignore covers, or that no longer exists and git never had, makes the whole `git add` fail (exit 1 / 128), and
// the CRLF warnings printed first hid the reason. Those paths are left out before adding.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const BIG = 64 * 1024 * 1024
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')

/** The paths `git add` can take: tracked by git (also deleted ones), or on disk and not ignored. */
export function addablePaths(root: string, paths: string[]): string[] {
  const tracked = new Set<string>()
  for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: BIG }).split('\0')) {
    if (!f) continue
    tracked.add(f)
    // its folders too: a folder git has files in is a path git add takes even when it is gone from disk
    for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) tracked.add(f.slice(0, i))
  }
  const isTracked = (p: string) => tracked.has(norm(p).replace(/\/$/, ''))
  const candidates = paths.filter((p) => isTracked(p) || existsSync(join(root, p)))
  const untracked = candidates.filter((p) => !isTracked(p))
  let ignored = new Set<string>()
  if (untracked.length) {
    try {
      // Exit 1 when none is ignored (then execFileSync throws and nothing is left out).
      ignored = new Set(execFileSync('git', ['check-ignore', '--stdin', '-z'], { cwd: root, input: untracked.join('\0'), encoding: 'utf8', windowsHide: true, maxBuffer: BIG }).split('\0').filter(Boolean).map(norm))
    } catch { /* none ignored */ }
  }
  return candidates.filter((p) => !ignored.has(norm(p)))
}

/** Stages these paths (added, changed or deleted), however many and however long; ignored or vanished ones are skipped. */
export function stagePaths(root: string, paths: string[]): void {
  const keep = paths.length ? addablePaths(root, paths) : []
  if (!keep.length) return
  execFileSync('git', ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    cwd: root, input: keep.join('\0'), encoding: 'utf8', windowsHide: true, maxBuffer: BIG
  })
}

/** Commits what is staged with this message, given through git's input too (any length, any characters). */
export function commitStaged(root: string, message: string): void {
  execFileSync('git', ['commit', '-q', '-F', '-'], { cwd: root, input: message, encoding: 'utf8', windowsHide: true, maxBuffer: BIG })
}
