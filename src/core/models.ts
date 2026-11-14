// The model a task asks for, as Claude Code arguments (EV39). A task tagged «[sonnet]» does not need Opus or Fable: opening
// it with Sonnet keeps the expensive models for what asks for them. «[fable u opus]» is a choice: the account's own model.
// No node imports.

export function modelArgs(tag: string | undefined, noFable = false): string[] {
  const m = (tag ?? '').toLowerCase().trim()
  if (!m || /\s(u|o|or)\s/.test(m)) return []
  if (m.includes('haiku')) return ['--model', 'haiku']
  if (m.includes('sonnet')) return ['--model', 'sonnet']
  if (m.includes('opus')) return ['--model', 'opus']
  if (m.includes('fable')) return noFable ? [] : ['--model', 'fable']
  return []
}

/**
 * The effort a task asks for (EV101: «cambiar de modelo o esfuerzo según convenga»). Mechanical work («[sonnet]»,
 * «[haiku]») goes with medium effort, which spends less; the rest keeps the account's own (xhigh by default), since a
 * task marked for Opus or Fable is the one that needs to think.
 */
export function effortArgs(tag: string | undefined): string[] {
  const m = (tag ?? '').toLowerCase().trim()
  if (!m || /\s(u|o|or)\s/.test(m)) return []
  return /sonnet|haiku/.test(m) ? ['--effort', 'medium'] : []
}
