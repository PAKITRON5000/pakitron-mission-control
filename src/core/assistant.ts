import { t } from './i18n'
// The assistant inside the app (EV85, Decidir #127, the user: «algo que puedas preguntarle o pedirle y que funcione con el
// Claude en trabajo en paralelo… no como un menú sino un asistente… y un apartado visual para él»).
//
// It answers from what the app already knows (no usage spent): what waits for the user, who works, how much usage is left,
// photos, what an account did last night, the tasks and the wheel. A request goes, as an instruction, to the Claude that
// holds the turn of its project, saying to whom and when it will see it. Only «Pregúntale a Claude» spends usage, and says so.
//
// Here: understanding the words and building each answer from plain data. No node imports: main/assistant.ts gathers the
// data, and the tests feed it by hand.
import { memberViews, nextInLine, type ChainMember, type RelayChain } from './chain'

export type Intent = 'ayuda' | 'gracias' | 'espera' | 'quien' | 'uso' | 'fotos' | 'hizo' | 'tareas' | 'rueda' | 'recargas' | 'disco' | 'carga' | 'pedido' | 'nose'

export interface Range { from: number; to: number; label: string }

export interface Understood {
  intent: Intent
  /** The account the words name («Claude 3»). */
  account?: string
  /** The project the words name. */
  projectId?: string
  range?: Range
  /** What to look for in the gallery. */
  topic?: string
  /** A task id written in the text (EV85, APP6-3). */
  taskId?: string
}

/** Where a row of an answer leads: a screen (in a project, scrolled to something), an account, or a picture. */
export type Go =
  | { route: string; projectId?: string; focus?: { kind: 'task' | 'asset' | 'decision' | 'note'; id: number; q?: string } }
  | { agent: string }
  | { asset: number }

export interface ReplyRow {
  title: string
  sub?: string
  /** Shown as the account's avatar. */
  account?: string
  /** A coloured dot when there is no account. */
  color?: string
  /** A bar (0-100) with its words: usage. */
  meter?: { pct: number; label: string }
  go?: Go
}

/** A request about to be passed on: shown to the user with «Enviar» before anything is sent. */
export interface SendPlan {
  projectId: string
  project: string
  /** None: the first Claude that works on the project takes it. */
  target?: string
  body: string
  kind: 'mensaje' | 'correccion' | 'prioridad' | 'general' | 'idea' | 'nota'
  /** «Claude 3», «el primer Claude que trabaje en Mission Control»… */
  who: string
  /** When it will see it, in plain words. */
  when: string
  /** After saving it, write it in its window or open it there (through the dispatcher, never a window too many). */
  start: boolean
}

export interface Reply {
  intent: Intent
  text: string
  rows?: ReplyRow[]
  photos?: { id: number; name: string; projectId: string }[]
  more?: { label: string; go: Go }
  send?: SendPlan
  /** Follow-up questions, one tap away. */
  chips?: string[]
  /** Offer «Pregúntale a Claude» (spends usage). */
  offerClaude?: boolean
  /** Who answered, when it was not the app itself. */
  by?: string
}

// ---- words ------------------------------------------------------------------------------------------------------------

export const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:()«»"'`]/g, ' ').replace(/\s+/g, ' ').trim()

const who = (id: string) => `Claude ${id.slice(6)}`
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const DAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
/** «a las 04:30» today (or within the next hours), «el vie a las 04:30» otherwise. */
export function whenText(ms: number, now: number): string {
  const d = new Date(ms)
  if (d.toDateString() === new Date(now).toDateString() || (ms > now && ms - now < 12 * 3600_000)) return t('a las {v0}', { v0: hhmm(ms) })
  return t('el {v0} {v1} a las {v2}', { v0: DAY[d.getDay()], v1: d.getDate(), v2: hhmm(ms) })
}
export function agoText(ms: number, now: number): string {
  const m = Math.round((now - ms) / 60_000)
  if (m < 1) return 'ahora mismo'
  if (m < 60) return t('hace {m} min', { m: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('hace {h} h', { h: h })
  return t('hace {v0} d', { v0: Math.round(h / 24) })
}

/** The time the words point to («anoche», «hoy», «ayer», «esta mañana», «las últimas 3 horas»…). */
export function timeRange(t: string, now: number): Range | undefined {
  const d0 = new Date(now)
  d0.setHours(0, 0, 0, 0)
  const at = (days: number, h: number) => { const d = new Date(d0); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.getTime() }
  const cap = (r: Range): Range => ({ ...r, to: Math.min(r.to, now) })
  if (/\b(esta noche)\b/.test(t) && new Date(now).getHours() >= 12) return cap({ from: at(0, 20), to: at(1, 8), label: 'esta noche' })
  // Before noon, the night is the one just gone (or still going: at 02:30, from 20:00 until now).
  if (/\b(anoche|esta noche|de noche|por la noche|la noche)\b/.test(t)) return cap({ from: at(-1, 20), to: at(0, 8), label: 'anoche' })
  if (/\b(antes de ayer|anteayer)\b/.test(t)) return { from: at(-2, 0), to: at(-1, 0), label: 'anteayer' }
  if (/\bayer\b/.test(t)) return { from: at(-1, 0), to: at(0, 0), label: 'ayer' }
  if (/\besta manana\b/.test(t)) return cap({ from: at(0, 6), to: at(0, 14), label: 'esta mañana' })
  if (/\besta tarde\b/.test(t)) return cap({ from: at(0, 14), to: at(0, 21), label: 'esta tarde' })
  if (/\bhoy\b/.test(t)) return { from: at(0, 0), to: now, label: 'hoy' }
  const h = t.match(/\bultimas? (\d{1,2}) horas?\b/)
  if (h) return { from: now - Number(h[1]) * 3600_000, to: now, label: `las últimas ${h[1]} horas` }
  if (/\b(ultima hora|hace un rato|un rato)\b/.test(t)) return { from: now - 2 * 3600_000, to: now, label: 'las últimas 2 horas' }
  if (/\besta semana\b/.test(t)) { const dow = (new Date(now).getDay() + 6) % 7; return { from: at(-dow, 0), to: now, label: 'esta semana' } }
  return undefined
}

const REQUEST_VERB = /^(por favor |porfa |oye |eh )?(haz|hazme|hagan|arregla|arreglad|corrige|cambia|pon|ponle|quita|quitale|anade|agrega|mete|mejora|crea|prueba|revisa|comprueba|termina|acaba|sigue con|empieza|deja|borra|sube|baja|traduce|escribe|prepara|graba|renderiza|compila|instala|actualiza|encargate|ocupate|dile|pidele|encargale|recuerdale|avisale|manda|envia|que claude|quiero que|necesito que|me gustaria que|podrias|puedes|haced|ponte|investiga|busca una|disena|dibuja|anima)\b/
const QUESTION_START = /^(que|quien|quienes|cuanto|cuanta|cuantos|cuantas|cuando|donde|como|hay|tengo|esta|estan|en que|por que|cual|cuales|sabes)\b/
const SHOW = /\b(fotos?|imagenes?|capturas?|videos?|renders?|modelos 3d|galeria|pantallazos?)\b/

/** What the words ask for. */
export function understand(text: string, ctx: { projects: { id: string; name: string }[]; accounts: { id: string; alias?: string; name?: string }[] }, now = Date.now()): Understood {
  const raw = text.trim()
  const t = norm(raw)
  const out: Understood = { intent: 'nose' }
  const n = t.match(/\bclaude ?(\d{1,2})\b/)
  if (n && ctx.accounts.some((a) => a.id === `claude${n[1]}`)) out.account = `claude${n[1]}`
  else {
    // EV99: the name the user gave it in the app, or the account's own label.
    const said = (x?: string) => Boolean(x && x.length >= 3 && new RegExp(`\\b${norm(x).replace(/[^a-z0-9 ]/g, '')}\\b`).test(t))
    const byAlias = ctx.accounts.find((a) => said(a.name)) ?? ctx.accounts.find((a) => said(a.alias))
    if (byAlias) out.account = byAlias.id
  }
  out.projectId = projectNamed(t, ctx.projects)
  out.range = timeRange(t, now)
  const id = raw.match(/\b([A-Za-z]{1,8}\d{1,4}(?:-\d{1,3})?)\b/g)?.find((x) => !/^claude/i.test(x) && /[A-Z]/.test(x))
  if (id) out.taskId = id.toUpperCase()

  if (!t || /^(hola|buenas|hey|ey|ayuda|help|menu)\b/.test(t) || /\b(que (puedes|sabes) hacer|para que sirves|como funcionas|que eres)\b/.test(t)) return { ...out, intent: 'ayuda' }
  if (/^(gracias|ok|vale|genial|perfecto|bien|guay|de acuerdo|entendido)\b/.test(t) && t.split(' ').length <= 4) return { ...out, intent: 'gracias' }
  // «Que Claude 6 mire…», «dile a…»: an order even when it starts like a question.
  if (/^(por favor |porfa )?(que claude ?\d+ |dile |pidele |encargale |recuerdale |avisale )/.test(t) && !/[?¿]/.test(raw)) return { ...out, intent: 'pedido' }
  const asks = /[?¿]/.test(raw) || QUESTION_START.test(t)
  // «Arregla la foto del glaciar» is a request; «enséñame las fotos del glaciar» is not.
  if (!asks && REQUEST_VERB.test(t)) return { ...out, intent: 'pedido' }
  if (SHOW.test(t) || /^(ensename|muestrame|ensena|muestra|ver|dame|pasame)\b/.test(t)) return { ...out, intent: 'fotos', topic: topicOf(t, ctx.projects) }
  if (/\b(me (espera|esperan|toca|tocan|necesitan|falta)|tengo (que|pendiente)|para mi|lo mio|que hay que (decidir|revisar|aprobar)|que (debo|tengo que)|esperan de mi|pendiente de mi|hay algo para mi|me he perdido)\b/.test(t)) return { ...out, intent: 'espera' }
  if (/\b(que (ha |han )?(hizo|hicieron|hecho|paso|pasado|ha pasado|hay de nuevo|ha habido)|que tal (fue|ha ido|la noche)|novedades|resumen|que se ha hecho|que hicisteis)\b/.test(t)) return { ...out, intent: 'hizo', range: out.range ?? { from: now - 12 * 3600_000, to: now, label: 'las últimas 12 horas' } }
  // Today's features: the gifted resets (EV96) and the disk (EV100).
  if (/\b(cupon|cupones|recarga|recargas|restablecimiento|restablecimientos|limit-reset)\b/.test(t)) return { ...out, intent: 'recargas' }
  // EV112: «¿por qué va lento el PC?», «¿qué está gastando el ordenador?»
  if (/\b(lento|peta|petando|va mal|carga(do)?|procesador|cpu|memoria ram|ventilador)\b/.test(t) && /\b(pc|ordenador|equipo|maquina|procesador|cpu|ram)\b/.test(t)) return { ...out, intent: 'carga' }
  if (/\b(disco|espacio libre|limpieza|cuanto ocupa|ocupan?)\b/.test(t)) return { ...out, intent: 'disco' }
  if (/\b(uso|limites?|cuota|creditos?|gastad[oa]s?|porcentaje|5 horas|cinco horas)\b/.test(t) || (/\bcuanto (le |les )?queda\b/.test(t) && !/\btareas?\b/.test(t) && (Boolean(out.account) || /\bsemana\b/.test(t)))) return { ...out, intent: 'uso' }
  if (/\b(rueda|turno|relevos?|quien (va|sigue|entra|toca) (despues|luego|ahora|ahi)?|quien tiene el turno|siguiente claude|quien le sigue)\b/.test(t)) return { ...out, intent: 'rueda' }
  if (/\b(quien|quienes) (trabaja|trabajan|esta|estan|anda|hay)\b|\bque (esta|estan) haciendo\b|\bque hace\b|\ben que (anda|andan|esta|estan|trabaja|trabajan)\b|\bdonde (esta|estan|anda)\b|\bcomo (va|van|esta|estan) (los )?claude/.test(t) || (out.account && /^(y |que tal )?claude ?\d+$/.test(t))) return { ...out, intent: 'quien' }
  if (out.taskId || /\b(tareas?|agenda|falta|faltan|queda por hacer|que queda|pendientes|cuanto queda)\b/.test(t)) return { ...out, intent: 'tareas' }
  if (out.range && out.account) return { ...out, intent: 'hizo' }
  if (out.account) return { ...out, intent: 'quien' }
  if (asks) return { ...out, intent: 'nose' }
  // A sentence that is not a question is something to pass on («el botón de pausa no va»).
  return { ...out, intent: t.split(' ').length >= 3 ? 'pedido' : 'nose' }
}

/** The project the words name: its whole name, or a long word of it no other project has. */
export function projectNamed(t: string, projects: { id: string; name: string }[]): string | undefined {
  const whole = projects.find((p) => t.includes(norm(p.name)))
  if (whole) return whole.id
  const generic = new Set(['control', 'proyecto', 'juego', 'mision'])
  const said = new Set(t.split(' '))
  const hits = projects.filter((p) => norm(p.name).split(' ').some((w) => w.length >= 5 && !generic.has(w) && said.has(w)))
  return hits.length === 1 ? hits[0].id : undefined
}

const TOPIC_DROP = new Set(['fotos', 'foto', 'imagenes', 'imagen', 'capturas', 'captura', 'videos', 'video', 'renders', 'render', 'modelos', '3d', 'galeria', 'pantallazos', 'pantallazo',
  'ensename', 'muestrame', 'ensena', 'muestra', 'ver', 'quiero', 'dame', 'pasame', 'pon', 'ponme', 'busca', 'buscame', 'de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'un', 'una', 'unas', 'unos',
  'me', 'mi', 'mis', 'todas', 'todos', 'ultimas', 'ultimos', 'ultima', 'nuevas', 'nuevos', 'hay', 'que', 'tienes', 'sobre', 'y', 'o', 'a', 'al', 'por', 'favor', 'hoy', 'ayer', 'anoche', 'mas', 'recientes', 'se', 'ha', 'han', 'hecho'])

function topicOf(t: string, projects: { name: string }[]): string {
  const names = new Set(projects.flatMap((p) => norm(p.name).split(' ')))
  return t.split(' ').filter((w) => !TOPIC_DROP.has(w) && !names.has(w) && !/^claude$|^\d+$/.test(w)).join(' ')
}

// ---- data the answers are made from (main/assistant.ts fills it) --------------------------------------------------------

export interface AgentInfo {
  id: string
  alias?: string
  /** AgentState: trabajando, esperando, sin-uso, disponible… */
  state: string
  /** «No usar» or «De baja» in Ajustes. */
  out?: 'pausada' | 'baja'
  /** Where it has a window, and whether it works there. */
  windows: { projectId?: string; working: boolean }[]
  /** What it says it is doing (`pmc ahora`). */
  focus?: { text: string; at: number }
  lastAt?: number
  five?: { used: number; resetsAt: number }
  week?: { used: number; resetsAt: number }
  /** When its usage comes back, if it is out. */
  backAt?: number
  minutesLeft?: number
}

const STATE_WORD: Record<string, string> = { trabajando: 'trabajando', esperando: 'esperando una respuesta', 'sin-uso': 'sin uso', bloqueado: 'bloqueada', disponible: 'libre', desconectado: 'sin ventana', apartada: 'apartada', baja: 'de baja' }
const inUse = (a: AgentInfo) => !a.out && a.state !== 'apartada' && a.state !== 'baja'

const CHIPS_START = ['¿Qué me espera?', '¿Quién trabaja?', '¿Cuánto uso queda?', '¿Qué hicieron anoche?', '¿Cómo va la rueda?']

export function answerHelp(): Reply {
  return {
    intent: 'ayuda',
    text: t('Pregúntame lo que quieras de tus proyectos y te contesto con lo que ya sabe la app, sin gastar uso. Si me pides algo («haz…», «arregla…», «que Claude 3 mire…»), se lo paso al Claude que tenga el turno en ese proyecto y te digo cuándo lo verá.'),
    rows: [
      { title: t('¿Qué me espera?'), sub: t('Preguntas para decidir, cosas para revisar, en todos los proyectos'), color: 'var(--red)' },
      { title: t('¿Quién trabaja? · ¿Qué hace Claude 3?'), sub: t('Dónde está cada Claude y en qué anda'), color: 'var(--green)' },
      { title: t('¿Cuánto uso queda?'), sub: t('La semana y las 5 horas de cada cuenta, y cuándo vuelve'), color: 'var(--blue)' },
      { title: t('Fotos del glaciar'), sub: t('Busca en la galería de cualquier proyecto'), color: 'var(--pink)' },
      { title: t('¿Qué hizo Claude 3 anoche?'), sub: t('Tareas terminadas, commits, relevos y límites'), color: 'var(--indigo)' },
      { title: t('¿Cómo va la rueda? · ¿Qué queda en mi proyecto? · ¿En qué va EV85?'), sub: t('Turnos, tareas y agenda'), color: 'var(--orange)' }
    ],
    chips: CHIPS_START
  }
}

// ---- what waits for the user ----------------------------------------------------------------------------------------

export interface WaitingProject {
  id: string
  name: string
  decisions: { id: number; title: string; askedBy?: string; at: number; taskExtId?: string }[]
  review: { id: number; extId?: string; title: string }[]
  comments: number
  /** Done this week without proof (EV65). */
  unchecked?: number
}

export function answerWaiting(projects: WaitingProject[], hooksMissing: string[], now: number): Reply {
  const dec = projects.reduce((n, p) => n + p.decisions.length, 0)
  const rev = projects.reduce((n, p) => n + p.review.length, 0)
  const com = projects.reduce((n, p) => n + p.comments, 0)
  const rows: ReplyRow[] = []
  for (const p of projects) for (const d of p.decisions.slice(0, 4)) {
    rows.push({ title: d.title, sub: `Pregunta${d.askedBy ? ' de ' + who(d.askedBy) : ''} · ${p.name} · ${agoText(d.at, now)}`, account: d.askedBy, color: 'var(--red)', go: { route: 'decisiones', projectId: p.id, focus: { kind: 'decision', id: d.id } } })
  }
  for (const p of projects) for (const t of p.review.slice(0, 3)) {
    rows.push({ title: `${t.extId ? t.extId + ' · ' : ''}${t.title}`, sub: `Terminada, para que la mires · ${p.name}`, color: 'var(--orange)', go: { route: 'tareas', projectId: p.id, focus: { kind: 'task', id: t.id } } })
  }
  for (const p of projects) if (p.comments) rows.push({ title: t('{comments} {v0} sobre tus notas', { comments: p.comments, v0: p.comments === 1 ? 'corrección hecha' : 'correcciones hechas' }), sub: t('En Revisar · {name}', { name: p.name }), color: 'var(--yellow)', go: { route: 'revisiones', projectId: p.id } })
  for (const id of hooksMissing) rows.push({ title: t('{v0} no tiene los ganchos de la app', { v0: who(id) }), sub: t('Solo lo puedes arreglar tú: un clic en Inicio'), account: id, go: { route: 'inicio' } })
  const parts: string[] = []
  const where = (pick: (p: WaitingProject) => number) => { const ps = projects.filter((p) => pick(p) > 0).map((p) => p.name); return ps.length ? ` (${ps.join(', ')})` : '' }
  if (dec) parts.push(`${dec} ${dec === 1 ? 'pregunta' : 'preguntas'} en Decidir${where((p) => p.decisions.length)}`)
  if (rev) parts.push(`${rev} ${rev === 1 ? 'tarea terminada' : 'tareas terminadas'} para revisar${where((p) => p.review.length)}`)
  if (com) parts.push(`${com} ${com === 1 ? 'corrección' : 'correcciones'} en Revisar`)
  if (hooksMissing.length) parts.push(`${hooksMissing.length === 1 ? 'una cosa' : hooksMissing.length + ' cosas'} que solo puedes pulsar tú`)
  const unchecked = projects.reduce((n, p) => n + (p.unchecked ?? 0), 0)
  const total = dec + rev + com + hooksMissing.length
  const text = total
    ? `Te ${total === 1 ? 'espera' : 'esperan'} ${list(parts)}.${dec ? ' Lo primero, las preguntas: hay Claude esperando tu respuesta.' : ''}`
    : `Nada te espera ahora: ninguna pregunta, nada para revisar.${unchecked ? ` Hay ${unchecked} ${unchecked === 1 ? 'tarea hecha' : 'tareas hechas'} esta semana sin comprobar: en Tareas salen en amarillo.` : ' Todo en marcha.'}`
  return { intent: 'espera', text, rows: rows.slice(0, 10), more: dec ? { label: t('Abrir Decidir'), go: { route: 'decisiones', projectId: projects.find((p) => p.decisions.length)?.id } } : undefined, chips: ['¿Quién trabaja?', '¿Qué hicieron anoche?'] }
}

/** «a, b y c». */
export function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

// ---- who works --------------------------------------------------------------------------------------------------------

export function answerWho(agents: AgentInfo[], projects: { id: string; name: string }[], account: string | undefined, now: number): Reply {
  const pname = (id?: string) => projects.find((p) => p.id === id)?.name ?? id ?? ''
  const where = (a: AgentInfo) => { const w = a.windows.find((x) => x.working) ?? a.windows[0]; return w?.projectId ? pname(w.projectId) : undefined }
  const line = (a: AgentInfo): ReplyRow => {
    const w = where(a)
    const back = a.state === 'sin-uso' && a.backAt ? `, vuelve ${whenText(a.backAt, now)}` : ''
    const doing = a.focus && now - a.focus.at < 6 * 3600_000 ? `«${a.focus.text}»` : undefined
    return {
      title: `${who(a.id)} · ${STATE_WORD[a.state] ?? a.state}${w ? ` en ${w}` : ''}${back}`,
      sub: doing ? `${doing} · ${agoText(a.focus!.at, now)}` : a.lastAt ? t('Lo último que hizo, {v0}', { v0: agoText(a.lastAt, now) }) : undefined,
      account: a.id,
      go: { agent: a.id }
    }
  }
  const use = agents.filter(inUse)
  if (account) {
    const a = agents.find((x) => x.id === account)
    if (!a) return { intent: 'quien', text: t('No conozco a {v0}.', { v0: who(account) }), chips: ['¿Quién trabaja?'] }
    if (!inUse(a)) return { intent: 'quien', text: t('{v0} está {v1}: no trabaja ni se le deja trabajo.', { v0: who(a.id), v1: a.out === 'baja' || a.state === 'baja' ? 'de baja' : 'apartada («No usar»)' }), chips: ['¿Quién trabaja?'] }
    const r = line(a)
    const usage = usageLine(a, now)
    return { intent: 'quien', text: `${r.title}.${r.sub ? ` ${r.sub}.` : ''}${usage ? ` ${usage}.` : ''}`, rows: [r], chips: [`¿Qué hizo ${who(a.id)} hoy?`, '¿Cuánto uso queda?'] }
  }
  const working = use.filter((a) => a.state === 'trabajando')
  const out = use.filter((a) => a.state === 'sin-uso')
  const parts: string[] = []
  if (working.length) parts.push(`${working.length === 1 ? 'Trabaja' : 'Trabajan'} ${list(working.map((a) => `${who(a.id)}${where(a) ? ' en ' + where(a) : ''}`))}`)
  else parts.push('Ahora no trabaja ningún Claude')
  if (out.length) parts.push(`${list(out.map((a) => `${who(a.id)}${a.backAt ? ' vuelve ' + whenText(a.backAt, now) : ''}`))} (sin uso)`)
  const free = use.filter((a) => a.state !== 'trabajando' && a.state !== 'sin-uso')
  if (free.length) parts.push(`${list(free.map((a) => who(a.id)))} ${free.length === 1 ? 'está' : 'están'} sin trabajar`)
  return { intent: 'quien', text: parts.join('; ') + '.', rows: [...working, ...free, ...out].map(line), chips: working[0] ? [`¿Qué ha hecho ${who(working[0].id)} hoy?`, '¿Cuánto uso queda?'] : ['¿Cuánto uso queda?', '¿Cómo va la rueda?'] }
}

// ---- usage ------------------------------------------------------------------------------------------------------------

function left(w: { used: number; resetsAt: number } | undefined, now: number): number | undefined {
  if (!w) return undefined
  return w.resetsAt <= now ? 100 : Math.max(0, Math.round(100 - w.used))
}

function usageLine(a: AgentInfo, now: number): string {
  if (a.state === 'sin-uso') return t('Sin uso{v0}', { v0: a.backAt ? `; vuelve ${whenText(a.backAt, now)}` : '' })
  const wk = left(a.week, now)
  const fv = left(a.five, now)
  const bits: string[] = []
  if (wk != null) bits.push(`le queda el ${wk} % de la semana`)
  if (fv != null) bits.push(`el ${fv} % de sus 5 horas${a.minutesLeft != null && a.minutesLeft < 120 ? ` (a este ritmo, unos ${a.minutesLeft} min)` : ''}`)
  return bits.length ? bits.join(' y ').replace(/^l/, 'L') : t('Sin lecturas de uso todavía')
}

export function answerUsage(agents: AgentInfo[], account: string | undefined, now: number): Reply {
  const use = agents.filter(inUse).filter((a) => !account || a.id === account)
  if (!use.length) return { intent: 'uso', text: account ? t('{v0} no está en uso (apartada o de baja).', { v0: who(account) }) : t('No hay cuentas en uso.') }
  const rows: ReplyRow[] = use.map((a) => {
    const wk = left(a.week, now)
    return { title: `${who(a.id)}${a.alias ? ' · ' + a.alias : ''}`, sub: usageLine(a, now), account: a.id, meter: a.state === 'sin-uso' ? { pct: 0, label: t('sin uso') } : wk != null ? { pct: wk, label: t('{wk} % de la semana', { wk: wk }) } : undefined, go: { agent: a.id } }
  })
  if (account) return { intent: 'uso', text: `${who(account)}: ${usageLine(use[0], now).replace(/^L/, 'l')}.`, rows, chips: ['¿Cuánto uso queda?', `¿Qué hace ${who(account)}?`] }
  const withWeek = use.filter((a) => a.state !== 'sin-uso' && left(a.week, now) != null)
  const best = [...withWeek].sort((a, b) => (left(b.week, now) ?? 0) - (left(a.week, now) ?? 0))[0]
  const out = use.filter((a) => a.state === 'sin-uso')
  const parts: string[] = []
  if (best) parts.push(`La que más semana tiene es ${who(best.id)} (${left(best.week, now)} %)`)
  if (out.length) parts.push(`sin uso: ${list(out.map((a) => `${who(a.id)}${a.backAt ? ' (vuelve ' + whenText(a.backAt, now) + ')' : ''}`))}`)
  const low = withWeek.filter((a) => (left(a.week, now) ?? 100) <= 10)
  if (low.length) parts.push(`casi sin semana: ${list(low.map((a) => who(a.id)))}`)
  return { intent: 'uso', text: (parts.join('; ') || 'Aún no hay lecturas de uso') + '.', rows, chips: ['¿Cómo va la rueda?', '¿Quién trabaja?'] }
}

// ---- photos -----------------------------------------------------------------------------------------------------------

export function answerPhotos(topic: string, found: { id: number; name: string; projectId: string; projectName: string }[], total: number, projectId?: string): Reply {
  const what = topic ? `con «${topic}»` : 'nuevas'
  if (!found.length) {
    return { intent: 'fotos', text: topic ? t('No encuentro imágenes con «{topic}» en la galería. Prueba con otra palabra (el nombre de la carpeta o del archivo).', { topic: topic }) : t('La galería está vacía.'), more: { label: t('Abrir la Galería'), go: { route: 'galeria', projectId } }, chips: ['Fotos de hoy'] }
  }
  const projects = [...new Set(found.map((f) => f.projectName))]
  const text = topic
    ? `${total === 1 ? 'Hay 1 imagen' : `Hay ${total} imágenes`} ${what}${projects.length === 1 ? ` en ${projects[0]}` : ''}${total > found.length ? `; aquí tienes las ${found.length} más nuevas` : ''}. Toca una para verla en grande.`
    : `Las ${found.length} imágenes más nuevas${projects.length === 1 ? ` de ${projects[0]}` : ''}. Toca una para verla en grande.`
  const first = found[0]
  return { intent: 'fotos', text, photos: found.map(({ id, name, projectId }) => ({ id, name, projectId })), more: { label: t('Ver todas en la Galería'), go: { route: 'galeria', projectId: first.projectId, focus: topic ? { kind: 'asset', id: -1, q: topic } : undefined } } }
}

// ---- what happened -----------------------------------------------------------------------------------------------------

export interface DidEvent { at: number; account?: string; kind: string; title: string; projectId?: string; ref?: string; detail?: string }

export function answerDid(input: { account?: string; range: Range; events: DidEvent[]; claims: { ref: string; account: string; at: number }[]; projects: { id: string; name: string }[]; now: number; titles?: Record<string, string> }): Reply {
  const { account, range, now } = input
  const pname = (id?: string) => input.projects.find((p) => p.id === id)?.name ?? id ?? ''
  const num = account?.slice(6)
  // A finished task belongs to whoever last reserved it before it was marked (the event itself has no account).
  const ownerOf = (ref: string | undefined, at: number) => input.claims.filter((c) => c.ref === ref && c.at <= at).sort((a, b) => b.at - a.at)[0]?.account
  const mentions = (s: string) => Boolean(num) && new RegExp(`\\bclaude ?${num}\\b`, 'i').test(s)
  const mine = (e: DidEvent) => !account || e.account === account || ((e.kind === 'commit' || e.kind === 'relevo') && !e.account && mentions(e.title)) || ((e.kind === 'tarea-hecha' || e.kind === 'tarea-hecha-fecha') && (e.account ?? ownerOf(e.ref, e.at)) === account)
  const evs = input.events.filter((e) => e.at >= range.from && e.at <= range.to && mine(e)).sort((a, b) => b.at - a.at)
  const span = `${range.label} (de las ${hhmm(range.from)} a las ${hhmm(range.to)})`
  const subject = account ? who(account) : 'los Claude'
  if (!evs.length) return { intent: 'hizo', text: t('No veo nada de {subject} {span}.', { subject: subject, span: span }), chips: account ? [`¿Qué hace ${who(account)}?`, `¿Qué hizo ${who(account)} hoy?`] : ['¿Quién trabaja?'] }
  const by = (k: string[]) => evs.filter((e) => k.includes(e.kind))
  const done = by(['tarea-hecha', 'tarea-hecha-fecha'])
  const commits = by(['commit'])
  const beats = by(['relevo'])
  const limits = by(['limite'])
  const asked = by(['decision'])
  const files = new Set(by(['archivo']).map((e) => e.detail ?? e.title).filter((f) => !/\\Temp\\|\/tmp\/|scratchpad/i.test(f)))
  const where = [...new Set(evs.filter((e) => e.projectId && ['archivo', 'sesion', 'commit', 'tarea-hecha', 'relevo', 'reserva'].includes(e.kind)).map((e) => pname(e.projectId)))]
  const parts: string[] = []
  if (done.length) parts.push(`terminó ${done.length} ${done.length === 1 ? 'tarea' : 'tareas'} (${done.slice(0, 4).map((e) => e.title.split(' · ')[0]).join(', ')}${done.length > 4 ? '…' : ''})`)
  if (commits.length) parts.push(`${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}`)
  if (files.size) parts.push(`tocó ${files.size} ${files.size === 1 ? 'archivo' : 'archivos'}`)
  if (asked.length) parts.push(`te hizo ${asked.length} ${asked.length === 1 ? 'pregunta' : 'preguntas'}`)
  const verb = account ? '' : ' entre todos'
  let text = `${cap(span)}, ${subject}${where.length ? ` ${account ? 'trabajó' : 'trabajaron'} en ${list(where)}` : ''}${parts.length ? `${where.length ? ':' : ''} ${list(parts)}${verb}` : ''}.`
  if (limits.length) text += ` ${account ? 'Se quedó' : list([...new Set(limits.map((e) => (e.account ? who(e.account) : '')).filter(Boolean))]) + (limits.length > 1 ? ' se quedaron' : ' se quedó')} sin uso a las ${hhmm(limits[0].at)}.`
  if (!parts.length && !where.length) text = `${cap(span)}, de ${subject} solo veo: ${evs[0].title}.`
  const rows: ReplyRow[] = []
  // The task's title now, not the one in the event (13-11: events kept a note as title, «EV89 · Casi hecho (13-11…»).
  const titleOf = (e: DidEvent) => { const id = e.title.split(' · ')[0]; const current = input.titles?.[`${e.projectId}:${id}`]; return current ? `${id} · ${current}` : e.title.replace(/: marcada como hecha$/, '') }
  for (const e of done.slice(0, 5)) rows.push({ title: titleOf(e), sub: t('Terminada a las {v0} · {v1}', { v0: hhmm(e.at), v1: pname(e.projectId) }), color: 'var(--green)', account: account ?? ownerOf(e.ref, e.at), go: { route: 'tareas', projectId: e.projectId, focus: { kind: 'task', id: -1, q: e.title.split(' · ')[0] } } })
  for (const e of beats.slice(0, 2)) rows.push({ title: e.title, sub: t('Su relevo a las {v0} · {v1}', { v0: hhmm(e.at), v1: pname(e.projectId) }), account: e.account, color: 'var(--indigo)', go: { route: 'cronologia', projectId: e.projectId } })
  for (const e of commits.slice(0, 4)) rows.push({ title: e.title, sub: t('Commit a las {v0}{v1}', { v0: hhmm(e.at), v1: e.projectId ? ' · ' + pname(e.projectId) : '' }), color: 'var(--gray)', go: { route: 'cronologia', projectId: e.projectId } })
  for (const e of asked.slice(0, 2)) rows.push({ title: e.title, sub: t('A las {v0} · {v1}', { v0: hhmm(e.at), v1: pname(e.projectId) }), account: e.account, color: 'var(--red)', go: { route: 'decisiones', projectId: e.projectId } })
  for (const e of limits.slice(0, 2)) rows.push({ title: e.title, sub: t('A las {v0}', { v0: hhmm(e.at) }), account: e.account, color: 'var(--orange)' })
  return { intent: 'hizo', text, rows: rows.slice(0, 10), more: { label: t('Verlo todo en la Cronología'), go: { route: 'cronologia', projectId: evs.find((e) => e.projectId)?.projectId } }, chips: account ? [`¿Qué hace ${who(account)} ahora?`, '¿Qué me espera?'] : ['¿Qué me espera?', '¿Quién trabaja?'] }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---- tasks ------------------------------------------------------------------------------------------------------------

export interface TaskInfo { id: number; extId?: string; title: string; detail?: string; status: string; mark?: string; section?: string; priority?: number; projectId: string; checked?: boolean }

const STATUS_WORD: Record<string, string> = { idea: 'idea', pendiente: 'pendiente', planificada: 'planificada', 'en-desarrollo': 'a medias', bloqueada: 'bloqueada', 'pendiente-integracion': 'por integrar', 'en-pruebas': 'en pruebas', revision: 'para revisar', terminada: 'terminada' }
export const isOpen = (t: Pick<TaskInfo, 'status'>) => t.status !== 'terminada' && t.status !== 'idea'

export function answerTasks(input: { taskId?: string; project: { id: string; name: string }; tasks: TaskInfo[]; allTasks?: TaskInfo[]; projects: { id: string; name: string }[]; claims: { key: string; account: string }[]; agenda?: string }): Reply {
  const pname = (id: string) => input.projects.find((p) => p.id === id)?.name ?? id
  if (input.taskId) {
    const t = (input.allTasks ?? input.tasks).find((x) => x.extId?.toUpperCase() === input.taskId)
    if (!t) return { intent: 'tareas', text: `No encuentro la tarea ${input.taskId} en ningún proyecto.`, chips: ['¿Qué queda?'] }
    const holder = input.claims.find((c) => c.key === t.extId)?.account
    const state = t.status === 'terminada' ? (t.checked ? 'terminada y comprobada' : 'terminada, sin comprobar') : STATUS_WORD[t.status] ?? t.status
    const detail = (t.detail ?? '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim()
    return {
      intent: 'tareas',
      text: `${t.extId} · ${t.title} (${pname(t.projectId)}): ${state}${holder ? `; la lleva ${who(holder)}` : ''}.${detail ? ` ${detail.slice(0, 260)}${detail.length > 260 ? '…' : ''}` : ''}`,
      rows: [{ title: `${t.extId} · ${t.title}`, sub: `${cap(state)} · ${pname(t.projectId)}`, account: holder, color: t.status === 'terminada' ? 'var(--green)' : 'var(--orange)', go: { route: 'tareas', projectId: t.projectId, focus: { kind: 'task', id: t.id } } }]
    }
  }
  const open = input.tasks.filter(isOpen)
  const half = open.filter((t) => t.mark === '~' || t.status === 'en-desarrollo')
  const agenda = input.agenda ? open.filter((t) => (t.section ?? '').toLowerCase().includes(input.agenda!.toLowerCase())) : []
  const pick = (agenda.length ? agenda : open).slice().sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))
  const owner = (t: TaskInfo) => input.claims.find((c) => c.key === t.extId)?.account
  const text = open.length
    ? `En ${input.project.name} ${open.length === 1 ? 'queda 1 tarea abierta' : `quedan ${open.length} tareas abiertas`}${half.length ? ` (${half.length} a medias)` : ''}.${agenda.length ? ` De la agenda de la rueda («${input.agenda}») quedan ${agenda.length}; las siguientes:` : ' Las siguientes:'}`
    : `En ${input.project.name} no queda ninguna tarea abierta.`
  return {
    intent: 'tareas', text,
    rows: pick.slice(0, 6).map((t) => ({ title: `${t.extId ? t.extId + ' · ' : ''}${t.title}`, sub: `${cap(STATUS_WORD[t.status] ?? t.status)}${owner(t) ? ' · la lleva ' + who(owner(t)!) : ''}`, account: owner(t), color: t.mark === '~' ? 'var(--orange)' : 'var(--blue)', go: { route: 'tareas', projectId: t.projectId, focus: { kind: 'task', id: t.id } } })),
    more: { label: t('Abrir Tareas'), go: { route: 'tareas', projectId: input.project.id } },
    chips: ['¿Quién trabaja?', '¿Cómo va la rueda?']
  }
}

// ---- the wheel --------------------------------------------------------------------------------------------------------

export function answerWheel(project: { id: string; name: string }, chain: RelayChain | undefined, members: ChainMember[], now: number): Reply {
  if (!chain?.on || !chain.order.length) {
    return { intent: 'rueda', text: t('En {name} la rueda de relevos está apagada: cada Claude trabaja cuando lo abres tú. Se enciende en Relevos.', { name: project.name }), more: { label: t('Abrir Relevos'), go: { route: 'relevos', projectId: project.id } }, chips: ['¿Quién trabaja?'] }
  }
  const holder = chain.holder
  const m = members.find((x) => x.id === holder)
  const nxt = nextInLine(chain, members, now)
  const parts = [`En ${project.name} la rueda va ${chain.order.map(who).join(' → ')}`]
  if (holder) parts.push(`${chain.phase === 'espera' ? 'el turno espera a' : 'tiene el turno'} ${who(holder)}${chain.since ? ` desde ${whenText(chain.since, now)}` : ''}${m?.workingHere ? ' y está trabajando' : m?.state === 'sin-uso' ? ' (sin uso)' : ''}`)
  if (chain.outgoing) parts.push(`${who(chain.outgoing)} termina lo pequeño antes de agotarse`)
  if (nxt) parts.push(`después irá ${who(nxt.id)}${nxt.at ? ` (${whenText(nxt.at, now)})` : ''}`)
  const views = memberViews(chain, members, now)
  const color: Record<string, string> = { turno: 'var(--green)', lista: 'var(--blue)', 'sin-uso': 'var(--orange)', pausa: 'var(--gray)', fuera: 'var(--gray)', ocupada: 'var(--indigo)' }
  return {
    intent: 'rueda',
    text: parts.join('; ') + `.${chain.until?.section ? ` Trabaja en la agenda «${chain.until.section}».` : ''}`,
    rows: views.map((v) => ({ title: who(v.id), sub: v.text, account: v.id, color: color[v.status], go: { agent: v.id } })),
    more: { label: t('Abrir Relevos'), go: { route: 'relevos', projectId: project.id } },
    chips: ['¿Cuánto uso queda?', `¿Qué queda en ${project.name}?`]
  }
}

// ---- requests ---------------------------------------------------------------------------------------------------------

export interface RequestInput {
  text: string
  /** From core/review.ts › guessKind. */
  kind: string
  project: { id: string; name: string }
  /** Why it goes to that project when it is not the one on screen. */
  projectWhy?: string
  /** The account the words name. */
  named?: string
  /** Who holds the wheel's turn there (wheel on). */
  holder?: string
  /** core/route.ts › pickAccount: who would do it otherwise. */
  pick?: { id: string; why: string }
  agents: AgentInfo[]
  now: number
}

export function planRequest(i: RequestInput): Reply {
  const { project, now } = i
  const body = i.text.trim()
  if (i.kind === 'nota' || i.kind === 'idea') {
    const send: SendPlan = { projectId: project.id, project: project.name, body, kind: i.kind, who: 'nadie', when: i.kind === 'idea' ? 'Se guarda en Tareas › Ideas, para decidir después' : 'Solo para ti: no se envía', start: false }
    return { intent: 'pedido', text: i.kind === 'idea' ? t('Parece una idea: la guardo en {name} › Tareas › Ideas, sin mandársela a nadie.', { name: project.name }) : t('Lo guardo como nota tuya, sin mandárselo a nadie.'), send }
  }
  const kind: SendPlan['kind'] = i.kind === 'correccion' || i.kind === 'prioridad' ? i.kind : 'mensaje'
  const byId = (id?: string) => i.agents.find((a) => a.id === id)
  let target = i.named ?? i.holder ?? i.pick?.id
  let a = byId(target)
  const reason = i.named ? 'lo has nombrado' : i.holder ? `tiene el turno en ${project.name}` : i.pick?.why
  // One that cannot take it is not the one to wait for: it is left to the first that works there.
  if (a && !inUse(a)) { target = undefined; a = undefined }
  const workingHere = a?.windows.some((w) => w.projectId === project.id && w.working)
  const windowHere = a?.windows.some((w) => w.projectId === project.id)
  const elsewhere = a?.windows.find((w) => w.working && w.projectId && w.projectId !== project.id)?.projectId
  let when: string
  let start = false
  if (!a) when = `Lo verá el primer Claude que trabaje en ${project.name}, en cuanto empiece.`
  else if (a.state === 'sin-uso') {
    when = `${who(a.id)} está sin uso${a.backAt ? ` hasta ${whenText(a.backAt, now).replace(/^a las/, 'las')}` : ''}: lo verá el primer Claude que trabaje en ${project.name}.`
    target = undefined
  } else if (workingHere) when = `${who(a.id)} está trabajando en ${project.name}: lo verá en su próximo paso, en uno o dos minutos.`
  else if (elsewhere) when = `${who(a.id)} está trabajando en otro proyecto: lo verá cuando vuelva a ${project.name}.`
  else if (windowHere) { when = `${who(a.id)} tiene su ventana abierta en ${project.name} sin trabajar: se lo escribo ahí y empieza ya.`; start = true }
  else { when = `${who(a.id)} está libre: se abre su ventana en ${project.name} y empieza por esto.`; start = true }
  const whoText = target ? who(target) : `el primer Claude que trabaje en ${project.name}`
  const why = i.projectWhy ? ` (va a ${project.name} porque ${i.projectWhy})` : ''
  const text = target
    ? `${kind === 'correccion' ? 'Lo apunto como corrección y se lo paso' : kind === 'prioridad' ? 'Se lo paso como prioridad (va antes que lo suyo)' : 'Se lo paso'} a ${whoText}${reason ? `, que ${reason.replace(/^lo has nombrado$/, 'es a quien nombras')}` : ''}${why}. ${when}`
    : `Lo apunto ${kind === 'correccion' ? 'como corrección ' : kind === 'prioridad' ? 'como prioridad ' : ''}en ${project.name}${why}. ${when}`
  return { intent: 'pedido', text, send: { projectId: project.id, project: project.name, target, body, kind, who: whoText, when, start } }
}

/** What to say once it is sent, from what the dispatcher did (startOn). */
export function sentText(plan: SendPlan, started?: { action: string; why: string }): string {
  if (plan.kind === 'idea') return t('Guardada en {project} › Tareas › Ideas.', { project: plan.project })
  if (plan.kind === 'nota') return 'Guardada como nota tuya.'
  if (!started) return t('Hecho: se lo he pasado a {who}. {when}', { who: plan.who, when: plan.when })
  if (started.action === 'abrir') return t('Hecho: {who} se abre en {project} y empieza por esto.', { who: plan.who, project: plan.project })
  if (started.action === 'avisar') return t('Hecho: se lo he escrito a {who} en su ventana.', { who: plan.who })
  return t('Guardado para {who}; no se abre ninguna ventana: {why}. Lo verá en cuanto trabaje en {project}.', { who: plan.who, why: started.why, project: plan.project })
}

export function answerUnknown(): Reply {
  return {
    intent: 'nose',
    text: t('Eso no lo sé contestar con lo que sabe la app. Puedo preguntárselo a un Claude (gasta un poco de uso) o, si es un encargo, dímelo como tal («haz…», «arregla…») y se lo paso al que tenga el turno.'),
    offerClaude: true,
    chips: CHIPS_START.slice(0, 3)
  }
}

/** One answer as plain lines, for «Pregúntale a Claude»: what the app knows, given to the model as its only source. */
export function replyAsText(r: Reply): string {
  return [r.text, ...(r.rows ?? []).map((x) => `- ${x.title}${x.sub ? ': ' + x.sub : ''}`)].join('\n')
}

