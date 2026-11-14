// macOS (and Linux): the windows the app opens for Claude, and what it does with them afterwards. On Windows the app
// keeps its own conhost windows (index.ts, consoleTyper.ts); here each one is a Terminal window that runs a small
// script: the account's folder in CLAUDE_CONFIG_DIR, the project folder, a title, the command, then the user's shell.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../core/paths'
import { shQuote } from '../core/platform'
import { INHERITED_CLAUDE_VARS } from '../core/sessions'

export const terminalDir = (): string => join(paths.root(), 'terminal')
/** Part of the path of every script the app opens: what tells its windows from the ones the user opened by hand. */
export const OURS_MARK = 'PakitronMC/terminal/'

export interface TerminalJob {
  title: string
  cwd: string
  /** The account's folder; undefined for the default account (~/.claude). */
  configDir?: string
  /** Program and arguments, each quoted for the shell here. */
  argv: string[]
  /** Raw shell lines that go before the command (a check that may `exit 0`). */
  before?: string[]
  /** Whether the script deletes itself when it starts (every window but a scheduled one, which waits for its hour). */
  once?: boolean
}

export function terminalScript(j: TerminalJob): string {
  return [
    '#!/bin/zsh',
    ...(j.once === false ? [] : ['rm -f -- "$0" 2>/dev/null']),
    `printf '\\033]0;%s\\007' ${shQuote(j.title)}`,
    `cd ${shQuote(j.cwd)} || exit 1`,
    `unset ${INHERITED_CLAUDE_VARS.join(' ')}`,
    j.configDir ? `export CLAUDE_CONFIG_DIR=${shQuote(j.configDir)}` : 'unset CLAUDE_CONFIG_DIR',
    ...(j.before ?? []),
    j.argv.map(shQuote).join(' '),
    // Like `cmd /k` on Windows: the window stays, with the account's folder still set, until the user closes it.
    'exec "${SHELL:-/bin/zsh}" -l',
    ''
  ].join('\n')
}

/** Writes the script for a window (to `file`, or a new one in the app's folder) and returns its path. */
export function writeTerminalScript(j: TerminalJob, file?: string): string {
  const dir = terminalDir()
  mkdirSync(dir, { recursive: true })
  const f = file ?? join(dir, `${Date.now()}-${randomBytes(3).toString('hex')}.command`)
  writeFileSync(f, terminalScript(j), { mode: 0o755 })
  chmodSync(f, 0o755)
  return f
}

/** Opens a new Terminal window running that job (on Linux, the system's terminal). */
export function openTerminalWindow(j: TerminalJob): void {
  sweepOld()
  const f = writeTerminalScript(j)
  const child = process.platform === 'darwin'
    ? spawn('open', ['-a', 'Terminal', f], { detached: true, stdio: 'ignore' })
    : spawn('x-terminal-emulator', ['-e', f], { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

/** Scripts a window never ran (Terminal closed before it started) are left a day at most. */
function sweepOld(): void {
  try {
    const dir = terminalDir()
    for (const n of readdirSync(dir)) {
      const f = join(dir, n)
      try { if (Date.now() - statSync(f).mtimeMs > 86_400_000) unlinkSync(f) } catch { /* in use or gone */ }
    }
  } catch { /* no folder yet */ }
}

const ps = (args: string[]): Promise<string> => new Promise((resolve) => execFile('ps', args, { timeout: 5000 }, (_e, out) => resolve(String(out ?? '').trim())))

/**
 * Closes a Claude the app opened (its shell runs one of our scripts) or, with `byHandToo`, any Claude: the program gets
 * SIGTERM, and the shell of our script SIGHUP so its window ends too. Never a shell the user opened by hand.
 */
export async function closePosixClaude(pid: number, byHandToo = false): Promise<boolean> {
  const p = Math.floor(pid)
  if (!(p > 1)) return false
  const parent = Number(await ps(['-o', 'ppid=', '-p', String(p)]))
  const parentCmd = parent > 1 ? await ps(['-o', 'command=', '-p', String(parent)]) : ''
  const ours = parentCmd.includes(OURS_MARK)
  if (!ours && !byHandToo) return false
  try { process.kill(p, 'SIGTERM') } catch { return false }
  if (ours) { try { process.kill(parent, 'SIGHUP') } catch { /* gone with it */ } }
  return true
}

// ---- writing into a window, reading it, bringing it in front (macOS Terminal) ---------------------------------------
// The tab is found by the terminal device of the Claude process (`ps -o tty=`). Reading and bringing in front only need
// Terminal (macOS asks once whether Mission Control may control it); typing goes through System Events, which macOS
// lets an app do only once the user allows it in Privacy & Security › Accessibility.

async function ttyOf(pid: number): Promise<string> {
  const t = await ps(['-o', 'tty=', '-p', String(Math.floor(pid))])
  if (!t || t === '??') throw new Error('esa sesión no tiene ventana de Terminal')
  return t.startsWith('/dev/') ? t : `/dev/${t}`
}

const FIND_TAB = [
  'on findTab(theTty)',
  '  tell application "Terminal"',
  '    repeat with w in windows',
  '      repeat with t in tabs of w',
  '        if tty of t is theTty then return {w, t}',
  '      end repeat',
  '    end repeat',
  '  end tell',
  '  error "no hay ninguna ventana de Terminal con esa sesión"',
  'end findTab',
  'on front(theTty)',
  '  set {w, t} to findTab(theTty)',
  '  tell application "Terminal"',
  '    set selected tab of w to t',
  '    set index of w to 1',
  '    activate',
  '  end tell',
  '  delay 0.3',
  'end front'
]

function osa(lines: string[], args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile('osascript', ['-e', lines.join('\n'), ...args], { timeout: 20_000, maxBuffer: 8 << 20 }, (err, out, errOut) => {
    if (err) {
      const msg = String(errOut || err.message)
      reject(new Error(/not allowed|no permitido|1002|-1743|assistive/i.test(msg)
        ? 'macOS no deja escribir en Terminal: permite Mission Control en Ajustes del Sistema › Privacidad y seguridad › Accesibilidad (y en Automatización)'
        : msg.split('\n')[0].slice(0, 200)))
    } else resolve(String(out ?? ''))
  }))
}

/** Text then Enter, apart (together they would read as a pasted line break), as on Windows. */
export async function macTypeText(pid: number, text: string): Promise<void> {
  const tty = await ttyOf(pid)
  const flat = text.replace(/\s*\r?\n\s*/g, ' ').trim()
  await osa([...FIND_TAB, 'on run argv', '  front(item 1 of argv)', '  tell application "System Events" to keystroke (item 2 of argv)', '  delay 0.45', '  tell application "System Events" to key code 36', 'end run'], [tty, flat])
}

const KEY_CODES: Record<string, number> = { esc: 53, enter: 36, up: 126, down: 125 }

export async function macTypeKey(pid: number, key: string): Promise<void> {
  const tty = await ttyOf(pid)
  const code = KEY_CODES[key]
  const press = code !== undefined ? `tell application "System Events" to key code ${code}` : 'tell application "System Events" to keystroke (item 2 of argv)'
  await osa([...FIND_TAB, 'on run argv', '  front(item 1 of argv)', `  ${press}`, 'end run'], [tty, key])
}

/** The last lines the window shows, as text. */
export async function macReadScreen(pid: number, lines = 40): Promise<string> {
  const tty = await ttyOf(pid)
  const out = await osa([...FIND_TAB, 'on run argv', '  set {w, t} to findTab(item 1 of argv)', '  tell application "Terminal" to return contents of t', 'end run'], [tty])
  const rows = out.replace(/\s+$/, '').split(/\r?\n/).map((r) => r.trimEnd())
  return rows.slice(-lines).join('\n') + '\n'
}

export async function macBringToFront(pid: number): Promise<void> {
  const tty = await ttyOf(pid)
  await osa([...FIND_TAB, 'on run argv', '  front(item 1 of argv)', 'end run'], [tty])
}
