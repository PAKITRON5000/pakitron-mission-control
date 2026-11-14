// EV154 (the user, 14-11 ~12:10: «lo que mande en esa ventana debería entrar directamente a los claude inactivos o al
// activo si no hay inactivos y que lo procese cuando proceda»; and «yo lo vea como enviado… si está en espera, leído,
// aceptado»): where a note from the dock goes, and what the user sees of it afterwards.
import type { AccountId, AgentCard } from './types'
import type { RelayChain } from './chain'
import { isSessionWorking } from './working'
import { addEvent, type DB } from './db'
import { t, locale } from './i18n'

export type NoteRoute =
  /** An open window of a Claude that is not doing anything: the note is typed into it, as if the user wrote there. */
  | { kind: 'ventana'; account: AccountId; pid: number; sessionId: string }
  /** Every Claude here is busy: the one at work reads it after its next step (its hook), without being stopped. */
  | { kind: 'paso'; account: AccountId }
  /** Nobody is in the project: a free account with usage is opened there, and reads it on starting. */
  | { kind: 'abrir'; account: AccountId }
  /** Nobody can take it now: it waits for the first Claude that starts in the project. */
  | { kind: 'espera'; why: string }

type Agent = Pick<AgentCard, 'id' | 'state' | 'sessions'> & { usage?: AgentCard['usage']; identity?: { hasLogin?: boolean }; lastActivityAt?: number }

/** States in which an account cannot take anything: out of usage, set aside by the user, gone, or not reachable. */
const CANNOT = new Set(['sin-uso', 'apartada', 'baja', 'desconectado'])

function fivePct(a: Agent): number {
  return a.usage?.snapshot?.fiveHour?.usedPct ?? 50
}

export function pickNoteRoute(o: {
  agents: Agent[]
  projectId: string
  target?: AccountId
  /** Settings › accountStatus: «pausada» or «baja» are never written to. */
  excluded?: Record<string, unknown>
  chains?: Record<string, RelayChain | undefined>
}): NoteRoute {
  const excluded = o.excluded ?? {}
  const chain = o.chains?.[o.projectId]
  const wheel = chain?.on ? chain : undefined
  const real = (a: Agent) => a.identity?.hasLogin !== false || a.sessions.length > 0
  const usable = (a: Agent) => real(a) && !excluded[a.id] && !CANNOT.has(a.state) && (!o.target || a.id === o.target)
  // With a wheel here, only the one with the turn (and its partner) may touch the project: the others would be stopped
  // by the hook. A note the user addressed to someone by name still goes to that one.
  const inTurn = (a: Agent) => !wheel || Boolean(o.target) || a.id === wheel.holder || a.id === wheel.partner
  const here = o.agents.filter((a) => usable(a) && inTurn(a))
  const inProject = (a: Agent) => a.sessions.filter((s) => s.projectId === o.projectId)
  const order = (x: Agent, y: Agent) => fivePct(x) - fivePct(y) || (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0)

  // 1. A window here with nobody working in it: it takes it now.
  const idle = here
    .map((a) => ({ a, s: inProject(a).find((s) => s.pid && s.kind !== 'background' && s.status === 'idle' && !s.rateLimited && !s.noCredit) }))
    .filter((x) => x.s)
    .sort((x, y) => order(x.a, y.a))[0]
  if (idle?.s?.pid) return { kind: 'ventana', account: idle.a.id, pid: idle.s.pid, sessionId: idle.s.sessionId }

  // 2. Someone at work here (or waiting on a question): after its next step.
  const busy = here.filter((a) => inProject(a).some((s) => isSessionWorking(s) && !s.rateLimited && !s.noCredit)).sort(order)[0]
  if (busy) return { kind: 'paso', account: busy.id }

  // 3. Nobody here: a free account opens in the project. Not one that belongs to another project's wheel (it would miss
  // its turn there, EV153), not while this project has its own wheel (it opens whoever has the turn), and not one busy elsewhere.
  if (wheel) return { kind: 'espera', why: wheel.holder ? t('la rueda de relevos la dará a quien tenga el turno (Claude {n})', { n: wheel.holder.slice(6) }) : t('la rueda de relevos la dará a quien tenga el turno') }
  const otherWheels = Object.entries(o.chains ?? {}).filter(([pid, c]) => pid !== o.projectId && c?.on).flatMap(([, c]) => c!.order)
  const free = here
    .filter((a) => a.state === 'disponible' && !a.sessions.some((s) => isSessionWorking(s)) && !otherWheels.includes(a.id))
    .sort(order)[0]
  if (free) return { kind: 'abrir', account: free.id }
  if (o.target) {
    const who = o.agents.find((a) => a.id === o.target)
    const why = !who ? t('esa cuenta no está en este PC')
      : excluded[who.id] ? t('Claude {n} está apartada', { n: who.id.slice(6) })
      : who.state === 'sin-uso' ? t('Claude {n} no tiene uso ahora; la leerá al volver', { n: who.id.slice(6) })
      : t('Claude {n} está en otro proyecto; la leerá al entrar en este', { n: who.id.slice(6) })
    return { kind: 'espera', why }
  }
  return { kind: 'espera', why: t('no hay ningún Claude libre con uso; la leerá el primero que entre') }
}

/** What is typed into the window: one line (the console sends on Enter), with the mark that links it to its task. */
export function typedNoteText(projectName: string, id: number, body: string): string {
  return `Mission Control · nota del usuario para ${projectName} (MC-${id}): «${body.replace(/\s*\r?\n\s*/g, ' ').trim()}». ` +
    'Si estabas con algo, ciérralo antes sin dejar nada roto. Apúntala en docs/TASKS.md donde le toque (su sección, su prioridad y la cuenta que mejor encaje), ' +
    `con la marca (MC-${id}) en su línea para que el usuario vea en la app que está apuntada, y hazla si te toca a ti por prioridad; si no, sigue con lo tuyo.`
}

/** Typed into a window: delivered, waiting for that Claude's next step to count as read. */
export function markTyped(db: DB, id: number, account: AccountId, now = Date.now()): void {
  // The target stays as the user wrote it («para todos» or someone): who got it goes in the channel.
  db.prepare("UPDATE instructions SET status = 'entregada', channel = ?, delivered_at = ?, error = NULL, updated_at = ? WHERE id = ?")
    .run(`ventana ${account}`, now, now, id)
}

/** A free account is being opened for it: it reads it on starting (SessionStart). */
export function markOpening(db: DB, id: number, account: AccountId, now = Date.now()): void {
  db.prepare("UPDATE instructions SET status = 'pendiente-entrega', channel = ?, updated_at = ? WHERE id = ?")
    .run(`abriendo ${account}`, now, id)
}

/**
 * Notes typed into this account's window count as read with its next step (a tool, or the end of its turn): it got
 * them as a message from the user. Returns how many.
 */
export function confirmTyped(db: DB, projectId: string, account: AccountId, now = Date.now()): number {
  const rows = db.prepare("SELECT id, body FROM instructions WHERE project_id = ? AND status = 'entregada' AND channel = ? AND delivered_at <= ?")
    .all(projectId, `ventana ${account}`, now) as { id: number; body: string }[]
  for (const r of rows) {
    db.prepare("UPDATE instructions SET status = 'recibida', updated_at = ? WHERE id = ?").run(now, r.id)
    addEvent(db, { projectId, at: now, account, kind: 'recibida', title: t('Claude {v0} ha leído tu nota: «{v1}»', { v0: account.slice(6), v1: r.body.slice(0, 100) }), source: 'su ventana', ref: `ins:${r.id}` })
  }
  return rows.length
}

export interface SentNote {
  id: number
  body: string
  target?: AccountId
  status: string
  channel?: string
  createdAt: number
  deliveredAt?: number
  updatedAt: number
  error?: string
  /** Who got it: the window it was typed into, the account opened for it, or the one whose hook read it. */
  reader?: AccountId
  /** The task a Claude filed it as (its line in TASKS.md carries «MC-<id>»). */
  task?: { id: string; done: boolean; owner?: string }
}

/** What the user wrote to the Claudes lately (not the app's own messages, nor notes on images), newest first. */
export function sentNotes(db: DB, projectId: string, since: number, limit = 6): SentNote[] {
  const rows = db.prepare(`SELECT id, body, target, status, channel, created_at, delivered_at, updated_at, error FROM instructions
    WHERE project_id = ? AND kind IN ('general', 'tarea') AND comment_id IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, since, limit) as any[]
  const readBy = db.prepare("SELECT account FROM events WHERE ref = ? AND kind = 'recibida' AND account IS NOT NULL ORDER BY at DESC LIMIT 1")
  const find = db.prepare("SELECT COALESCE(ext_id, key) AS id, COALESCE(override, status) AS st, owner, title, detail FROM tasks WHERE project_id = ? AND gone = 0 AND (title LIKE ? OR detail LIKE ?) LIMIT 5")
  return rows.map((r) => {
    const tag = `MC-${r.id}`
    const exact = new RegExp(`\\b${tag}\\b(?!\\d)`)
    const t = (find.all(projectId, `%${tag}%`, `%${tag}%`) as any[]).find((x) => exact.test(`${x.title} ${x.detail}`))
    const via = /^(?:ventana|abriendo) (claude\d+)$/.exec(r.channel ?? '')?.[1]
    const reader = (r.status === 'recibida' ? (readBy.get(`ins:${r.id}`) as { account?: string } | undefined)?.account : undefined) ?? via ?? (r.status === 'recibida' ? r.target : undefined)
    return {
      id: r.id, body: r.body, target: r.target ?? undefined, status: r.status, channel: r.channel ?? undefined, reader: (reader ?? undefined) as AccountId | undefined,
      createdAt: r.created_at, deliveredAt: r.delivered_at ?? undefined, updatedAt: r.updated_at, error: r.error ?? undefined,
      task: t ? { id: String(t.id), done: t.st === 'terminada', owner: t.owner ?? undefined } : undefined
    }
  })
}

export type NoteTone = 'espera' | 'enviada' | 'leida' | 'apuntada' | 'hecha' | 'fallo'

/** The line under each sent note: where it is now, in the user's words. */
export function noteStatus(n: SentNote, route?: NoteRoute): { tone: NoteTone; text: string } {
  const who = (a?: string) => (a ? `Claude ${a.slice(6)}` : t('un Claude'))
  const hm = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '')
  if (n.status === 'anulada') return { tone: 'fallo', text: t('Anulada') }
  if (n.status === 'fallida') return { tone: 'fallo', text: n.error ? t('No se pudo entregar: {error}', { error: n.error }) : t('No se pudo entregar') }
  if (n.task?.done || n.status === 'ejecutada') return { tone: 'hecha', text: n.task ? t('Hecha ({id})', { id: n.task.id }) : t('Hecha') }
  if (n.task) return { tone: 'apuntada', text: n.task.owner ? t('Apuntada como {id}, para {who}', { id: n.task.id, who: who(n.task.owner) }) : t('Apuntada como {id}', { id: n.task.id }) }
  if (n.status === 'recibida') return { tone: 'leida', text: t('Leída por {who} a las {hm}', { who: who(n.reader), hm: hm(n.updatedAt) }) }
  if (n.status === 'entregada' && n.channel?.startsWith('ventana')) return { tone: 'enviada', text: t('Escrita en la ventana de {who} a las {hm}; la está leyendo', { who: who(n.reader), hm: hm(n.deliveredAt) }) }
  if (n.status === 'entregada') return { tone: 'enviada', text: t('Escrita en el Buzón del proyecto') }
  if (n.status === 'pendiente-entrega' && n.channel?.startsWith('abriendo')) return { tone: 'enviada', text: t('Abriendo a {who} para dársela', { who: who(n.reader) }) }
  if (route?.kind === 'paso') return { tone: 'espera', text: t('En cola: {who} la leerá al acabar su paso', { who: who(route.account) }) }
  if (route?.kind === 'ventana') return { tone: 'espera', text: t('Enviando a {who}…', { who: who(route.account) }) }
  if (route?.kind === 'espera') return { tone: 'espera', text: t('En espera: {why}', { why: route.why }) }
  return { tone: 'espera', text: t('En espera: la leerá el primer Claude que trabaje aquí') }
}
