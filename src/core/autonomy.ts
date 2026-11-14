// Autonomous mode (the user, 12-11: «que tampoco se detengan hasta que el usuario lo cambie»). With it on, a session that
// tries to end its turn while its project still has work for it is told to go on; it only rests when the limit cuts it,
// and then it is scheduled to start again when its usage comes back. The user turns it off in Relevos › Cómo trabajan los Claude, or
// stops one window by telling it «para».
import { existsSync, readFileSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

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
  if (!STOP_WORDS.test(prompt)) return false
  const m = prompt.match(/^\s*para\s+([a-záéíóúñ]+)/i)
  if (!m) return true
  const next = m[1].toLowerCase()
  if (/^(que|qué|ello|eso|esto|esta|este|estas|estos|los|las|el|la|lo|le|les|mi|mis|tu|tus|su|sus|todo|toda|todos|todas|cada|cuando|como|cómo|no|nada|mí|ti|nosotros|vosotros|ellos|ellas)$/.test(next)) return false
  if (/(ar|er|ir|arlo|erlo|irlo|arla|erla|irla|arlos|arlas|arse|erse|irse)$/.test(next) && next !== 'parar') return false
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
  if (!i.autonomous) return undefined
  if (i.lastPrompt && isStopPrompt(i.lastPrompt)) return undefined
  if (i.blocks.filter((at) => now - at < BLOCK_WINDOW_MS).length >= MAX_BLOCKS) return undefined
  if (i.outgoing) {
    if (i.blocks.filter((at) => now - at < OUTGOING_WINDOW_MS).length >= OUTGOING_BLOCKS) return undefined
    return [
      'Mission Control, rueda de relevos: el turno ya es de otra cuenta y tú estás en el solape.',
      'Sigue solo con cosas pequeñas que no toquen sus archivos (documentos, pruebas, arreglos cortos) y guarda con pmc guarda.',
      `Lo tuyo: ${i.next.slice(0, 3).join('; ') || 'nada en tu cola'}.`,
      'Si no te queda nada pequeño que no la pise, dilo en una línea en el relevo y termina.'
    ].join(' ')
  }
  if (!i.next.length) {
    const here = i.project ? `en ${i.project}` : 'en este proyecto'
    const other = i.elsewhere?.[0]
    return [
      `Mission Control, modo autónomo: no te quedan tareas ${here}, pero el usuario no quiere que nadie se quede parado.`,
      `Primero piensa qué se puede mejorar ${here} (lo que falla, lo que falta, lo que el usuario pidió y no está, pruebas, rendimiento, lo que se ve) y apúntalo en docs/TASKS.md como tareas nuevas, cada una con «se da por buena cuando…»; reserva la primera (pmc claim) y empiézala ya.`,
      other
        ? `Solo si de verdad no hay nada que añadir, pasa a otro proyecto: ${other.project} (${other.root}), donde te espera ${other.next.slice(0, 3).join('; ')}; trabaja allí con rutas absolutas y las órdenes pmc desde su carpeta.`
        : 'Solo si de verdad no hay nada que añadir ni otro proyecto con trabajo para ti, dilo en una línea en el relevo.'
    ].join(' ')
  }
  return [
    'Mission Control, modo autónomo: no termines el turno. El usuario quiere que trabajes sin parar hasta que el límite de uso te corte (entonces Mission Control te vuelve a abrir cuando se restablezca) o hasta que él quite el modo autónomo.',
    'No resumas ni preguntes si sigues: guarda lo hecho (commit), pon al día el relevo y empieza ya la siguiente tarea.',
    `Lo siguiente en tu cola: ${i.next.slice(0, 4).join('; ')}.`,
    'Si necesitas una decisión del usuario, pídela con pmc decide y sigue con otra tarea. Si de verdad no puedes avanzar en nada, dilo en una línea en el relevo.'
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
