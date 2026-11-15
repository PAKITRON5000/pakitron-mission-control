// EV156: the Claude sessions that live inside the app. Each one runs in a pseudoconsole owned by a small process of its
// own (src/ptyhost/host.ts), apart from the app: a Claude inside the app that runs `npm run actualizar` closes the app,
// not itself, and the app finds it again when it reopens. The app and that process talk over a local pipe (a named pipe
// on Windows, a socket file elsewhere) with one JSON message per line; nothing leaves the PC.
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Raised only when a message changes meaning: an app finds an older host still running and must still understand it. */
export const PTY_PROTO = 1

export function ptyPipeName(dataRoot: string, platform: NodeJS.Platform = process.platform): string {
  // One per data folder: a capture run (its own PMC_DATA_DIR) never reaches the user's real sessions.
  if (platform === 'win32') return `\\\\.\\pipe\\pakitron-mc-pty-${createHash('sha1').update(dataRoot.toLowerCase()).digest('hex').slice(0, 12)}`
  return join(dataRoot, 'pty.sock')
}

/** What the app knows of a session when it starts it; the host only keeps it and gives it back. */
export interface PtyMeta {
  account: string
  projectId?: string
  cwd: string
  title: string
  /** The conversation it continues, when started with `--resume`. */
  resume?: string
}

export interface PtyInfo {
  id: string
  pid: number
  meta: PtyMeta
  startedAt: number
  alive: boolean
  exitCode?: number
  endedAt?: number
  cols: number
  rows: number
  /** When it last wrote something on its screen. */
  lastDataAt: number
}

export type ToHost =
  | { op: 'hello'; token: string; v: number }
  | { op: 'spawn'; req: number; id: string; file: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number; meta: PtyMeta }
  | { op: 'write'; id: string; data: string }
  | { op: 'resize'; id: string; cols: number; rows: number }
  | { op: 'kill'; req: number; id: string }
  | { op: 'forget'; id: string }
  | { op: 'list'; req: number }
  /** Its screen with the scrollback, as text with its colours, to draw it in a new view; `seq` is the last piece it has. */
  | { op: 'snapshot'; req: number; id: string }
  /** The last lines on its screen as plain text (what the app reads before answering a question for the user). */
  | { op: 'screen'; req: number; id: string; lines: number }

export type FromHost =
  | { op: 'hello'; v: number; pid: number; version: string }
  | { op: 'reply'; req: number; ok: boolean; error?: string; value?: unknown }
  | { op: 'data'; id: string; seq: number; data: string }
  | { op: 'exit'; id: string; code: number }
  | { op: 'list'; sessions: PtyInfo[] }

/** Splits what arrives on the pipe into whole lines; a piece of a line waits for the rest. */
export class LineSplitter {
  private rest = ''
  push(chunk: string): string[] {
    const text = this.rest + chunk
    const lines = text.split('\n')
    this.rest = lines.pop() ?? ''
    return lines.filter((l) => l.trim())
  }
}

export function encodeMsg(m: ToHost | FromHost): string {
  return JSON.stringify(m) + '\n'
}

/** A message from the other side, or undefined when it is not one (never throws). */
export function decodeMsg<T extends { op: string }>(line: string): T | undefined {
  try {
    const m = JSON.parse(line) as T
    return m && typeof m === 'object' && typeof m.op === 'string' ? m : undefined
  } catch {
    return undefined
  }
}

/** The keys the app sends to a Claude (`chatKey`), as a terminal sends them. */
export function keyBytes(key: string): string | undefined {
  // EV197: the phone's key bar adds Shift+Tab (Claude Code's modes), the side arrows and Backspace. Not Ctrl+C: two of
  // them close Claude Code, too easy with a thumb.
  const k: Record<string, string> = { esc: '\x1b', enter: '\r', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', tab: '\t', 'shift-tab': '\x1b[Z', backspace: '\x7f' }
  if (k[key]) return k[key]
  return /^[0-9a-z]$/i.test(key) ? key : undefined
}

/**
 * The text a message becomes when typed into a Claude: one line (a line break would send it half written) and, apart,
 * Enter, as a person types it (together, Claude Code would read it as a pasted line break and wait).
 */
export function typedLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim()
}

/**
 * The size a view of `w`×`h` pixels holds with cells of `cw`×`ch`: never so small that Claude Code cannot draw its box,
 * never more than a terminal sensibly has.
 */
export function cellsFor(w: number, h: number, cw: number, ch: number): { cols: number; rows: number } {
  const cols = Math.floor(w / Math.max(1, cw))
  const rows = Math.floor(h / Math.max(1, ch))
  return { cols: Math.max(40, Math.min(400, cols || 80)), rows: Math.max(8, Math.min(200, rows || 24)) }
}
