// «Lo que pediste y nadie apuntó» (EV64; the user, 13-11: Claude forgets what was asked hours ago). The user's own
// requests are in each account's history.jsonl; a request counts as noted when a task, a memory or a decision of its
// project repeats a run of its words (the Claudes quote the user in TASKS.md: «…»). The rest is shown to the user, who
// notes it as a task with one click or says it is done / not needed. No node imports: plain functions over text.
import { words } from './route'

export interface UserRequest {
  hash: string
  at: number
  account: string
  text: string
  projectId?: string
  status: 'apuntada' | 'sin-apuntar' | 'cerrada'
}

/** A short stable id for a request's text. */
export function requestHash(text: string): string {
  let h = 5381
  const s = text.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** What the app itself types into windows (relays, notices): it is in the history too, but it is not the user's. */
const APP_TYPED = /^(mission control\b|relevo (autom|en )|your claude\.ai usage limit|continúa exactamente desde)/i

/** Words that make a message an order or a wish, not a chat («quiero», «haz», «arregla», «no me gusta»…). */
const ASKS = /\b(quiero|quisiera|me gustar[ií]a|haz|hazlo|hacer|hay que|habr[áa] que|deber[ií]a|deber[ií]as|deber[áa]s|debe|tienes que|cambia|cambiar|a[ñn]ade|a[ñn]adir|quita|quitar|pon|poner|mejora|mejorar|arregla|arreglar|revisa|revisar|no me gusta|falta|prepara|crea|crear|implementa|mueve|sube|baja)\b/i

/** Only real requests: long enough, an order or a wish, not a command, a paste or something the app typed. */
/** The verbs that ask for something even inside a question («¿puedes quitar…?», «¿quiero que…?»). */
const STRONG = /\b(quiero|quisiera|me gustar[ií]a|haz|hazlo|cambia|a[ñn]ade|quita|quitar|pon|mejora|arregla|revisa|prepara|crea|implementa|mueve|no me gusta|puedes|podr[ií]as)\b/i

export function isRequest(text: string): boolean {
  const t = text.trim()
  if (t.length < 60) return false
  if (/^[/<[]/.test(t) || APP_TYPED.test(t)) return false
  if (/^(sigue|continúa|continua|para|vale|ok|sí|si)\b[\s.,!]*$/i.test(t)) return false
  // EV64: only questions, with no verb that asks for something, is the user asking, not asking for («¿cómo va el trabajo
  // del otro claude? cuando termine de hacer esto ¿qué hará?» counted for its «hacer»).
  const sentences = t.split(/(?<=[?!.])\s+/).map((x) => x.trim()).filter((x) => x.length > 3)
  if (sentences.length && sentences.every((x) => x.endsWith('?')) && !STRONG.test(t)) return false
  return ASKS.test(t)
}

/** The normalised words of a text in runs of n, to look for in what was written down. */
export function runs(text: string, n: number): string[] {
  const w = words(text)
  const out: string[] = []
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '))
  return out
}

/** The words that say what a request is about (long ones), without repeats. */
const keyWords = (text: string) => [...new Set(words(text).filter((w) => w.length >= 5))]

/**
 * Whether something written down covers the request: one document repeats a run of its words (the Claudes quote the
 * user), or holds a good share of its key words (they paraphrase: «humo y partículas que no molesten» → BZ68).
 */
export function isNoted(text: string, docs: string[]): boolean {
  const ix = indexOf(docs)
  const n = words(text).length < 14 ? 3 : 4
  if (runs(text, n).some((x) => ix.grams.has(x))) return true
  const keys = keyWords(text)
  const need = Math.max(3, Math.ceil(keys.length * 0.35))
  const count = new Map<number, number>()
  for (const k of keys) for (const i of ix.prefixes.get(k) ?? []) {
    const c = (count.get(i) ?? 0) + 1
    if (c >= need) return true
    count.set(i, c)
  }
  return false
}

/**
 * What was written down, indexed once (13-11: looking every request up in every task, word run by word run, took four
 * seconds in the game project and froze the app each time Inicio opened). Runs of 3 and 4 words, and which documents have a
 * word starting with each 5+ letter beginning (a key word counts when a document has it or a longer form of it).
 */
export interface CorpusIndex { grams: Set<string>; prefixes: Map<string, Set<number>> }
const indexes = new WeakMap<string[], CorpusIndex>()

export function indexOf(docs: string[]): CorpusIndex {
  const known = indexes.get(docs)
  if (known) return known
  const grams = new Set<string>()
  const prefixes = new Map<string, Set<number>>()
  docs.forEach((d, i) => {
    const w = d.split(' ').filter(Boolean)
    for (const n of [3, 4]) for (let k = 0; k + n <= w.length; k++) grams.add(w.slice(k, k + n).join(' '))
    for (const word of new Set(w)) for (let L = 5; L <= word.length; L++) {
      const pre = word.slice(0, L)
      let set = prefixes.get(pre)
      if (!set) prefixes.set(pre, (set = new Set()))
      set.add(i)
    }
  })
  const ix = { grams, prefixes }
  indexes.set(docs, ix)
  return ix
}

/**
 * A fingerprint of what is written down, project by project (FNV-1a over every text): the same texts give the same
 * string, so the corpus and its index can be kept between calls (EV115). Any change, even of the same length, shows.
 */
export function textsSignature(texts: Record<string, string[]>): string {
  return Object.keys(texts).sort().map((id) => {
    let h = 0x811c9dc5
    for (const t of texts[id]) {
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193)
      h = Math.imul(h ^ 10, 0x01000193)
    }
    return `${id}:${texts[id].length}:${(h >>> 0).toString(36)}`
  }).join('|')
}

/** Each written thing as its normalised words, padded so whole words can be searched in it. */
export function corpusOf(texts: string[]): string[] {
  return texts.map((t) => ' ' + words(t).join(' ') + ' ')
}

/**
 * The project a request belongs to, from three clues: the window's folder, where that account wrote files right after,
 * and the project its words name. Writes win (12-11: a Mission Control request typed in a the game project window), except
 * when the window's folder is itself a project and the words do not point to where it wrote (13-11: an account with
 * windows in the science project and Mission Control at once had its science project requests placed in Mission Control). A
 * window in a folder that is no project counts only where it wrote (its words alone took everything to Mission Control).
 */
export function placeRequest(c: { byFolder?: string; byWork?: string; byWords?: string; outside: boolean }): string | undefined {
  if (c.byFolder && c.byWork && c.byWork !== c.byFolder) return c.byWords === c.byWork ? c.byWork : c.byFolder
  return c.byWork ?? (c.outside ? undefined : c.byWords ?? c.byFolder)
}

/** Requests newer than this are not called unnoted yet: the Claude that got it is still writing it down. */
export const GRACE_MS = 30 * 60_000

export function classify(
  prompts: { at: number; account: string; text: string; projectId?: string }[],
  corpusByProject: Record<string, string[]>,
  closed: Set<string>,
  now = Date.now()
): UserRequest[] {
  const seen = new Set<string>()
  const out: UserRequest[] = []
  // One list for the requests with no project, made once (and kept with the corpus object) so its index is made once too.
  let all: string[] | undefined = flatCorpus.get(corpusByProject)
  for (const p of [...prompts].sort((a, b) => b.at - a.at)) {
    if (!isRequest(p.text)) continue
    const hash = requestHash(p.text)
    if (seen.has(hash)) continue
    seen.add(hash)
    const corpus = p.projectId ? corpusByProject[p.projectId] ?? [] : (all ??= Object.values(corpusByProject).flat())
    // Written down in another project counts too (13-11: a request for the video project typed in Mission Control's window was
    // IV2 over there, and showed here as «sin apuntar»).
    const noted = isNoted(p.text, corpus) || (Boolean(p.projectId) && isNoted(p.text, (all ??= Object.values(corpusByProject).flat())))
    const status = closed.has(hash) ? 'cerrada' : noted || now - p.at < GRACE_MS ? 'apuntada' : 'sin-apuntar'
    out.push({ hash, at: p.at, account: p.account, text: p.text.trim(), projectId: p.projectId, status })
  }
  if (all) flatCorpus.set(corpusByProject, all)
  return out
}
const flatCorpus = new WeakMap<Record<string, string[]>, string[]>()
