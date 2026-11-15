// EV161 (the user, 14-11 13:38: «molaría dejarla lista en inglés también para la gente que no entienda el español»): the
// app's texts in the user's language. The key is the Spanish text itself, so a text nobody translated yet shows in
// Spanish and nothing breaks, and the code still reads as it did. No node imports: the screens, the main process and
// the pmc CLI share it. `node scripts/idiomas.mjs` lists what is still missing.
import { en } from '../locales/en'

export type Lang = 'es' | 'en'
export const LANGS: { id: Lang; label: string }[] = [{ id: 'es', label: 'Español' }, { id: 'en', label: 'English' }]

const DICTS: Record<Lang, Record<string, string> | undefined> = { es: undefined, en }
let current: Lang = 'es'

/** The language chosen in Ajustes; with none chosen, the system's (Spanish only when the system is in Spanish). */
export function pickLang(saved: string | undefined, system: string | undefined): Lang {
  if (saved === 'es' || saved === 'en') return saved
  return /^es\b|^es-/i.test(system ?? '') ? 'es' : system ? 'en' : 'es'
}

export function setLang(l: Lang): void {
  current = l
}

export function getLang(): Lang {
  return current
}

/**
 * A text in the current language. `{name}` in the text is replaced with `vars.name`; a missing translation is the
 * Spanish text, so the screen is never left with a blank or a key.
 */
export function t(es: string, vars?: Record<string, string | number | undefined>): string {
  const s = DICTS[current]?.[es] ?? es
  const out = vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k]))) : s
  return macKeys ? withMacKeys(out) : out
}

/** On a Mac the shortcuts are pressed with ⌘: the same texts say so (the app accepts both). Ctrl + Tab stays Ctrl there. */
let macKeys = false
export function setMacKeys(on: boolean): void {
  macKeys = on
}

export function withMacKeys(s: string): string {
  if (!s.includes('Ctrl')) return s
  return s
    .replace(/Ctrl ?\+ ?Tab/g, '\u0000')
    .replace(/Ctrl ?\+ ?(?=[\p{L}\p{N}{…])/gu, '⌘')
    .replace(/Ctrl (?=[−0-9])/g, '⌘')
    .replace(/Ctrl \+/g, '⌘ +')
    .replace(/Ctrl ?(?=[A-Z]\b)/g, '⌘')
    .replace(/\u0000/g, 'Ctrl + Tab')
}

/** Singular or plural by count, both written in Spanish (the keys): `tn(n, '{n} tarea', '{n} tareas')`. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number | undefined>): string {
  return t(n === 1 ? one : many, { n, ...vars })
}

/** «Claude 1, Claude 3 y Claude 6» / «Claude 1, Claude 3 and Claude 6». */
export function namesList(names: string[]): string {
  if (names.length < 2) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} ${current === 'en' ? 'and' : 'y'} ${names[names.length - 1]}`
}

/** Dates and times in the current language («sáb, 15:30» / «Sat, 3:30 PM»). */
export function locale(): string {
  return current === 'en' ? 'en-GB' : 'es-ES'
}
