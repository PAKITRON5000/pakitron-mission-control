// A task's acceptance criterion (EV78; research, improvement 8: Claude declares things done that are not). A task in
// TASKS.md can say «se da por buena cuando …» (or «Criterio: …»); `pmc tarea` and `pmc verifica` put it first, so the
// one doing it checks exactly that before saying it is done. No node imports.

const PATTERNS = [
  /se da(?:rá)? por buena cuando\s+([^.;\n]+(?:\.[^\s*][^.;\n]*)*)/i,
  /\bcriterio(?: de aceptación)?\s*:\s*([^.;\n]+)/i,
  /\bpasa cuando\s+([^.;\n]+)/i
]

/** The criterion written in a task, without its markup; undefined when it has none. */
export function acceptanceOf(text: string | undefined): string | undefined {
  if (!text) return undefined
  for (const re of PATTERNS) {
    const m = re.exec(text)
    if (m) return m[1].replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim().replace(/[«»]$/, '') || undefined
  }
  return undefined
}

/** The line `pmc tarea` and `pmc verifica` print. */
export function acceptanceLine(text: string | undefined): string {
  const c = acceptanceOf(text)
  return c
    ? `Se da por buena cuando: ${c}. Compruébalo tú antes de darla por hecha (pmc verifica <ID>; si se ve o se oye, pmc entrega con foto).`
    : 'Esta tarea no dice cuándo se da por buena: antes de cerrarla, escribe en su línea de docs/TASKS.md «se da por buena cuando …» y compruébalo.'
}
