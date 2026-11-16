// Autonomous mode (the user, 12-11: «que tampoco se detengan hasta que el usuario lo cambie»). With it on, a session that
// tries to end its turn while its project still has work for it is told to go on; it only rests when the limit cuts it,
// and then it is scheduled to start again when its usage comes back. The user turns it off in Relevos › Cómo trabajan los Claude, or
// stops one window by telling it «para».
import { existsSync, readFileSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'
import { t } from './i18n'

/** More refusals than this in the window means the session cannot go on (it ends at once each time): let it stop. */
export const MAX_BLOCKS = 4
export const BLOCK_WINDOW_MS = 3 * 60_000

/** The user telling this window to stop: his word goes before the mode. */
export const STOP_WORDS = /(?:^\s*(?:para|parad|parar|stop|detente|det[eé]n|alto|espera|quieto|pausa)|(?:^|[\s,;.])(?:y|luego|despu[eé]s)\s+(?:paras?|parad|detente|stop)\s*(?=[.,;!]|$))(?![\wáéíóúñ])/i

/**
 * «Para» at the start is also the preposition: «para que los claude trabajen…», «para mejorar la app» are instructions to
 * go on, not to stop (12-11: they let a session stop). It is a stop when what follows is not «que», a pronoun or article,
 * or a verb in the infinitive («para un momento», «para ya», «para de trabajar», «para.»).
 */
export function isStopPrompt(prompt: string): boolean {
  return startsWithStop(prompt) || stopAnywhere(prompt)
}

function startsWithStop(prompt: string): boolean {
  if (!STOP_WORDS.test(prompt)) return false
  // MC-STOP: «parar el bot» is a task about something else, not an order to this window.
  if (/^\s*parar\s+(?!ya\b|un\s)[a-záéíóúñ]/i.test(prompt)) return false
  const m = prompt.match(/^\s*para\s+([a-záéíóúñ]+)/i)
  if (!m) return true
  const next = m[1].toLowerCase()
  if (/^(que|qué|ello|eso|esto|esta|este|estas|estos|los|las|el|la|lo|le|les|mi|mis|tu|tus|su|sus|todo|toda|todos|todas|cada|cuando|como|cómo|no|nada|mí|ti|nosotros|vosotros|ellos|ellas)$/.test(next)) return false
  if (/(ar|er|ir|arlo|erlo|irlo|arla|erla|irla|arlos|arlas|arse|erse|irse)$/.test(next) && next !== 'parar') return false
  return true
}

/** Lower case and without accents, so «detén» and «deten», «continúa» and «continua» are the same word. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

/**
 * MC-STOP (the user, 16-11: «cuando yo digo a un claude que pare, y sigue insistiendo en que trabajéis»): the order to
 * stop anywhere in the message, and asked politely, not only as its first word: «¿puedes parar un momento?», «cuando
 * puedas, te detienes en un punto seguro y dejas todo cerrado para poder usar yo el pc». `neg: false` are the ones that
 * already are a negation («no sigas»); the rest do not count after «no», «sin» or «nunca» («no quiero que pares»,
 * «trabaja sin parar»).
 */
const STOP_ANYWHERE: { re: RegExp; neg?: false }[] = [
  { re: /\b(?:para|parad|parar|parate|paraos)\s+(?:un (?:momento|rato|segundo|poco|minuto)|ya\b|aqui\b|ahi\b|por (?:hoy|ahora|el momento)|de (?:trabajar|hacer|programar|currar|tocar)|en (?:un punto|cuanto|el punto))/ },
  { re: /(?:^|[,;:]\s*|\b(?:y|luego|despues|entonces|ya)\s+)(?:para|parad|parar|parate|paraos)\s*(?:[.!?…,;]|$)/ },
  { re: /\b(?:puedes|podrias|podeis|podriais|puede|pueden|quiero que|necesito que|te pido que|os pido que|haz el favor de|por favor,?)\s+(?:te\s+)?(?:parar(?:te)?|pares|pareis|detener(?:te)?|detengas|detengais|descansar|pausar|dejar de trabajar)\b/ },
  { re: /\bque (?:te )?(?:pares|pareis|detengas|detengais)\b/ },
  { re: /\b(?:detente|deteneos|detenerte|te detienes|te detengas|te paras|parate|paraos)\b/ },
  { re: /\b(?:deja|dejad|dejas|deja ya) de (?:trabajar|hacer cosas|programar|currar|tocar (?:nada|cosas))\b/ },
  { re: /\b(?:deja|dejas|dejad|dejalo|dejadlo)\s+(?:lo\s+)?(?:todo\s+)?(?:cerrado|guardado|recogido)\b/ },
  { re: /\b(?:dejalo|dejadlo|lo dejamos|lo dejas) (?:aqui|ahi|por hoy|por ahora)\b/ },
  { re: /\busar yo el (?:pc|ordenador)\b|\b(?:poder|quiero|voy a|necesito|tengo que) usar (?:yo )?el (?:pc|ordenador)\b|\b(?:libera|liberes|deja libre|dejes libre) el (?:pc|ordenador)\b/ },
  { re: /\b(?:descansa|descansad|tomate un descanso|haz una pausa|haced una pausa|ponte en pausa|pausate)\b/ },
  { re: /\bno (?:sigas|sigais|continues|continueis|trabajes mas|hagas nada mas|toques nada mas)\s*(?:[.!?…,;]|$)/, neg: false },
  { re: /\b(?:no hagas nada|no toques nada|espera|esperad|quedate quieto)\b[^.!?]{0,40}\bhasta que (?:te|os) (?:avise|diga)\b/, neg: false },
  { re: /\bya basta\b|\b(?:suficiente|ya esta|ya vale|es todo) por hoy\b/ },
  // English, for the app in English.
  { re: /^\s*(?:stop|pause|hold on)\b/ },
  { re: /\b(?:please|can you|could you|you can|you should|i want you to|i need you to|now)\s+(?:stop|pause|take a break)\b/ },
  { re: /\bstop (?:working|now|here|for now|for today|there|everything)\b|\b(?:and|then)\s+stop\s*(?:[.!?,;]|$)|\btake a break\b/ },
  { re: /\b(?:don'?t|do not) (?:continue|keep going|do anything (?:else|more))\b/, neg: false },
  { re: /\b(?:i (?:want|need) to use|let me use) the (?:pc|computer)\b/ }
]

const NEGATED = /\b(?:no|sin|nunca|jamas|ni|don'?t|do not|never|without)\b[^.,;:!?]{0,24}$/

function stopAnywhere(prompt: string): boolean {
  const s = fold(prompt)
  for (const { re, neg } of STOP_ANYWHERE) {
    const m = re.exec(s)
    if (m && (neg === false || !NEGATED.test(s.slice(Math.max(0, m.index - 30), m.index)))) return true
  }
  return false
}

/** MC-STOP: the user telling a paused window to go on again. */
export function isGoPrompt(prompt: string): boolean {
  const s = fold(prompt)
  const m = /\b(?:sigue|seguid|continua|continuad|continue|reanuda|adelante|go on|keep going|resume|vuelve (?:al trabajo|a trabajar|a lo tuyo)|a trabajar|(?:ya )?puedes seguir)\b/.exec(s)
  return Boolean(m) && !NEGATED.test(s.slice(Math.max(0, m!.index - 30), m!.index))
}

/** What the user's last words do to this window's pause; the texts the app types into windows («Mission Control…») do nothing. */
export function pauseChange(prompt: string | undefined): 'pausa' | 'sigue' | undefined {
  if (!prompt || /^\s*mission control\b/i.test(prompt)) return undefined
  if (isStopPrompt(prompt)) return 'pausa'
  if (isGoPrompt(prompt)) return 'sigue'
  return undefined
}

/**
 * MC-STOP, step 2 (the user, 16-11: «molaría que entienda Mission Control si yo he pedido que un Claude en concreto pare,
 * aunque luego siga en el relevo»): the pause is of that one window (its session), not of autonomous mode. It holds while
 * the user talks to it about other things, until he says «sigue», the Claude runs `pmc sigue`, or the relay wheel gives
 * that account a new turn. Without a session id (an old Claude Code), it is the account's until its next session.
 */
export interface Pause { account: string; sessionId?: string; at: number; why?: string }
export const PAUSE_KEEP_MS = 3 * 86_400_000
const pausesFile = () => join(paths.root(), 'pausas.json')

export function readPauses(file = pausesFile(), now = Date.now()): Pause[] {
  try { return (JSON.parse(readFileSync(file, 'utf8')) as Pause[]).filter((p) => now - p.at < PAUSE_KEEP_MS) } catch { return [] }
}

const samePause = (p: Pause, sessionId: string | undefined, account: string) => (sessionId && p.sessionId ? p.sessionId === sessionId : p.account === account)

/** The pause that holds this window, if any. */
export function pausedFor(list: Pause[], sessionId: string | undefined, account: string): Pause | undefined {
  return list.find((p) => (p.sessionId ? p.sessionId === sessionId : p.account === account))
}

/** Whether any window of this account is paused (the wheel does not call it back to work). */
export function accountPaused(account: string, list = readPauses()): boolean {
  return list.some((p) => p.account === account)
}

export function setPause(p: Pause, file = pausesFile()): void {
  const list = readPauses(file, p.at).filter((x) => !samePause(x, p.sessionId, p.account))
  try { writeFileSync(file, JSON.stringify([...list, p], null, 1)) } catch { /* next time */ }
}

/** Lifts the pause of this window; with `wholeAccount`, every pause of the account (a new turn of the wheel). */
export function clearPause(sessionId: string | undefined, account: string, file = pausesFile(), wholeAccount = false): boolean {
  const list = readPauses(file)
  const left = list.filter((x) => !(wholeAccount ? x.account === account : samePause(x, sessionId, account) || (!x.sessionId && x.account === account)))
  if (left.length === list.length) return false
  try { writeFileSync(file, JSON.stringify(left, null, 1)) } catch { /* next time */ }
  return true
}

export interface StopInput {
  autonomous: boolean
  /** What `pmc next` would offer this account here, shortest form. */
  next: string[]
  /** The last thing the user typed in this window. */
  lastPrompt?: string
  /** When this session was last told to go on. */
  blocks: number[]
  now?: number
  /** The project this session works on (for the message when its queue is empty). */
  project?: string
  /** EV121: other projects with free work for this account, best first; empty for an account kept for one project. */
  elsewhere?: { project: string; root: string; next: string[] }[]
  /** In a wheel's overlap, the one leaving: the turn is another's, it only finishes small things that do not touch hers. */
  outgoing?: boolean
  /** EV126: a Claude said there is nothing left worth improving in this project (pmc terminado), and nothing new came since. */
  done?: boolean
  /** EV126: what the user wants then: rest, or go on in another project with work. */
  whenDone?: WhenDone
  /** MC-STOP: the user paused this window (and has not said «sigue» since). */
  paused?: boolean
}

/**
 * EV126 (the user, 14-11 19:2x: «si claude considera que no tiene más que mejorar, que la app deje de intentar hacer que
 * claude trabaje en modo autónomo, se le de a elegir al usuario si… empiece con otro o deje de trabajar»). A Claude that
 * finds nothing more worth doing in a project says so with `pmc terminado "why"`; it holds until new work comes (a task,
 * a note of the user's) or the user presses «Seguir mejorándolo».
 */
export type WhenDone = 'parar' | 'otro'
export interface DoneMark { at: number; by: string; why: string }
const doneFile = () => join(paths.root(), 'done.json')

export function readDone(): Record<string, DoneMark> {
  try { return JSON.parse(readFileSync(doneFile(), 'utf8')) } catch { return {} }
}

export function markDone(projectId: string, mark: DoneMark): void {
  writeFileSync(doneFile(), JSON.stringify({ ...readDone(), [projectId]: mark }, null, 1))
}

export function clearDone(projectId: string): void {
  const all = readDone()
  if (!all[projectId]) return
  delete all[projectId]
  writeFileSync(doneFile(), JSON.stringify(all, null, 1))
}

/** Still done: marked, and no work came after it (a task or a note made later). */
export function stillDone(mark: DoneMark | undefined, newestWorkAt: number | undefined): boolean {
  return Boolean(mark) && (newestWorkAt == null || newestWorkAt <= mark!.at)
}

/**
 * The one leaving in an overlap was told to go on twice in 15 minutes and wants to stop again: it has nothing small left
 * that does not step on the one holding the turn (13-11: claude1 told five times to go on with a queue that was waiting
 * for real events or was claude6's, while claude6 worked).
 */
export const OUTGOING_BLOCKS = 2
export const OUTGOING_WINDOW_MS = 15 * 60_000

/**
 * What to tell a session that wants to end its turn; undefined: let it.
 * EV121 (the user, 13-11: «que nunca nos quedemos parados»): with an empty queue it is not let stop either: first it thinks
 * what could be better in this project and writes it down as tasks; only if there is nothing to add, it moves to another
 * project with work. The user's «para» and the refusal limit still let it stop.
 */
export function keepGoing(i: StopInput): string | undefined {
  const now = i.now ?? Date.now()
  if (!i.autonomous || i.paused) return undefined
  if (i.lastPrompt && isStopPrompt(i.lastPrompt)) return undefined
  if (i.blocks.filter((at) => now - at < BLOCK_WINDOW_MS).length >= MAX_BLOCKS) return undefined
  if (i.outgoing) {
    if (i.blocks.filter((at) => now - at < OUTGOING_WINDOW_MS).length >= OUTGOING_BLOCKS) return undefined
    return [
      t('Mission Control, rueda de relevos: el turno ya es de otra cuenta y tú estás en el solape.'),
      t('Sigue solo con cosas pequeñas que no toquen sus archivos (documentos, pruebas, arreglos cortos) y guarda con pmc guarda.'),
      t('Lo tuyo: {list}.', { list: i.next.slice(0, 3).join('; ') || t('nada en tu cola') }),
      t('Si no te queda nada pequeño que no la pise, dilo en una línea en el relevo y termina.')
    ].join(' ')
  }
  if (!i.next.length) {
    const here = i.project ? t('en {project}', { project: i.project }) : t('en este proyecto')
    const other = i.elsewhere?.[0]
    // EV126: given up here as finished: it rests, or (the user's choice) goes where there is work.
    if (i.done) {
      if (i.whenDone !== 'otro' || !other) return undefined
      return [
        t('Mission Control, modo autónomo: {here} ya está dado por terminado y el usuario quiere que, entonces, sigas en otro proyecto.', { here }),
        t('Pasa a {project} ({root}), donde te espera {list}; trabaja allí con rutas absolutas y las órdenes pmc desde su carpeta.', { project: other.project, root: other.root, list: other.next.slice(0, 3).join('; ') })
      ].join(' ')
    }
    return [
      t('Mission Control, modo autónomo: no te quedan tareas {here}, pero el usuario no quiere que nadie se quede parado.', { here }),
      t('Primero piensa qué se puede mejorar {here} (lo que falla, lo que falta, lo que el usuario pidió y no está, pruebas, rendimiento, lo que se ve) y apúntalo en docs/TASKS.md como tareas nuevas, cada una con «se da por buena cuando…»; reserva la primera (pmc claim) y empiézala ya.', { here }),
      t('Si de verdad no queda nada que merezca la pena mejorar {here}, dilo con pmc terminado "por qué" y termina: Mission Control se lo enseña al usuario y deja de pedirte que sigas aquí.', { here }),
      other
        ? t('Solo si de verdad no hay nada que añadir, pasa a otro proyecto: {project} ({root}), donde te espera {list}; trabaja allí con rutas absolutas y las órdenes pmc desde su carpeta.', { project: other.project, root: other.root, list: other.next.slice(0, 3).join('; ') })
        : t('Solo si de verdad no hay nada que añadir ni otro proyecto con trabajo para ti, dilo en una línea en el relevo.')
    ].join(' ')
  }
  return [
    t('Mission Control, modo autónomo: no termines el turno. El usuario quiere que trabajes sin parar hasta que el límite de uso te corte (entonces Mission Control te vuelve a abrir cuando se restablezca) o hasta que él quite el modo autónomo.'),
    t('No resumas ni preguntes si sigues: guarda lo hecho (commit), pon al día el relevo y empieza ya la siguiente tarea.'),
    t('Lo siguiente en tu cola: {list}.', { list: i.next.slice(0, 4).join('; ') }),
    t('Si necesitas una decisión del usuario, pídela con pmc decide y sigue con otra tarea. Si de verdad no puedes avanzar en nada, dilo en una línea en el relevo.')
  ].join(' ')
}

const blocksFile = (sessionId: string) => join(paths.usageDir(), `keepgoing-${sessionId.replace(/[^\w-]/g, '')}.json`)

export function readBlocks(sessionId: string): number[] {
  try { const f = blocksFile(sessionId); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [] } catch { return [] }
}

export function noteBlock(sessionId: string, blocks: number[], now = Date.now()): void {
  try { writeFileSync(blocksFile(sessionId), JSON.stringify([...blocks.filter((at) => now - at < BLOCK_WINDOW_MS), now])) } catch { /* next time */ }
}

/**
 * EV146: autonomous mode («work until the limit cuts you») is for plans with limits. An account paying per use (a key,
 * Console, a cloud) has no limit to cut it: it would spend until its credit ran out. It stops when its turn is done.
 */
export function autonomyFor(plan: { paysPerUse?: boolean } | undefined): boolean {
  return !plan?.paysPerUse
}

/** How much of the end of the transcript is read, growing only when the prompt is not in the smaller piece. */
const PROMPT_TAILS = [400_000, 4_000_000]

/**
 * The last prompt the user typed, from the end of the transcript (tool results and command output are not his words).
 * Claude Code also writes a short `last-prompt` row (its first 200 characters, enough to see «para») after each prompt and
 * at the end of each turn: with it, the prompt is found even when big rows follow it (EV141, 14-11: a background
 * session's first turn wrote 470 KB of prompt snapshots after the prompt, past the 400 KB read, and «Para al terminar»
 * was not seen, so autonomous mode refused four times to let it stop).
 */
export function lastUserPrompt(transcript?: string): string | undefined {
  if (!transcript) return undefined
  try {
    const size = statSync(transcript).size
    for (const tail of PROMPT_TAILS) {
      const len = Math.min(size, tail)
      const buf = Buffer.alloc(len)
      const fd = openSync(transcript, 'r')
      try { readSync(fd, buf, 0, len, size - len) } finally { closeSync(fd) }
      const lines = buf.toString('utf8').split('\n')
      // The first line may be cut in half; it is only trusted when the whole file was read.
      for (let n = lines.length - 1; n >= (len < size ? 1 : 0); n--) {
        const line = lines[n]
        if (line.includes('"type":"last-prompt"')) {
          let row: any
          try { row = JSON.parse(line) } catch { continue }
          if (row.type === 'last-prompt' && typeof row.lastPrompt === 'string' && row.lastPrompt && !row.lastPrompt.trimStart().startsWith('<')) return row.lastPrompt
          continue
        }
        if (!line.includes('"type":"user"')) continue
        let row: any
        try { row = JSON.parse(line) } catch { continue }
        if (row.type !== 'user' || row.isMeta) continue
        const c = row.message?.content
        const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b: any) => b.type === 'tool_result') ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ') : ''
        if (text && !text.trimStart().startsWith('<')) return text
      }
      if (len >= size) break
    }
  } catch { /* no transcript */ }
  return undefined
}
