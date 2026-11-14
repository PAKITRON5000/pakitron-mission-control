// Rules that contradict each other (EV92; research, improvement 2: «al guardar una regla en Memoria… avisar si contradice
// una anterior del mismo proyecto (mismas palabras clave, sentido opuesto) y preguntar cuál vale; en el paquete de
// arranque, solo la vigente»). Two memories clash when they talk about the same thing (enough key words in common) and
// one forbids what the other asks for. A guess, said as one: the user decides which holds. No node imports.

const NEGATIVE = /\b(no|nunca|jam[aá]s|ni|nada de|evita|evitar|prohibido|prohibida|deja de|dejar de|sin)\b/i
const STOP = new Set(['para', 'pero', 'como', 'cuando', 'donde', 'desde', 'hasta', 'sobre', 'entre', 'porque', 'esto', 'esta', 'este', 'estos', 'estas', 'antes', 'después', 'despues', 'siempre', 'nunca', 'jamás', 'jamas', 'todo', 'toda', 'todos', 'todas', 'cada', 'algo', 'nada', 'solo', 'sólo', 'también', 'tambien', 'mismo', 'misma', 'otra', 'otro', 'otras', 'otros', 'hace', 'hacer', 'haga', 'hagas', 'debe', 'deben', 'tiene', 'tienen', 'tener', 'puede', 'pueden', 'poder', 'usar', 'usa', 'usen', 'evita', 'evitar', 'deja', 'dejar', 'prohibido', 'prohibida', 'claude', 'usuario', 'proyecto', 'quiere', 'quiero', 'mejor', 'bien', 'más', 'mas', 'menos', 'muy', 'ellos', 'ellas', 'suyo', 'suya', 'aquí', 'aqui', 'ahí', 'ahi', 'that', 'this', 'with', 'never', 'always'])

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** The words that say what a memory is about: 4 letters or more, no filler, plurals folded («fotos» = «foto»). */
export function keywords(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of fold(text).match(/[a-z0-9ñ._/-]{4,}/g) ?? []) {
    if (STOP.has(w)) continue
    out.add(w.replace(/(es|s)$/, '').replace(/[._/-]+$/, ''))
  }
  return out
}

/** «No…», «nunca…», «sin…», «evita…»: the memory forbids. */
export const forbids = (text: string): boolean => NEGATIVE.test(fold(text).replace(/[«»"“”]/g, ' '))

/** Whether two memories talk about the same thing and one forbids what the other asks for. */
export function clash(a: string, b: string, strict = false): boolean {
  if (forbids(a) === forbids(b)) return false
  const ka = keywords(a), kb = keywords(b)
  const shared = [...ka].filter((w) => kb.has(w)).length
  const share = shared / Math.max(1, Math.min(ka.size, kb.size))
  // Strict: what drops a memory from the start-up package by itself, with nobody asked, needs more in common than what
  // only asks the user (a false alarm there would hide a real rule from every session).
  return strict ? shared >= 3 && share >= 0.6 : shared >= 2 && share >= 0.4
}

/** The memories a new text would contradict. */
export function conflictsOf<T extends { text: string }>(text: string, existing: T[]): T[] {
  return existing.filter((m) => clash(text, m.text))
}

/** Only the one in force: of two that clash, the newer stays (for the start-up package). */
export function inForce<T extends { text: string; at: number }>(memories: T[]): T[] {
  const newest = [...memories].sort((x, y) => y.at - x.at)
  const kept: T[] = []
  for (const m of newest) if (!kept.some((k) => clash(k.text, m.text, true))) kept.push(m)
  return memories.filter((m) => kept.includes(m))
}
