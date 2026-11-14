// What a conversation must keep when Claude Code compacts it (EV76; research, improvement 6: Claude forgets what was
// asked and decided when its context is summarised). The PreCompact hook prints this and Claude Code adds it to the
// summary's instructions (checked in Claude Code 2.1: the output becomes `newCustomInstructions`, up to 10.000
// characters, only when the hook is not run in the background). After compacting, SessionStart (source «compact»)
// gives the project's package again (EV63).

export interface CompactInput {
  project: string
  /** The tasks this account holds now (`pmc claim`). */
  claims: { id: string; title?: string; note?: string }[]
  /** The user's standing rules and tastes for this project (Memoria). */
  rules: string[]
  /** What the project's handoff says is going on. */
  enCurso?: string
}

import { t } from './i18n'

const MAX = 3_500

export function compactInstructions(i: CompactInput): string {
  const lines: string[] = [
    t('Instrucciones de Mission Control para este resumen ({project}). Quien siga después del resumen eres tú mismo: conserva lo que necesitarás para seguir sin repetir ni romper nada.', { project: i.project }),
    t('Conserva, con detalle y literalmente cuando se diga:'),
    t('1. La tarea en curso (su ID) y el paso exacto en el que estás: qué está hecho, qué está a medias y qué falta.'),
    t('2. Los archivos que has cambiado y si están guardados en un commit (con su hash) o no.'),
    t('3. Lo que el usuario ha pedido, corregido o decidido en esta conversación, con sus propias palabras entre comillas y la hora.'),
    t('4. Lo que falta comprobar antes de dar algo por hecho (pruebas, capturas, pmc verifica) y lo que ya se comprobó y cómo.'),
    t('5. Los errores que ya ocurrieron y cómo se resolvieron, para no repetirlos.'),
    t('6. Las preguntas hechas al usuario en Decidir (su número) que siguen sin respuesta.'),
    t('7. El siguiente paso concreto.'),
    t('Puedes quitar: salidas largas de órdenes, contenidos de archivos que se pueden volver a leer, búsquedas que no llevaron a nada y capturas ya revisadas.')
  ]
  if (i.claims.length) lines.push(t('Tus reservas ahora (no las pierdas de vista): {list}.', { list: i.claims.map((c) => `${c.id}${c.title ? ' · ' + c.title.slice(0, 70) : ''}${c.note ? ` (${c.note.slice(0, 60)})` : ''}`).join('; ') }))
  if (i.rules.length) lines.push(t('Reglas del usuario que siguen en pie: {list}', { list: i.rules.slice(0, 6).map((r) => r.slice(0, 160)).join(' · ') }))
  if (i.enCurso) lines.push(t('En curso según el relevo: {text}', { text: i.enCurso.slice(0, 500) }))
  const text = lines.join('\n')
  return text.length > MAX ? text.slice(0, MAX - 1) + '…' : text
}
