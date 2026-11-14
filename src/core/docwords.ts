// EV164: the words the project documents share with the Claudes (RELEVO.md, TASKS.md), in both languages of the app.
// Whatever reads them accepts both, so a project kept in English and one kept in Spanish work alike, and so does one that
// changed language half way; whatever writes them uses the app's language. No node imports.
import { getLang } from './i18n'

/** «En curso» / «In progress»: the live paragraph of a RELEVO.md (a regular-expression source). */
export const IN_PROGRESS = '(?:En curso|In progress)'
/** «Último latido» / «Last heartbeat». */
export const HEARTBEAT = '(?:Último latido|Last heartbeat)'
/** «Latido anterior» / «Previous heartbeat»: the heartbeat a new one replaced, kept right below it. */
export const PREVIOUS_HEARTBEAT = '(?:Latido anterior|Previous heartbeat)'
/** Any heartbeat line, current or previous. */
export const ANY_HEARTBEAT = '(?:Último latido|Latido|Last heartbeat|Previous heartbeat)'
/** «(tras: EV12)» / «(after: EV12)»: a task that waits for others. */
export const AFTER = '(?:tras|after)'

/** The words a writer uses, in the app's language. */
export function docWords(): { inProgress: string; heartbeat: string; previous: string; after: string; doneWhen: string } {
  return getLang() === 'en'
    ? { inProgress: 'In progress', heartbeat: 'Last heartbeat', previous: 'Previous heartbeat', after: 'after', doneWhen: 'done when' }
    : { inProgress: 'En curso', heartbeat: 'Último latido', previous: 'Latido anterior', after: 'tras', doneWhen: 'se da por buena cuando' }
}

/** `^**<word>` for a line that starts with one of these, bold. */
export function boldStart(word: string, flags = 'i'): RegExp {
  return new RegExp(`^\\*\\*${word}`, flags)
}
