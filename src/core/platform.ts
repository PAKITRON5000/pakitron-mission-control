// What changes between Windows and macOS (or Linux) for the parts shared by the app and pmc. Windows stays the way it
// always was; macOS gets its own way of doing the same thing (Terminal, ps, launchd, ~/Library).
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'

/** One word for a POSIX shell, in single quotes (a quote inside becomes '\''). */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * macOS: an app opened from the Finder or the Dock gets only /usr/bin:/bin:/usr/sbin:/sbin, without Homebrew, nvm or
 * ~/.local/bin (where Claude Code installs itself), so it would find neither node nor git. The login shell's PATH is
 * read once at start (4 s at most) and the usual folders are added after it.
 */
export function fixPosixPath(): void {
  if (isWin) return
  const parts = (process.env.PATH ?? '').split(':').filter(Boolean)
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-ilc', 'printf "__PMC_PATH__%s__" "$PATH"'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })
    const m = /__PMC_PATH__(.*?)__/.exec(out)
    if (m) parts.unshift(...m[1].split(':').filter(Boolean))
  } catch { /* the usual folders below */ }
  parts.push(join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin')
  process.env.PATH = [...new Set(parts)].join(':')
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
