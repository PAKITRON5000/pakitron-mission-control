// Where a request written in the app goes (EV46): the project its words point to, and the account that will do it. Before,
// «Nueva instrucción» went to the project on screen and to «any Claude»: a request about the game written while looking at
// the video project landed in the wrong one, and nobody said who would pick it up. No node imports: the screens use it.

const STOP = new Set(['para', 'como', 'que', 'con', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'este', 'esta', 'esto', 'pero', 'cuando', 'donde', 'todo', 'todos', 'todas',
  'hacer', 'haz', 'quiero', 'tiene', 'tienen', 'sobre', 'entre', 'mas', 'muy', 'bien', 'mejor', 'ahora', 'tambien', 'claude', 'cada', 'sin', 'por', 'porque', 'sea', 'son', 'estan', 'esta'])

/** Plural and singular are the same word here («subtítulos» in the request, «subtítulo» in the task, 12-11). */
const stem = (w: string) => (w.length > 6 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)

export function words(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map(stem)
}

export interface RouteProject { id: string; name: string; /** Words that are this project's own: task titles, kinds, folders. */ vocabulary: string[] }

/**
 * The project the words point to. Its name counts most; then words only its tasks use. Undefined when nothing stands out:
 * the request stays in the project on screen.
 */
/**
 * Each project's words, and in how many projects each word appears, made once per list of projects (13-11: made again
 * for every message, it took seconds to place a few days of requests and froze the app when Inicio opened).
 */
const preparedFor = new WeakMap<RouteProject[], { seen: Map<string, number>; vocab: Set<string>[] }>()
function prepared(projects: RouteProject[]): { seen: Map<string, number>; vocab: Set<string>[] } {
  const known = preparedFor.get(projects)
  if (known) return known
  const vocab = projects.map((p) => new Set(p.vocabulary.flatMap(words)))
  // A word every project uses («tarea», «pantalla») says nothing about which one.
  const seen = new Map<string, number>()
  for (const v of vocab) for (const w of v) seen.set(w, (seen.get(w) ?? 0) + 1)
  const out = { seen, vocab }
  preparedFor.set(projects, out)
  return out
}

export function guessProject(text: string, projects: RouteProject[]): { id: string; why: string; byName: number; own: number } | undefined {
  const said = new Set(words(text))
  if (!said.size || projects.length < 2) return undefined
  const { seen, vocab } = prepared(projects)
  const scored = projects.map((p, k) => {
    const nameWords = words(p.name)
    const byName = nameWords.filter((w) => said.has(w))
    const own = [...said].filter((w) => vocab[k].has(w) && seen.get(w) === 1)
    return { p, score: byName.length * 5 + own.length, byName, own }
  }).sort((a, b) => b.score - a.score)
  const [first, second] = scored
  // Two of its own words, well ahead of the next; or one long, specific word («subtítulos») no other project has.
  const lone = first && first.score === 1 && first.own.length === 1 && first.own[0].length >= 8 && (!second || second.score === 0)
  if (!first || (first.score < 2 && !lone) || (second && first.score < second.score * 2)) return undefined
  return { id: first.p.id, byName: first.byName.length, own: first.own.length, why: first.byName.length ? `nombras «${first.p.name}»` : `«${first.own.slice(0, 3).join('», «')}» solo ${first.own.length > 1 ? 'salen' : 'sale'} en sus tareas` }
}

export interface RouteAccount {
  id: string
  /** «No usar» or «De baja». */
  out: boolean
  limited: boolean
  weekFree?: number
  /** Projects where it has a window, and whether it is working in each. */
  windows: { projectId?: string; working: boolean }[]
}

/**
 * Who should do it: the one already working on that project (it reads it at its next step), else one with its window
 * open there and idle, else a free one with no window elsewhere and the most week left.
 */
export function pickAccount(projectId: string, accounts: RouteAccount[]): { id: string; why: string } | undefined {
  const usable = accounts.filter((a) => !a.out && !a.limited)
  const here = usable.find((a) => a.windows.some((w) => w.projectId === projectId && w.working))
  if (here) return { id: here.id, why: 'ya trabaja en ese proyecto: lo leerá en su próximo paso' }
  const idle = usable.find((a) => a.windows.some((w) => w.projectId === projectId) && !a.windows.some((w) => w.working))
  if (idle) return { id: idle.id, why: 'tiene su ventana abierta en ese proyecto: se le escribe ahí' }
  const free = usable.filter((a) => !a.windows.some((w) => w.projectId !== projectId)).sort((a, b) => (b.weekFree ?? -1) - (a.weekFree ?? -1))[0]
  if (free) return { id: free.id, why: `está libre${free.weekFree != null ? ` y le queda el ${free.weekFree} % de la semana` : ''}` }
  return undefined
}
