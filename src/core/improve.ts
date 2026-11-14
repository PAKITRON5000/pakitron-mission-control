// EV171 «Mejorar mi proyecto» (the user, 14-11 15:25: «imagina que alguien añade un proyecto que ya tenía, como nuestra
// app se encarga también de revisar y mejorar proyectos, pues que haya un botón para proyectos ya hechos y que el claude
// o los claude mejoren el proyecto que haya añadido la persona… que cuando añada el proyecto, esto se haga
// automáticamente»). What a Claude is asked: go over the whole project, write the improvements down as tasks with how
// each is judged done, and start with the first. No node imports: the screens use it too.
import { t } from './i18n'

/** The request a Claude receives (a note to the project: the first one that works there reads it, or it is opened for it). */
export function improveText(name: string): string {
  return t('Mejorar mi proyecto ({name}): el usuario quiere que reviséis {name} entero y lo mejoréis. Repásalo como quien lo ve por primera vez: qué es y para qué sirve, qué falla, qué falta, las pruebas, el rendimiento, la seguridad y lo que se ve. Apunta cada mejora en docs/TASKS.md como una tarea con «se da por buena cuando…», ordenadas por lo que más le sirve al usuario, y rellena docs/PROYECTO.md si está a medias. Después reserva la primera (pmc claim) y empiézala. Lo que cambie algo importante del proyecto o no se pueda deshacer, pregúntalo antes con pmc decide.', { name })
}

/**
 * Whether adding this project should ask for it to be improved by itself: only a folder that already has work in it
 * (a new, empty one starts with its plan instead), and never twice within a week for the same project.
 */
export function improveOnAdd(o: { hasWork: boolean; lastAskedAt?: number; now: number }): boolean {
  return o.hasWork && (!o.lastAskedAt || o.now - o.lastAskedAt > 7 * 86400_000)
}
