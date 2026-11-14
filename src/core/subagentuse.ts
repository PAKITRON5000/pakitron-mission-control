// How often each subagent is really used (EV32, EV43). Measured from the conversations Claude Code keeps per account and
// folder (<config>/projects/<folder with every non-letter as «-»>/*.jsonl): a call is an assistant tool use whose input
// names a «subagent_type». The tool's own description also mentions subagent_type, but as an object, so it never counts.
// First measure (12-11, 12:40): since the subagents were created at 06:00, no account had called one.
//
// Never on the app's main thread and never the same bytes twice (12-11: The game project had ~2 GB of conversations in a week,
// shared by six accounts through links, and reading them at once froze Ajustes): each file is read once by its real path,
// and a file that grew is read from where it was left (conversations only ever grow at the end).
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const transcriptDir = (configDir: string, cwd: string): string => join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))

/** Subagent calls in a piece of transcript text, by name. */
export function countCalls(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of text.matchAll(/"subagent_type":"([A-Za-z0-9_-]+)"/g)) out[m[1]] = (out[m[1]] ?? 0) + 1
  // Skills loaded (EV26), as «skill:<name>»: which of the installed ones a project really uses.
  for (const m of text.matchAll(/"name":"Skill","input":\{"skill":"([A-Za-z0-9:_.-]+)"/g)) out[`skill:${m[1]}`] = (out[`skill:${m[1]}`] ?? 0) + 1
  // MCP tools called, by server, as «mcp:<server>» (EV26): «mcp__claude-in-chrome__navigate» counts for claude-in-chrome.
  for (const m of text.matchAll(/"type":"tool_use","id":"[^"]*","name":"mcp__([A-Za-z0-9_.-]+?)__[A-Za-z0-9_.-]+"/g)) out[`mcp:${m[1]}`] = (out[`mcp:${m[1]}`] ?? 0) + 1
  // Files read whole (a Read with only its path: no offset nor limit), as «leido:<path>» (EV117, weak point «gasta
  // contexto»): the screen keeps the big ones, looking at their size now.
  for (const m of text.matchAll(/"name":"Read","input":\{"file_path":"((?:[^"\\]|\\.)+)"\}/g)) { const k = `leido:${m[1].replace(/\\\\/g, '\\')}`; out[k] = (out[k] ?? 0) + 1 }
  return out
}

const add = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v }

interface Seen { size: number; mtime: number; calls: Record<string, number>; tail: string }
const cache = new Map<string, Seen>()
const CHUNK = 8 << 20

/** Reads only what the file gained since last time, in pieces; a line cut between pieces is kept for the next one. */
async function scan(file: string, size: number, mtime: number): Promise<Record<string, number>> {
  let s = cache.get(file)
  if (s && s.size === size && s.mtime === mtime) return s.calls
  if (!s || size < s.size) s = { size: 0, mtime: 0, calls: {}, tail: '' }
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(CHUNK)
    let pos = s.size
    let tail = s.tail
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos)
      if (!bytesRead) break
      pos += bytesRead
      const text = tail + buf.toString('utf8', 0, bytesRead)
      const cut = text.lastIndexOf('\n')
      add(s.calls, countCalls(cut >= 0 ? text.slice(0, cut) : ''))
      tail = cut >= 0 ? text.slice(cut + 1) : text
      if (tail.length > CHUNK) tail = '' // one enormous line: nothing countable in it
      await new Promise((r) => setImmediate(r)) // let the app breathe between pieces
    }
    cache.set(file, { size: pos, mtime, calls: s.calls, tail })
    return s.calls
  } finally { await fh.close() }
}

/** Calls per subagent in the last `days`, across every account and copy of a project. */
export async function subagentUse(configDirs: string[], copies: string[], now = Date.now(), days = 7): Promise<Record<string, number>> {
  const since = now - days * 86400_000
  const files = new Map<string, { size: number; mtime: number }>()
  for (const conf of configDirs) for (const cwd of copies) {
    const dir = transcriptDir(conf, cwd)
    let names: string[] = []
    try { names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl')) } catch { continue }
    for (const n of names) {
      try {
        const real = await realpath(join(dir, n))
        if (files.has(real.toLowerCase())) continue
        const st = await stat(real)
        if (st.mtimeMs >= since) files.set(real.toLowerCase(), { size: st.size, mtime: st.mtimeMs })
      } catch { /* gone */ }
    }
  }
  const total: Record<string, number> = {}
  for (const [f, st] of files) {
    try { add(total, await scan(f, st.size, st.mtime)) } catch { /* being written: next time */ }
  }
  return total
}
