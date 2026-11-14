// Reads a project's TASKS.md (the format the four accounts already use in the game project):
//   - [ ] C1a · Title: detail      - [~] F10 · **Bold title** detail      - [x] PJ2: detail
// It never writes the file. A checkbox says what the agent claims; "verified" is only set by the user in the app.
import type { AccountId, TaskStatus } from '../types'

export interface ParsedTask {
  key: string
  extId?: string
  title: string
  detail: string
  mark: ' ' | '~' | 'x'
  status: TaskStatus
  section: string
  line: number
  depth: number
  owner?: AccountId
  /** The agent says it saw it working ("visto", "probado"): still not the user's verification. */
  agentChecked: boolean
}

const TASK_RE = /^(\s*)- \[([ x~X])\]\s+(.*)$/
const ID_RE = /^(?:\*\*)?([A-Z][A-Za-z]{0,3}\d+[a-z]?\d*[a-z]?|[A-Z]{2,4})(?:\*\*)?\s*(?:·|:|—|-)\s+/
const HEADING_RE = /^(#{1,4})\s+(.*)$/

export function stripMd(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The first signature in a task: a parenthesis with an account and a date («(8-11, claude3)», «(claude1, 11-11: …»), or
 * just the account («(claude3)»). Notes are added at the front, so the first one is the latest.
 */
export function signedBy(s: string): AccountId | undefined {
  // Said in words: «claude6 lo sigue», «lo lleva claude1».
  const said = s.match(/\bclaude(\d{1,2}) (?:lo|la) (?:sigue|lleva|tiene)\b|\b(?:lo|la) (?:sigue|lleva|tiene) claude(\d{1,2})\b/i)
  if (said) return `claude${said[1] ?? said[2]}` as AccountId
  for (const m of s.matchAll(/\(([^()]*)(\))?/g)) {
    const inner = m[1]
    const acc = inner.match(/\bclaude(\d{1,2})\b/i)
    if (!acc) continue
    if ((m[2] && /^\s*claude\d{1,2}\s*$/i.test(inner)) || /\b\d{1,2}-\d{1,2}\b/.test(inner)) return `claude${acc[1]}` as AccountId
  }
  return undefined
}

/**
 * The «[modelo]» and «{recurso}» tags a task's own text ends with, taken out (EV125). They go after its notes in what is
 * kept, so that the stored text ends with them as the line does: the notes are kept after the body, and «the tags at the
 * end» found the notes' mentions instead (13-11: EV101 came out «Haiku», EV20 «needed» Unity and the graphics card).
 * «(…)» groups between them stay where they are.
 */
export function takeTailTags(text: string): { text: string; tags: string } {
  const found: { at: number; tag: string }[] = []
  let s = text.trimEnd()
  for (let guard = 0; guard < 20 && s; guard++) {
    const last = s[s.length - 1]
    if (!found.length && (last === '.' || last === ',' || last === ';')) { s = s.slice(0, -1).trimEnd(); continue }
    const open = last === ']' ? '[' : last === '}' ? '{' : last === ')' ? '(' : ''
    if (!open) break
    const i = s.lastIndexOf(open)
    if (i < 0) break
    const group = s.slice(i)
    if (open !== '(' && /^(?:\[(?:haiku|sonnet|opus|fable)(?: +(?:u|o) +(?:haiku|sonnet|opus|fable))*\]|\{[a-zñ][a-zñ0-9_-]{1,20}\})$/i.test(group)) found.unshift({ at: i, tag: group })
    else if (open !== '(') break
    s = s.slice(0, i).trimEnd()
  }
  if (!found.length) return { text, tags: '' }
  let out = text
  for (const f of [...found].sort((a, b) => b.at - a.at)) out = out.slice(0, f.at) + out.slice(f.at + f.tag.length)
  return { text: out.replace(/\s{2,}/g, ' ').trimEnd(), tags: found.map((f) => f.tag).join(' ') }
}

// A «*» inside inline code (`Logs/mp6_*`) is not italics: hidden while notes and title are told apart, put back after
// (13-11: a the game project note with `Logs/mp6_*` ended there and its title came out as «). Quedan algunas losas…»).
const CODE_STAR = ''
export const hideCodeStars = (s: string) => s.replace(/`[^`]*`/g, (m) => m.replace(/\*/g, CODE_STAR))
export const showCodeStars = (s: string) => s.split(CODE_STAR).join('*')

function splitTitle(body: string): { title: string; detail: string } {
  const r = splitTitleNotes(hideCodeStars(body))
  // The tags at the end of the task's own words, after its notes (takeTailTags).
  const own = takeTailTags(r.detail.slice(0, r.ownEnd))
  const out = own.tags ? { title: r.title, detail: [own.text, r.detail.slice(r.ownEnd).trim(), own.tags].filter(Boolean).join(' ') } : { title: r.title, detail: r.detail }
  return { title: showCodeStars(out.title), detail: showCodeStars(out.detail) }
}

function splitTitleNotes(body: string): { title: string; detail: string; ownEnd: number } {
  let rest = body
  // A leading italic note ("*Hecho y visto (1-11): ...*") is detail, not the title.
  let lead = ''
  // Any other leading italic followed by the task's own words is a note too («*Primera parte (12-11): …* Relevos sin…»).
  // Several notes in a row (each account adds its own in front, 13-11) are all detail: before, only the first was taken
  // out and the second became the title («EV91 · Antes: probado…»).
  // Up to 20: a long task gathers many (13-11: EV44 had seven and the seventh became its title).
  for (let k = 0; k < 20; k++) {
    // A list mark left between notes when one was pasted in front of another («*Casi…* - [~] EV141 · *Primer paso…*»,
    // 14-11): it made «- [~] EV141 · Primer paso» the title shown in Inicio and pmc parte.
    if (k) rest = rest.replace(/^-\s+\[[ xX~]\]\s+(?:[A-Za-z]{1,6}\d+[a-z]?\s*[·:]\s*)?(?=\*(?!\*))/, '')
    const note = rest.match(/^\*(?!\*)([^*]+)\*\s*/)
    if (!note || !(/^(hecho|en curso|revisado|hechos|probado|visto|cerrad|pendiente|a medias)/i.test(note[1]) || rest.slice(note[0].length).trim().length > 12)) break
    lead = lead ? `${lead} ${note[1]}` : note[1]
    rest = rest.slice(note[0].length)
  }
  const bold = rest.match(/^\*\*([^*]+)\*\*\s*(.*)$/)
  if (bold) {
    return own(stripMd(bold[1]).replace(/[:.]$/, ''), stripMd(bold[2]), lead)
  }
  const plain = stripMd(rest)
  const cut = plain.search(/(?<=\S)(?:\. |: | \(|; )/)
  if (cut > 12 && cut < 140) return own(plain.slice(0, cut), stripMd(plain.slice(cut + 1).trim()), lead)
  if (plain.length > 140) {
    const sp = plain.lastIndexOf(' ', 120)
    return own(plain.slice(0, sp > 40 ? sp : 120) + '…', plain, lead)
  }
  return { title: plain || stripMd(lead), detail: plain ? stripMd(lead) : '', ownEnd: 0 }
}

/** The detail as before (the task's own words, then its notes) and where its own words end. */
function own(title: string, words: string, lead: string): { title: string; detail: string; ownEnd: number } {
  const notes = stripMd(lead)
  return { title, detail: [words, notes].filter(Boolean).join(' '), ownEnd: words.length }
}

export function statusFor(mark: string, text: string): TaskStatus {
  if (mark === 'x' || mark === 'X') return 'terminada'
  // A line in progress keeps its notes newest first («*Hecha, sin instalar…* *Bloqueada (09:54)…* **Título**»): the newest
  // says where it is now (13-11: EV44 and EV52 stayed «bloqueadas» after being unblocked, by an older note further on).
  const newest = mark === '~' ? hideCodeStars(text).match(/^[^*]*?\*(?!\*)([^*]+)\*(?!\*)/)?.[1] : undefined
  const t = (newest ?? text).toLowerCase()
  if (mark === '~') {
    // EV121: «Espera un hecho real» too (a Fable limit, a recharge by hand, a PC with nothing): nothing a session can do
    // now, so it is not offered as work (13-11: claude1 was told to go on with a queue of only those).
    if (/bloquead|no se puede seguir|espera a que (el usuario|lo pruebe)|espera un hecho real/.test(t)) return 'bloqueada'
    if (/(a la espera|espera) del visto bueno|pendiente de que el usuario|que (lo )?(juzgue|apruebe|decida) el usuario|por decidir con (él|el usuario)/.test(t)) return 'revision'
    return 'en-desarrollo'
  }
  if (/por decidir|propuesta|idea/.test(t) && /^\s*(\(?usuario|propone)/.test(t)) return 'idea'
  return 'pendiente'
}

function hashKey(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function parseTasks(markdown: string): ParsedTask[] {
  const lines = markdown.split(/\r?\n/)
  const out: ParsedTask[] = []
  const seen = new Map<string, number>()
  const headings: string[] = []
  let sectionOwner: AccountId | undefined
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h = line.match(HEADING_RE)
    if (h) {
      const level = h[1].length
      headings.length = Math.max(0, level - 1)
      headings[level - 1] = stripMd(h[2])
      section = headings.filter(Boolean).slice(1).join(' › ') || stripMd(h[2])
      const owner = h[2].match(/asignad[oa]s? a claude(\d{1,2})/i)
      sectionOwner = owner ? (`claude${owner[1]}` as AccountId) : level <= 2 ? undefined : sectionOwner
      continue
    }
    const m = line.match(TASK_RE)
    if (!m) continue
    const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2)
    const mark = (m[2] === 'X' ? 'x' : m[2]) as ParsedTask['mark']
    let body = m[3]
    let extId: string | undefined
    const id = body.match(ID_RE)
    if (id) {
      extId = id[1]
      body = body.slice(id[0].length)
    }
    const { title, detail } = splitTitle(body)
    const lower = body.toLowerCase()
    let owner: AccountId | undefined
    const doing = body.match(/en curso[^)]*?claude(\d{1,2})/i)
    if (doing) owner = `claude${doing[1]}` as AccountId
    else if (mark !== 'x' && sectionOwner) owner = sectionOwner
    // Half-done: the account that signs its latest note («(12-11, 0.13.15, claude6)», «(claude1, 11-11: …», «(claude3)»),
    // not any account the text happens to name (12-11: «…solo 8 al genérico, claude1 y claude5» made EV32 claude5's).
    else if (mark === '~') owner = signedBy(body)
    let key = extId ?? 'h:' + hashKey(section + '|' + title.slice(0, 80))
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > 1) key = `${key}#${n}`
    out.push({
      key,
      extId,
      title: title || '(sin título)',
      detail,
      mark,
      status: statusFor(mark, body),
      section,
      line: i + 1,
      depth,
      owner,
      agentChecked: mark === 'x' && /\b(visto|vistos|vista|probado|probada|probados|comprobado|en partida|en captura)\b/.test(lower)
    })
  }
  return out
}
