// EV52, step 2: with Mission Control's hooks both in an account and in a project, the same event runs `pmc hook` twice,
// at the same moment, in two processes. The first one to create a mark for the event does the work; the other one does
// nothing. Creating a file with the «wx» flag is atomic, so two processes can never both win.
// Not wired into `pmc hook` yet: it runs for every account at every step, so it goes in with care (see EV52).
import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The same event as both hooks see it: its session, its kind, and its tool call or, without one, the two seconds it began
 * in plus what it carries (`raw`, the very text both hooks receive). Without `raw`, two different tools called at once in
 * one session would share a key and the second would be lost, its guard included (13-11, before wiring it in).
 */
export function hookEventKey(data: { session_id?: string; hook_event_name?: string; tool_use_id?: string }, now = Date.now(), raw?: string): string {
  return [data.session_id ?? '', data.hook_event_name ?? '', data.tool_use_id ?? `${Math.floor(now / 2000)}:${raw ? digest(raw) : ''}`].join('|')
}

const digest = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36) + s.length
}

const fileName = (key: string) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return `h${(h >>> 0).toString(36)}-${key.length}`
}

/** True for the first process that asks for this event; false for any other. */
export function firstForEvent(dir: string, key: string): boolean {
  mkdirSync(dir, { recursive: true })
  try { closeSync(openSync(join(dir, fileName(key)), 'wx')); return true } catch { return false }
}

/** Removes the marks older than `ms` (called now and then; they are tiny). */
export function cleanEventMarks(dir: string, ms = 10 * 60_000, now = Date.now()): number {
  let n = 0
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      try { if (now - statSync(p).mtimeMs > ms) { unlinkSync(p); n++ } } catch { /* gone */ }
    }
  } catch { /* no folder */ }
  return n
}
