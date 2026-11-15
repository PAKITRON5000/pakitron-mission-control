// EV154 (the user, 14-11 ~12:10: «lo que mande en esa ventana debería entrar directamente a los claude inactivos o al
// activo si no hay inactivos y que lo procese cuando proceda»; and «yo lo vea como enviado… si está en espera, leído,
// aceptado»): where a note from the dock goes, and what the user sees of it afterwards.
import type { AccountId, AgentCard } from './types'
import type { RelayChain } from './chain'
import { isSessionWorking } from './working'
import { addEvent, type DB } from './db'
import { t, locale, namesList } from './i18n'

export type NoteRoute =
  /** An open window of a Claude that is not doing anything: the note is typed into it, as if the user wrote there. */
  | { kind: 'ventana'; account: AccountId; pid: number; sessionId: string }
  /** Every Claude here is busy: the one at work reads it after its next step (its hook), without being stopped. */
  | { kind: 'paso'; account: AccountId }
  /** Nobody is in the project: a free account with usage is opened there, and reads it on starting. */
  | { kind: 'abrir'; account: AccountId }
  /** Nobody can take it now: it waits for the first Claude that starts in the project. */
  | { kind: 'espera'; why: string }
  /** EV178: a note for everyone, with Claudes at work (here or in other projects): each reads it after its next step. */
  | { kind: 'todos'; accounts: AccountId[] }
  /**
   * EV182: the Claude the user named is set aside («No usar») or kept as another project's backup, and has no window
   * here: it is opened for this note only, and closed again when it ends its turn (it does not go on with the queue).
   */
  | { kind: 'solo'; account: AccountId }

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
  /** Settings › reserves: an account kept as a project's backup is set aside for everything else (EV182). */
  reserves?: { account: AccountId; projectId: string; on: boolean }[]
}): NoteRoute {
  const excluded = o.excluded ?? {}
  const chain = o.chains?.[o.projectId]
  const wheel = chain?.on ? chain : undefined
  const real = (a: Agent) => a.identity?.hasLogin !== false || a.sessions.length > 0
  // EV182 (the user, 15-11 03:11: «si te escribo directamente sí deberías activarte aun que estés apartada/parada»): the
  // one the user named takes it even set aside, kept for another project or with no window open (the notes to Claude 5
  // of 03:10 waited until he opened it by hand); never one gone, out of usage, or with no login.
  const named = (a: Agent) => a.id === o.target && real(a) && excluded[a.id] !== 'baja' && a.state !== 'baja' && a.state !== 'sin-uso'
  const parked = (a: Agent) => Boolean(excluded[a.id]) || a.state === 'apartada' || (o.reserves ?? []).some((r) => r.on && r.account === a.id && r.projectId !== o.projectId)
  const usable = (a: Agent) => (o.target ? named(a) : real(a) && !excluded[a.id] && !CANNOT.has(a.state))
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

  // EV178 (the user, 14-11 19:45: «los mensajes de "para todos los claude"… quedan a la espera, deberían entrar al momento
  // y considerar cuándo deberían hacerse o quién, más que esperar a un relevo»): a note for everyone goes to every Claude
  // at work, in this project or another, after its next step; each one judges whether it is its own and when. Reading
  // it touches nothing, so a wheel here does not hold it back.
  const working = (a: Agent) => a.sessions.some((s) => isSessionWorking(s) && !s.rateLimited && !s.noCredit)
  if (!o.target) {
    const all = o.agents.filter((a) => usable(a) && working(a)).sort(order).map((a) => a.id)
    if (all.length) return { kind: 'todos', accounts: all }
  }

  // 2. Someone at work here (or waiting on a question): after its next step.
  const busy = here.filter((a) => inProject(a).some((s) => isSessionWorking(s) && !s.rateLimited && !s.noCredit)).sort(order)[0]
  if (busy) return { kind: 'paso', account: busy.id }

  // EV182: to someone by name, with nothing of it here. At work in another project: it reads it there after its next
  // step (notesForAll). If not, it is opened here: for this note only when it is set aside, like any free one when not.
  // Not one of this project's wheel out of its turn (its hook would stop it before it did anything).
  if (o.target) {
    const n = o.target.slice(6)
    const who = o.agents.find((a) => a.id === o.target)
    const outOfTurn = Boolean(who && wheel && wheel.order.includes(who.id) && who.id !== wheel.holder && who.id !== wheel.partner)
    if (who && named(who)) {
      if (working(who)) return { kind: 'paso', account: who.id }
      if (!outOfTurn) return parked(who) ? { kind: 'solo', account: who.id } : { kind: 'abrir', account: who.id }
    }
    const why = !who ? t('esa cuenta no está en este PC')
      : excluded[who.id] === 'baja' || who.state === 'baja' ? t('Claude {n} está de baja', { n })
      : who.state === 'sin-uso' ? t('Claude {n} no tiene uso ahora; la leerá al volver', { n })
      : !real(who) ? t('Claude {n} no tiene la sesión iniciada en este PC', { n })
      : outOfTurn && wheel?.holder ? t('la rueda de relevos tiene el turno en Claude {h}; Claude {n} la leerá cuando le toque', { h: wheel.holder.slice(6), n })
      : t('Claude {n} está en otro proyecto; la leerá al entrar en este', { n })
    return { kind: 'espera', why }
  }

  // 3. Nobody here: a free account opens in the project. Not one that belongs to another project's wheel (it would miss
  // its turn there, EV153), not while this project has its own wheel (it opens whoever has the turn), and not one busy elsewhere.
  if (wheel) return { kind: 'espera', why: wheel.holder ? t('la rueda de relevos la dará a quien tenga el turno (Claude {n})', { n: wheel.holder.slice(6) }) : t('la rueda de relevos la dará a quien tenga el turno') }
  const otherWheels = Object.entries(o.chains ?? {}).filter(([pid, c]) => pid !== o.projectId && c?.on).flatMap(([, c]) => c!.order)
  const free = here
    .filter((a) => a.state === 'disponible' && !a.sessions.some((s) => isSessionWorking(s)) && !otherWheels.includes(a.id))
    .sort(order)[0]
  if (free) return { kind: 'abrir', account: free.id }
  return { kind: 'espera', why: t('no hay ningún Claude libre con uso; la leerá el primero que entre') }
}

/**
 * EV182 (the user, 15-11 03:12, MC-276: «seguir estando parada cuando termines la tarea… no deberías entrar en el
 * relevo»): an account the user set aside («No usar», «de baja») or kept as another project's backup. It does what the user
 * writes to it, and then it stops: autonomous mode does not keep it going and it is not offered the queue.
 */
export function parkedAccount(db: DB, account: string, projectId?: string): boolean {
  try {
    const ui = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as { value?: string } | undefined)?.value ?? '{}')
    const reserves = ((Array.isArray(ui.reserves) ? ui.reserves : []) as { account?: string; projectId?: string; on?: boolean }[]).filter((r) => r?.on && r.account === account)
    // «En los tiempos muertos», on, in this project: there it works like any other, even set to «No usar» (the user,
    // 15-11 03:50: «aunque ese claude esté en modo de no usar, sí se activará»); only «de baja» stops it.
    if (projectId && ui.accountStatus?.[account] !== 'baja' && reserves.some((r) => r.projectId === projectId)) return false
    if (ui.accountStatus?.[account]) return true
    return reserves.length > 0
  } catch { return false }
}

// ---- notes for everyone (EV178) ----------------------------------------------------------------------------------------

/** How long a note for everyone keeps reaching the Claudes that start working after it was sent. */
export const FOR_ALL_MS = 4 * 3600_000

export interface ForAllNote { id: number; projectId: string; projectName: string; body: string; createdAt: number; target?: AccountId }

/**
 * Notes «para todos» (nobody named) that this account has not had yet, from any project, sent in the last hours. Each
 * account gets each one once: what it read (or had typed into its window) is in the timeline under the note's mark.
 * EV182: and the ones written to this account by name in another project than `hereId` (where it is working now): the
 * user wrote to it, so it reads them wherever it is instead of waiting to go there.
 */
export function notesForAll(db: DB, account: AccountId, now = Date.now(), hereId = ''): ForAllNote[] {
  const rows = db.prepare(`SELECT i.id, i.project_id, i.body, i.created_at, i.target FROM instructions i
    WHERE i.kind = 'general' AND (i.target IS NULL OR (i.target = ? AND i.project_id <> ?)) AND i.comment_id IS NULL AND i.created_at > ?
      AND i.status NOT IN ('anulada', 'fallida', 'ejecutada') AND COALESCE(i.channel, '') <> 'ventana ' || ?
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.project_id = i.project_id AND e.at >= i.created_at AND e.ref = 'ins:' || i.id
        AND e.account = ? AND e.kind IN ('recibida', 'entrega'))
    ORDER BY i.created_at LIMIT 8`).all(account, hereId, now - FOR_ALL_MS, account, account) as { id: number; project_id: string; body: string; created_at: number; target: string | null }[]
  const name = db.prepare('SELECT config FROM projects WHERE id = ?')
  return rows.map((r) => {
    let projectName = r.project_id
    try { projectName = JSON.parse((name.get(r.project_id) as { config: string }).config).name ?? r.project_id } catch { /* its id */ }
    return { id: r.id, projectId: r.project_id, projectName, body: r.body, createdAt: r.created_at, ...(r.target ? { target: r.target as AccountId } : {}) }
  })
}

/** They reached this account: the first one to read a note marks it read; every reader is in the timeline. */
export function markForAll(db: DB, notes: ForAllNote[], account: AccountId, source: string, now = Date.now()): void {
  const first = db.prepare("UPDATE instructions SET status = 'recibida', channel = COALESCE(channel, ?), delivered_at = COALESCE(delivered_at, ?), updated_at = ? WHERE id = ? AND status IN ('guardada', 'pendiente-entrega', 'entregada')")
  for (const n of notes) {
    first.run(n.target ? 'en otro proyecto' : 'para todos', now, now, n.id)
    addEvent(db, { projectId: n.projectId, at: now, account, kind: 'recibida', title: t('Claude {v0} ha recibido: «{v1}»', { v0: account.slice(6), v1: n.body.slice(0, 100) }), source, ref: `ins:${n.id}` })
  }
}

/** What a Claude reads of them: where and when each was written, and that it decides whether it is its own. */
export function forAllText(hereId: string, all: ForAllNote[]): string[] {
  if (!all.length) return []
  const hm = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  // EV182: written to this Claude by name, in another project: its own, to do there (or file there) after this step.
  const mine = all.filter((n) => n.target)
  const notes = all.filter((n) => !n.target)
  const toMe = mine.length ? [
    t('Mission Control: el usuario te ha escrito a ti desde otro proyecto. Cierra el paso en el que estás sin dejar nada roto y hazlo allí (rutas absolutas de ese proyecto y pmc desde su carpeta); si no puedes ahora, apúntalo en el docs/TASKS.md de ese proyecto con su marca (MC-…) en la línea.'),
    ...mine.map((n) => t('- [{hm}, en {name}] {body} (MC-{id})', { hm: hm(n.createdAt), name: n.projectName, body: n.body.replace(/\s*\r?\n\s*/g, ' ').trim(), id: n.id }))
  ] : []
  if (!notes.length) return toMe
  return [
    ...toMe,
    t('Mission Control: el usuario ha escrito {what} para todos los Claude. Te llega ahora, estés en el proyecto que estés: decide tú si te toca, a quién y cuándo (ya, al cerrar el paso en el que estás o al pasar a otro proyecto). Si es para otra cuenta o de otro proyecto, no lo hagas tú: tenlo en cuenta. Si ya está hecho o se ha quedado viejo, nada. Si te toca algo que no puedes hacer ahora, apúntalo en el docs/TASKS.md del proyecto que sea, con su marca (MC-…) en la línea.', { what: notes.length === 1 ? t('esto') : t('estas cosas') }),
    ...notes.map((n) => t('- [{hm}, {where}] {body} (MC-{id})', { hm: hm(n.createdAt), where: n.projectId === hereId ? t('en este proyecto') : t('escrito en {name}', { name: n.projectName }), body: n.body.replace(/\s*\r?\n\s*/g, ' ').trim(), id: n.id }))
  ]
}

/** What is typed into the window: one line (the console sends on Enter), with the mark that links it to its task. */
export function typedNoteText(projectName: string, id: number, body: string): string {
  return t('Mission Control · nota del usuario para {project} (MC-{id}): «{body}». ', { project: projectName, id, body: body.replace(/\s*\r?\n\s*/g, ' ').trim() }) +
    t('Si estabas con algo, ciérralo antes sin dejar nada roto. Apúntala en docs/TASKS.md donde le toque (su sección, su prioridad y la cuenta que mejor encaje), ') +
    t('con la marca (MC-{id}) en su línea para que el usuario vea en la app que está apuntada, y hazla si te toca a ti por prioridad; si no, sigue con lo tuyo.', { id })
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
  /** EV178: everyone who has read it, first first (a note for everyone reaches each Claude at work). */
  readers?: AccountId[]
  /** The task a Claude filed it as (its line in TASKS.md carries «MC-<id>»). */
  task?: { id: string; done: boolean; owner?: string }
}

/** What the user wrote to the Claudes lately (not the app's own messages, nor notes on images), newest first. */
export function sentNotes(db: DB, projectId: string, since: number, limit = 6): SentNote[] {
  const rows = db.prepare(`SELECT id, body, target, status, channel, created_at, delivered_at, updated_at, error FROM instructions
    WHERE project_id = ? AND kind IN ('general', 'tarea') AND comment_id IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, since, limit) as any[]
  const readBy = db.prepare("SELECT account FROM events WHERE ref = ? AND kind = 'recibida' AND account IS NOT NULL ORDER BY at DESC LIMIT 1")
  const readAll = db.prepare("SELECT account FROM events WHERE project_id = ? AND at >= ? AND ref = ? AND kind = 'recibida' AND account IS NOT NULL GROUP BY account ORDER BY MIN(at)")
  const find = db.prepare("SELECT COALESCE(ext_id, key) AS id, COALESCE(override, status) AS st, owner, title, detail FROM tasks WHERE project_id = ? AND gone = 0 AND (title LIKE ? OR detail LIKE ?) LIMIT 5")
  return rows.map((r) => {
    const tag = `MC-${r.id}`
    const exact = new RegExp(`\\b${tag}\\b(?!\\d)`)
    const t = (find.all(projectId, `%${tag}%`, `%${tag}%`) as any[]).find((x) => exact.test(`${x.title} ${x.detail}`))
    const via = /^(?:ventana|abriendo) (claude\d+)$/.exec(r.channel ?? '')?.[1]
    const reader = (r.status === 'recibida' ? (readBy.get(`ins:${r.id}`) as { account?: string } | undefined)?.account : undefined) ?? via ?? (r.status === 'recibida' ? r.target : undefined)
    const readers = r.target ? [] : (readAll.all(projectId, r.created_at, `ins:${r.id}`) as { account: AccountId }[]).map((x) => x.account)
    return {
      id: r.id, body: r.body, target: r.target ?? undefined, status: r.status, channel: r.channel ?? undefined, reader: (reader ?? undefined) as AccountId | undefined,
      readers: readers.length ? readers : undefined,
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
  if (n.status === 'recibida') return { tone: 'leida', text: t('Leída por {who} a las {hm}', { who: n.readers && n.readers.length > 1 ? namesList(n.readers.map((a) => who(a))) : who(n.readers?.[0] ?? n.reader), hm: hm(n.deliveredAt ?? n.updatedAt) }) }
  if (n.status === 'entregada' && n.channel?.startsWith('ventana')) return { tone: 'enviada', text: t('Escrita en la ventana de {who} a las {hm}; la está leyendo', { who: who(n.reader), hm: hm(n.deliveredAt) }) }
  if (n.status === 'entregada') return { tone: 'enviada', text: t('Escrita en el Buzón del proyecto') }
  if (n.status === 'pendiente-entrega' && n.channel?.startsWith('abriendo')) return { tone: 'enviada', text: t('Abriendo a {who} para dársela', { who: who(n.reader) }) }
  if (route?.kind === 'paso') return { tone: 'espera', text: t('En cola: {who} la leerá al acabar su paso', { who: who(route.account) }) }
  if (route?.kind === 'ventana') return { tone: 'espera', text: t('Enviando a {who}…', { who: who(route.account) }) }
  if (route?.kind === 'solo' || route?.kind === 'abrir') return { tone: 'espera', text: t('Abriendo a {who} para dársela…', { who: who(route.account) }) }
  if (route?.kind === 'todos') return { tone: 'espera', text: t('Para todos: la leerán {who} al acabar su paso, estén en el proyecto que estén', { who: namesList(route.accounts.map((a) => who(a))) }) }
  if (route?.kind === 'espera') return { tone: 'espera', text: t('En espera: {why}', { why: route.why }) }
  return { tone: 'espera', text: t('En espera: la leerá el primer Claude que trabaje aquí') }
}
