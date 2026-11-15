// What changes between Windows and macOS (or Linux) for the parts shared by the app and pmc. Windows stays the way it
// always was; macOS gets its own way of doing the same thing (Terminal, ps, launchd, ~/Library).
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'

/** One word for a POSIX shell, in single quotes (a quote inside becomes '\''). */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

const USUAL_BINS = () => [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

/** The PATH with these folders first (as the login shell gave them), then what it had, then the usual ones; no repeats. */
export function mergedPath(first: string[], current: string | undefined): string {
  return [...new Set([...first, ...(current ?? '').split(':'), ...USUAL_BINS()].filter(Boolean))].join(':')
}

/**
 * macOS: an app opened from the Finder or the Dock gets only /usr/bin:/bin:/usr/sbin:/sbin, without Homebrew, nvm or
 * ~/.local/bin (where Claude Code installs itself), so it would find neither node nor git: it takes the login shell's PATH,
 * with the usual folders after it. Until 0.34.17 that held the app's start (the user, 15-11: «en mac… cuesta
 * abrirse»): `zsh -ilc` runs the whole .zshrc (nvm, Oh My Zsh…), one to four seconds before anything else. The PATH it
 * gave last time (kept in `cacheFile`) is used at once and read again in the background; only the very first start, with nothing
 * kept, has to wait for it (the promise says when; it never rejects).
 */
export function fixPosixPathSoon(cacheFile: string): { ready: Promise<void>; cached: boolean } {
  if (isWin) return { ready: Promise.resolve(), cached: true }
  let kept: string[] = []
  try { kept = readFileSync(cacheFile, 'utf8').trim().split(':').filter(Boolean) } catch { /* first start */ }
  process.env.PATH = mergedPath(kept, process.env.PATH)
  const ready = new Promise<void>((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const child = execFile(shell, ['-ilc', 'printf "__PMC_PATH__%s__" "$PATH"'], { encoding: 'utf8', timeout: 4000 }, (_err, out) => {
      const m = /__PMC_PATH__(.*?)__/.exec(String(out ?? ''))
      if (m) {
        const got = m[1].split(':').filter(Boolean)
        process.env.PATH = mergedPath(got, process.env.PATH)
        try { writeFileSync(cacheFile, got.join(':')) } catch { /* next start reads the shell again */ }
      }
      resolve()
    })
    // Nothing to read: a .zshrc that asks something (Oh My Zsh's «update? [Y/n]») gets its answer at once instead of waiting.
    child.stdin?.end()
  })
  return { ready, cached: kept.length > 0 }
}

/** The program that lists what is running, as `tasklist` on Windows and `ps` (names only) elsewhere. */
export const PROCESS_LIST: [string, string[]] = isWin ? ['tasklist', ['/FO', 'CSV', '/NH']] : ['ps', ['-A', '-c', '-o', 'comm=']]

// macOS names of the programs the app looks for, with the Windows name the rest of the app knows them by.
const MAC_NAMES: [RegExp, string][] = [
  [/^adobe premiere pro/, 'adobe premiere pro.exe'], [/after effects/, 'afterfx.exe'], [/^(davinci )?resolve$/, 'resolve.exe'],
  [/^unity$/, 'unity.exe'], [/^blender$/, 'blender.exe'], [/^claude$/, 'claude.exe']
]

/** `ps -A -c -o comm=` written as `tasklist /FO CSV /NH` would write it (names lowercased, with .exe), for the same readers. */
export function tasklistFromPs(out: string): string {
  return out.split(/\r?\n/).map((l) => l.trim().split('/').pop() ?? '').filter(Boolean).map((n) => {
    const low = n.toLowerCase()
    const hit = MAC_NAMES.find(([re]) => re.test(low))
    return `"${hit ? hit[1] : low.endsWith('.exe') ? low : `${low}.exe`}"`
  }).join('\n')
}

/** What PROCESS_LIST printed, as tasklist's CSV everywhere. */
export const asTasklist = (out: string): string => (isWin ? out : tasklistFromPs(out))
