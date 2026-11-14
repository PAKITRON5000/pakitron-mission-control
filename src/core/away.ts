import { t } from './i18n'
// When the user is away (EV88; the user, 13-11: «y si espera una respuesta mía y no estoy? debería aceptar lo que sea, ya
// di permiso para eso»). A window waiting for a permission while the user is not at the PC is answered by the app: yes to
// what his standing permission covers, no (and a question in Decidir) to the four things he asked to confirm himself:
// deleting work that cannot be recovered, publishing outside this PC, spending money and touching credentials.
import { closeSync, openSync, readSync, statSync } from 'node:fs'

export type AwayPolicy = 'seguro' | 'todo' | 'esperar'

export const AWAY_POLICIES: { id: AwayPolicy; label: string; sub: string }[] = [
  { id: 'seguro', get label() { return t('Aceptar todo menos lo que pediste confirmar') }, get sub() { return t('Acepta solo lo que cubre tu permiso; rechaza borrar lo irrecuperable, publicar fuera del PC, gastar dinero o tocar credenciales y te lo deja en Decidir.') } },
  { id: 'todo', get label() { return t('Aceptar todo') }, get sub() { return t('Acepta cualquier permiso cuando no estás.') } },
  { id: 'esperar', get label() { return t('Esperarme') }, get sub() { return t('No acepta nada: la ventana espera a que vuelvas.') } }
]

const RULES: { why: string; test: RegExp }[] = [
  { get why() { return t('borrar trabajo que no se puede recuperar') }, test: /\brm\s+-[a-z]*(rf|fr)\b|\bRemove-Item\b[^|;]*-Recurse|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|push\s+[^;|]*--force)|\b(del|erase)\s+\/[sq]|\brmdir\s+\/s|\bFormat-Volume\b|\bdiskpart\b/i },
  { get why() { return t('publicar fuera de este PC') }, test: /\bgit\s+push\b|\bnpm\s+publish\b|\bgh\s+(release|repo\s+create|pr\s+(create|merge))|\bcurl\b[^|;]*\s-X\s*(POST|PUT|DELETE|PATCH)\b|\bInvoke-(RestMethod|WebRequest)\b[^|;]*-Method\s+(Post|Put|Delete|Patch)|\bscp\b|\bvercel\b|\bnetlify\s+deploy\b/i },
  { why: 'gastar dinero', test: /\b(stripe|paypal|checkout\.session|purchase|buy-credits|billing)\b/i },
  { get why() { return t('tocar credenciales o la seguridad') }, test: /\.credentials|credentials\.json|\bid_(rsa|ed25519)\b|[\\/]\.ssh[\\/]|\.env(\.|\b)|\b(api[_-]?key|secret|password|passwd|token)s?\b\s*[=:]|[\\/]\.claude[^\\/]*[\\/]settings\.json/i }
]

/** Whether a tool call is one of the things the user wants to confirm himself, and which. */
export function riskOf(tool?: string, input?: any): { risky: boolean; why?: string } {
  if (!tool) return { risky: true, why: t('no se sabe qué pide') }
  const text = [input?.command, input?.file_path, input?.notebook_path, input?.url, input?.content?.slice?.(0, 2000), input?.new_string?.slice?.(0, 2000)].filter(Boolean).join('\n')
  const hit = RULES.find((r) => r.test.test(text))
  return hit ? { risky: true, why: hit.why } : { risky: false }
}

/** What to do with a permission the user cannot answer. */
export function awayAnswer(policy: AwayPolicy, risk: { risky: boolean }): 'aceptar' | 'rechazar' | 'esperar' {
  if (policy === 'esperar') return 'esperar'
  if (policy === 'todo') return 'aceptar'
  return risk.risky ? 'rechazar' : 'aceptar'
}

/** The tool call a conversation is waiting on: the last tool_use with no tool_result after it (from the end of the file). */
export function pendingToolUse(transcript: string): { name: string; input: any } | undefined {
  try {
    const size = statSync(transcript).size
    const len = Math.min(size, 600_000)
    const buf = Buffer.alloc(len)
    const fd = openSync(transcript, 'r')
    try { readSync(fd, buf, 0, len, size - len) } finally { closeSync(fd) }
    const lines = buf.toString('utf8').split('\n')
    const answered = new Set<string>()
    for (let n = lines.length - 1; n >= 0; n--) {
      const l = lines[n]
      if (!l.includes('"tool_')) continue
      let row: any
      try { row = JSON.parse(l) } catch { continue }
      const blocks = Array.isArray(row?.message?.content) ? row.message.content : []
      for (const b of blocks) if (b.type === 'tool_result' && b.tool_use_id) answered.add(b.tool_use_id)
      for (const b of [...blocks].reverse()) if (b.type === 'tool_use' && !answered.has(b.id)) return { name: b.name, input: b.input }
      if (blocks.some((b: any) => b.type === 'tool_use')) return undefined
    }
  } catch { /* no transcript */ }
  return undefined
}

/**
 * What the bottom of a Claude Code window shows, read from its console (EV88). Claude Code reports every dialog without a
 * name of its own as «permission prompt», and not every menu has «1. Yes» first: the folder trust check has «No, exit»
 * first and no numbers (13-11, the user: «el 1 es no, exit»; pressing Intro there closed the window). So the app answers
 * only when it sees a «Do you want…» menu whose option 1 is a yes; anything else it leaves for the user.
 */
export function yesOnScreen(screen: string): { key: '1'; question?: string } | { key?: undefined; why: string } {
  const lines = screen.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  const tail = lines.slice(-16)
  const footer = tail.findIndex((l) => /Esc to cancel|Enter to confirm|Enter to select/i.test(l))
  if (footer < 0) return { why: t('no se ve ningún menú abierto') }
  const menu = tail.slice(0, footer)
  const yes = menu.findIndex((l) => /^\s*(?:[❯>›]\s*)?1\.\s+(?:Yes|Sí|Si)\b/i.test(l))
  const question = [...menu.slice(0, yes < 0 ? menu.length : yes)].reverse().find((l) => /\?\s*$/.test(l))?.trim()
  if (yes < 0) return { why: t('el menú no tiene «1. Yes»{v0}', { v0: question ? ` («${question.slice(0, 120)}»)` : '' }) }
  return { key: '1', question }
}
