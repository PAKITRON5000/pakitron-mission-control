import { t } from './i18n'
// Reads a Claude conversation from its saved file into something a chat screen can show: what the user wrote, what Claude
// answered, and the steps in between in a few words. Read only, and only the end of the file: these files get very large.
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs'

export interface ChatMessage {
  id: string
  role: 'user' | 'claude'
  text: string
  at: number
  /** What it did before saying this, in a few words each. */
  steps?: string[]
}

export interface ChatTail {
  messages: ChatMessage[]
  /** The last thing in the file is a step still running, or a message not yet answered. */
  midTurn: boolean
  /** The steps since the last thing it said: what it is doing right now. */
  live: string[]
  /** A question it has asked and not had answered, with its options. */
  asking?: { question: string; options: string[] }
  mtime: number
}

function readEnd(file: string, bytes: number): { text: string; mtime: number; cut: boolean } | undefined {
  if (!existsSync(file)) return undefined
  const fd = openSync(file, 'r')
  try {
    const st = fstatSync(fd)
    const length = Math.min(bytes, st.size)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, st.size - length)
    return { text: buffer.toString('utf8'), mtime: st.mtimeMs, cut: length < st.size }
  } finally {
    closeSync(fd)
  }
}

/** What the harness adds to a message, which the user did not write. */
export function cleanUserText(raw: string): string {
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, '')
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, (m) => (m.startsWith('<command-name>') ? m.replace(/<\/?command-name>/g, '') : ''))
    .trim()
}

function step(name: string, input: any): string {
  const said = input?.description ?? input?.file_path ?? input?.pattern ?? input?.query ?? input?.command ?? input?.prompt ?? ''
  const short = String(said).replace(/\s+/g, ' ').replace(/^.*[\\/](?=[^\\/]+$)/, '').slice(0, 70)
  const verb = ({ Read: 'Lee', Edit: 'Edita', Write: 'Escribe', Bash: 'Ejecuta', PowerShell: 'Ejecuta', Grep: 'Busca', Glob: 'Busca', WebSearch: 'Busca en la web', Agent: 'Lanza un agente', AskUserQuestion: 'Te pregunta' } as Record<string, string>)[name] ?? name
  return short ? `${verb}: ${short}` : verb
}

export function parseChat(text: string, cut: boolean, limit: number): { messages: ChatMessage[]; midTurn: boolean; live: string[]; asking?: { question: string; options: string[] } } {
  const lines = text.split('\n')
  if (cut) lines.shift()
  const messages: ChatMessage[] = []
  let pending: string[] = []
  let midTurn = false
  let asking: { question: string; options: string[] } | undefined
  for (const line of lines) {
    if (!line.trim()) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.isSidechain || (e.type !== 'user' && e.type !== 'assistant')) continue
    const at = Date.parse(e.timestamp) || 0
    const content = e.message?.content
    const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    if (e.type === 'user') {
      if (e.isMeta) continue
      const results = blocks.some((b) => b.type === 'tool_result')
      const said = cleanUserText(blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'))
      // What the harness adds and an interruption are not something waiting for an answer.
      if (said.startsWith('[Request interrupted')) { midTurn = false; asking = undefined; continue }
      if (!said && !results) continue
      midTurn = true
      asking = undefined
      if (results) continue
      messages.push({ id: e.uuid ?? `${at}`, role: 'user', text: said, at })
      pending = []
      continue
    }
    const said = limitInSpanish(blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim())
    const uses = blocks.filter((b) => b.type === 'tool_use')
    midTurn = uses.length > 0 || e.message?.stop_reason == null && !said
    if (said) {
      messages.push({ id: e.uuid ?? `${at}`, role: 'claude', text: said, at, steps: pending.length ? pending : undefined })
      pending = []
      if (!uses.length) midTurn = false
    }
    // After what it said in the same breath: these steps belong to the next thing it says.
    for (const u of uses) {
      pending.push(step(u.name, u.input))
      const q = u.name === 'AskUserQuestion' ? u.input?.questions?.[0] : undefined
      if (q) asking = { question: String(q.question ?? ''), options: (q.options ?? []).map((o: any) => String(o.label ?? '')) }
    }
  }
  return { messages: messages.slice(-limit), midTurn, live: midTurn ? pending : [], asking: midTurn ? asking : undefined }
}

const MONTHS: Record<string, string> = { jan: 'ene', feb: 'feb', mar: 'mar', apr: 'abr', may: 'may', jun: 'jun', jul: 'jul', aug: 'ago', sep: 'sep', oct: 'oct', nov: 'nov', dec: 'dic' }

/**
 * Claude Code's own limit message, in Spanish: «You've hit your 5-hour limit · resets 5:30pm (Europe/Madrid)» →
 * «Se quedó sin uso de las 5 horas · vuelve a las 17:30» (13-11: Chats showed it in English as the last thing said).
 * Anything else comes back as it was.
 */
export function limitInSpanish(text: string): string {
  const m = /^You(?:'ve| have) hit your (?:(5-hour|weekly|session|opus|fable|sonnet)\s+)?limit\b([\s\S]*)$/i.exec(text)
  if (!m) return text
  const kind = m[1]?.toLowerCase()
  const what = kind === '5-hour' || kind === 'session' ? ' de las 5 horas' : kind === 'weekly' ? ' de la semana' : kind ? ` de ${kind[0].toUpperCase()}${kind.slice(1)}` : ''
  const r = /resets\s+(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(m[2] ?? '')
  let when = ''
  if (r) {
    const h = (Number(r[3]) % 12) + (r[5].toLowerCase() === 'pm' ? 12 : 0)
    const day = r[1] && r[2] ? `el ${Number(r[2])} ${MONTHS[r[1].toLowerCase()] ?? r[1]} ` : ''
    when = ` · vuelve ${day}${h === 1 ? 'a la' : 'a las'} ${h}:${r[4] ?? '00'}`
  }
  return t('Se quedó sin uso{what}{when}', { what: what, when: when })
}

export function readChat(file: string, limit = 60, bytes = 3 << 20): ChatTail | undefined {
  const end = readEnd(file, bytes)
  if (!end) return undefined
  return { ...parseChat(end.text, end.cut, limit), mtime: end.mtime }
}
