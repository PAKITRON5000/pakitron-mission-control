// EV91: orders in a CLAUDE.md that contradict each other. The loose rule of EV92 (shared words) gave false alarms on long
// console lines (claude1, 13-11: 6, none real); this one is strict: two lines with the same action (the verb after
// «siempre» / «nunca» / «no») on the same thing (two content words in common), one saying always and the other never.
// No node imports.

const STOP = new Set(['para', 'como', 'que', 'con', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'este', 'esta', 'esto', 'pero', 'cuando', 'donde', 'todo', 'todos', 'todas', 'cada', 'sin', 'por', 'porque', 'sea', 'son', 'antes', 'despues', 'nada', 'algo', 'mas', 'muy', 'bien'])
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Order { line: string; never: boolean; verb: string; things: Set<string> }

/** An order of a line: its polarity, the start of its verb and what it is about. */
export function orderOf(line: string): Order | undefined {
  const t = norm(line).replace(/[`*_«»"'()[\].,;:]/g, ' ')
  const m = t.match(/\b(siempre|nunca|jamas|no)\s+(?:se\s+|le\s+|lo\s+|la\s+)?([a-zñ]{3,})\b(.*)$/)
  if (!m) return undefined
  const never = m[1] !== 'siempre'
  const things = new Set(m[3].split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => (w.length > 5 && w.endsWith('s') ? w.slice(0, -1) : w)))
  // The start of the verb only: «usa»/«uses», «toca»/«toques» (strictness comes from the two shared things).
  return { line: line.trim(), never, verb: m[2].replace(/qu/g, 'c').slice(0, 2), things }
}

/** Pairs of lines that say «always» and «never» of the same action on the same thing. */
export function strictClashes(lines: string[]): [string, string][] {
  const orders = lines.map(orderOf).filter((o): o is Order => Boolean(o && o.things.size >= 2))
  const out: [string, string][] = []
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const a = orders[i]
      const b = orders[j]
      if (a.never === b.never || a.verb !== b.verb) continue
      const shared = [...a.things].filter((w) => b.things.has(w))
      if (shared.length >= 2) out.push([a.line, b.line])
    }
  }
  return out
}
