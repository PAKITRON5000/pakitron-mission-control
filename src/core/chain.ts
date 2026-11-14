// The relay wheel («rueda de relevos», the user, 12-11 at 23:40): per project, an order of accounts chosen by the user,
// for example Claude 3 → Claude 1 → Claude 6 → back to Claude 3. Only the one holding the turn works on the project; when
// it runs out of usage, the next one in the wheel that has usage takes over exactly where it was left («pmc relevo»),
// and so on round the wheel. If none has usage, the turn waits and goes to the first one that gets it back. One that
// comes back while another holds the turn waits for its own («que no se pisen y trabajen en cadena»).
//
// Everything here is the decision, with no node imports: the screens use it to say what will happen, the app
// (main/index.ts › chainTick) carries it out, and the hooks (`pmc hook`, `pmc turno`) read the turn from turns.json.
import type { AccountId, AgentState } from './types'

export interface RelayChain {
  on: boolean
  /** The wheel, in the order the user chose; after the last one it goes back to the first. */
  order: AccountId[]
  /** Who holds the turn now (it may be out of usage while the turn waits). */
  holder?: AccountId
  /** When it got the turn. */
  since?: number
  /** 'trabaja': the holder is on it. 'espera': it ran out and nobody in the wheel has usage; the first one back takes it. */
  phase?: 'trabaja' | 'espera'
  /** When the turn passes: when the holder is cut by its limit, or already when it ends a turn above 95 %. */
  passAt?: 'agotada' | 'casi'
  /** Kept in the wheel but skipped until the user lets them back. */
  paused?: AccountId[]
  /** The last hand-off, for the screen. */
  last?: { from?: AccountId; to: AccountId; at: number; why: string }
  /**
   * The wheel's agenda (the user, 13-11: «trabajad primero en la app hasta que esté completamente lista y luego seguís con
   * The game project»): the wheel works here on the open tasks of the TASKS.md sections whose title contains `section`; when
   * none is left, it moves on, with the same accounts and the same turn, to project `next`.
   */
  until?: { section: string; next?: string }
  /** EV89: hand over before the cut: the next one takes the big tasks while the one running out finishes small ones. */
  overlap?: boolean
  /** The one running out that keeps on small tasks while the new holder takes the big ones. */
  outgoing?: AccountId
  /**
   * EV152 (the user, 14-11 04:50: «prioridad el resto de claude activos al the game project máxima potencia»): two at once. While
   * another account of the wheel has usage it works as `partner`, on what needs no shared resource (code, tests, documents),
   * and the holder keeps the heavy work (Unity, the GPU). Off unless the user turns it on.
   */
  pair?: boolean
  /** The account working at the same time as the holder (EV152). */
  partner?: AccountId
}

/**
 * From this share of the 5 hours, this share of the week, or this few minutes left, the turn is handed over with overlap.
 * The week has its own, higher mark: 10 % of a week is still hours of work, and overlapping that early would keep two
 * accounts on the same project for half a day.
 */
export const OVERLAP_AT_PCT = 90
export const OVERLAP_WEEK_PCT = 97
export const OVERLAP_MINUTES = 20

/** The holder is about to run out (EV89). */
export function overlapDue(m: Pick<ChainMember, 'fiveUsed' | 'weekUsed' | 'minutesLeft'>): boolean {
  return (m.fiveUsed ?? 0) >= OVERLAP_AT_PCT || (m.weekUsed ?? 0) >= OVERLAP_WEEK_PCT || (m.minutesLeft != null && m.minutesLeft <= OVERLAP_MINUTES)
}

/** Whether the agenda of a wheel is done: its section has tasks and none is open (a section not found never counts as done). */
export function agendaDone(until: RelayChain['until'], tasks: { section?: string; open: boolean; blocked?: boolean }[], opts: { skipBlocked?: boolean } = {}): boolean {
  if (!until?.section) return false
  const key = until.section.toLowerCase()
  const mine = tasks.filter((t) => (t.section ?? '').toLowerCase().includes(key))
  // EV148: a blocked one waits for something real (a recharge, a Fable limit), not for the wheel; with skipBlocked it
  // does not hold the agenda (14-11: EV101 and EV120 kept Mission Control's wheel from ever moving to the game project).
  return mine.length > 0 && !mine.some((t) => t.open && !(opts.skipBlocked && t.blocked))
}

/** EV148: the agenda's blocked tasks left behind when the wheel moves on, to name them. */
export function agendaBlocked(until: RelayChain['until'], tasks: { section?: string; open: boolean; blocked?: boolean; id?: string }[]): string[] {
  if (!until?.section) return []
  const key = until.section.toLowerCase()
  return tasks.filter((t) => t.open && t.blocked && (t.section ?? '').toLowerCase().includes(key)).map((t) => t.id ?? '').filter(Boolean)
}

/** The project whose wheel (on) has this account, if any: an account in a wheel belongs to that wheel's project. */
export function wheelProjectOf(file: TurnFile | undefined, account: AccountId): string | undefined {
  return file?.projects.find((p) => p.members.includes(account))?.id
}

/** What the wheel needs to know about an account right now. */
export interface ChainMember {
  id: AccountId
  state: AgentState
  hasLogin: boolean
  /** «No usar» or «De baja» in Ajustes. */
  status?: 'pausada' | 'baja'
  /** Share of its 5 hours / week used, from a current reading (undefined: none, or that window is over). */
  fiveUsed?: number
  weekUsed?: number
  /** When its usage comes back, if it is out. */
  backAt?: number
  /** It has a conversation at work on this project now. */
  workingHere: boolean
  /** The project it is at work on, when that is another one. */
  workingElsewhere?: string
  /** When it last did anything (any session); undefined: unknown. */
  lastActiveAt?: number
  /** Minutes left at its pace (an estimate), when known. */
  minutesLeft?: number
}

/** A holder with usage that has done nothing for this long is called to go on (13-11: the turn sat with an idle holder). */
export const IDLE_HOLDER_MS = 8 * 60_000

/** Above this share used an account is about to stop again: it is not given the turn. */
export const CHAIN_FULL_PCT = 95

export type MemberStatus = 'turno' | 'lista' | 'sin-uso' | 'pausa' | 'fuera' | 'ocupada'

export interface MemberView {
  id: AccountId
  status: MemberStatus
  /** One short sentence for the screen. */
  text: string
  backAt?: number
}

const who = (id: string) => `Claude ${id.slice(6)}`
const usedTop = (m: ChainMember) => Math.max(m.fiveUsed ?? 0, m.weekUsed ?? 0)

/** Why an account cannot take the turn now; undefined when it can. */
export function cannotTake(m: ChainMember | undefined, chain: Pick<RelayChain, 'paused'>): string | undefined {
  if (!m) return 'ya no es una cuenta de Mission Control'
  if (m.status === 'baja') return 'de baja'
  if (m.status === 'pausada') return 'apartada («No usar»)'
  if (chain.paused?.includes(m.id)) return 'en pausa en la rueda'
  if (m.state === 'sin-uso') return 'sin uso'
  if (!m.hasLogin) return 'sin sesión iniciada en su carpeta'
  if (usedTop(m) >= CHAIN_FULL_PCT) return `al ${Math.round(usedTop(m))} % de su uso`
  if (m.workingElsewhere) return `trabajando en otro proyecto (${m.workingElsewhere})`
  return undefined
}

/** The holder can no longer go on: the turn must pass. */
export function holderOut(m: ChainMember | undefined, chain: RelayChain): boolean {
  if (!m) return true
  if (m.status || chain.paused?.includes(m.id) || m.state === 'sin-uso') return true
  // Ending a turn nearly empty: with «casi» the next one starts now rather than after the cut.
  return chain.passAt === 'casi' && !m.workingHere && usedTop(m) >= CHAIN_FULL_PCT
}

/** The wheel starting after `from` and going round once (`from` itself last, so it can take its own turn back). */
export function rotation(order: AccountId[], from?: AccountId): AccountId[] {
  const i = from ? order.indexOf(from) : -1
  if (i < 0) return [...order]
  return [...order.slice(i + 1), ...order.slice(0, i + 1)]
}

export type ChainAction =
  /** The turn goes to `to`: it is told in its window (or opened) to take over from `from`. `to === from`: it is back. */
  | { kind: 'pasar'; from?: AccountId; to: AccountId; why: string; adopt?: boolean }
  /** Nobody in the wheel has usage: the turn waits for the first one back. */
  | { kind: 'esperar'; from?: AccountId; firstBack?: AccountId; backAt?: number; why: string }
  /** An account of the wheel is at work on the project out of its turn: it is told to save and wait. */
  | { kind: 'frenar'; account: AccountId; holder: AccountId }
  /** The holder has usage but has been idle a while (it ended its turn, or its window closed): it is called to go on. */
  | { kind: 'despertar'; account: AccountId }
  /** EV89: the holder is about to run out: the next takes the turn now and the big tasks; the holder goes on with small ones. */
  | { kind: 'solapar'; from: AccountId; to: AccountId }
  /** The one that was finishing small tasks has run out: its overlap is over. */
  | { kind: 'fin-solape'; account: AccountId; holder?: AccountId }
  /** EV152: `to` starts working at the same time as the holder, on what needs no shared resource. */
  | { kind: 'pareja'; to: AccountId; holder: AccountId }
  /** EV152: the partner stops being one (out of usage, set aside, or it took the turn itself). */
  | { kind: 'fin-pareja'; account: AccountId; why: string }

/**
 * One step of the wheel. Called every minute and when an account stops; it only returns what has to change.
 * `members` holds every account of the wheel that Mission Control knows.
 */
export function chainStep(chain: RelayChain, members: ChainMember[], now = Date.now()): ChainAction[] {
  if (!chain.on || !chain.order.length) return []
  const get = (id?: AccountId) => (id ? members.find((m) => m.id === id) : undefined)
  const inWheel = chain.order.map(get).filter((m): m is ChainMember => Boolean(m))
  const holder = get(chain.holder)
  const actions: ChainAction[] = []
  let current = chain.holder
  const free = (m: ChainMember) => !cannotTake(m, chain)

  if (!holder || holderOut(holder, chain)) {
    // One that is already at work here and has usage goes first (it came back by itself): it keeps going, now as holder.
    const busy = rotation(chain.order, chain.holder).map(get).find((m) => m && m.id !== chain.holder && m.workingHere && free(m))
    const next = busy ?? rotation(chain.order, chain.holder).map(get).find((m) => m && free(m))
    if (next) {
      const why = !chain.holder ? 'empieza la rueda'
        : next.id === chain.holder ? `${who(next.id)} ha recuperado su uso y sigue ella`
        : `${who(chain.holder)} ${holder?.state === 'sin-uso' ? 'se ha quedado sin uso' : `no puede seguir (${cannotTake(holder, chain) ?? 'casi sin uso'})`}`
      actions.push({ kind: 'pasar', from: chain.holder, to: next.id, why, adopt: next.workingHere || undefined })
      current = next.id
    } else if (chain.phase !== 'espera') {
      const back = inWheel.filter((m) => !m.status && !chain.paused?.includes(m.id) && m.backAt && m.backAt > now)
        .sort((a, b) => a.backAt! - b.backAt! || chain.order.indexOf(a.id) - chain.order.indexOf(b.id))[0]
      actions.push({ kind: 'esperar', from: chain.holder, firstBack: back?.id, backAt: back?.backAt, why: `nadie de la rueda tiene uso ahora (${inWheel.map((m) => `${who(m.id)} ${cannotTake(m, chain) ?? 'lista'}`).join('; ')})` })
      current = undefined
    } else current = undefined
  } else if (chain.phase === 'espera') {
    // The holder itself got its usage back first: the turn is its own again.
    actions.push({ kind: 'pasar', from: chain.holder, to: holder.id, why: `${who(holder.id)} ha recuperado su uso y sigue ella`, adopt: holder.workingHere || undefined })
  } else if (chain.overlap !== false && !chain.outgoing && holder.workingHere && overlapDue(holder)) {
    const next = rotation(chain.order, chain.holder).map(get).find((m) => m && m.id !== holder.id && free(m))
    if (next) { actions.push({ kind: 'solapar', from: holder.id, to: next.id }); current = next.id }
  } else if (!holder.workingHere && holder.state !== 'esperando' && !holder.workingElsewhere && now - Math.max(chain.since ?? 0, holder.lastActiveAt ?? 0) > IDLE_HOLDER_MS) {
    // It has the turn and usage but does nothing: without this, nobody would work until the user noticed.
    actions.push({ kind: 'despertar', account: holder.id })
  }

  // The overlap ends when the one finishing small tasks runs out.
  const out = get(chain.outgoing)
  if (chain.outgoing && (!out || out.state === 'sin-uso')) actions.push({ kind: 'fin-solape', account: chain.outgoing, holder: current })
  const outgoing = actions.find((a) => a.kind === 'solapar')?.['from' as never] as AccountId | undefined ?? chain.outgoing
  // EV152: the partner. It stops being one when it cannot work or took the turn; a new one is the next free account in the
  // wheel (never during an overlap, which already has two at work).
  let partner = chain.partner
  if (partner) {
    const pm = get(partner)
    const why = !chain.pair ? 'la rueda ya no trabaja de dos en dos' : partner === current ? `${who(partner)} tiene ahora el turno` : pm ? cannotTake(pm, chain) : 'ya no es una cuenta de Mission Control'
    if (why || !current) { actions.push({ kind: 'fin-pareja', account: partner, why: why ?? 'la rueda espera' }); partner = undefined }
  }
  if (chain.pair && current && !partner && !outgoing) {
    const mate = rotation(chain.order, current).map(get).find((m) => m && m.id !== current && free(m))
    if (mate) { actions.push({ kind: 'pareja', to: mate.id, holder: current }); partner = mate.id }
  }
  // Anyone else of the wheel at work here out of turn is told to wait (never the one just given the turn, nor the one
  // finishing small tasks in an overlap, nor the partner).
  if (current) for (const m of inWheel) if (m.id !== current && m.id !== outgoing && m.id !== partner && m.workingHere && m.state !== 'sin-uso') actions.push({ kind: 'frenar', account: m.id, holder: current })
  return actions
}

/** What the screen says about each account of the wheel. */
export function memberViews(chain: RelayChain, members: ChainMember[], now = Date.now()): MemberView[] {
  return chain.order.map((id) => {
    const m = members.find((x) => x.id === id)
    if (!m) return { id, status: 'fuera' as const, text: 'Ya no es una cuenta de Mission Control' }
    const isHolder = chain.holder === id
    const back = m.backAt && m.backAt > now ? m.backAt : undefined
    if (m.status) return { id, status: 'fuera', text: m.status === 'baja' ? 'De baja: se salta' : 'Apartada («No usar»): se salta' }
    if (chain.paused?.includes(id)) return { id, status: 'pausa', text: 'En pausa: se salta hasta que la reactives', backAt: back }
    if (m.state === 'sin-uso') return { id, status: 'sin-uso', text: isHolder ? 'Tenía el turno y se ha quedado sin uso' : 'Sin uso', backAt: back }
    if (isHolder && chain.on) return { id, status: 'turno', text: m.workingHere ? 'Tiene el turno y está trabajando' : 'Tiene el turno' }
    // EV152: the partner works at the same time, on what needs no shared resource.
    if (chain.on && chain.pair && chain.partner === id) return { id, status: 'turno', text: 'Trabaja a la vez (sin Unity ni la gráfica)' }
    if (m.workingElsewhere) return { id, status: 'ocupada', text: `Trabajando en otro proyecto (${m.workingElsewhere})` }
    const why = cannotTake(m, chain)
    if (why) return { id, status: 'sin-uso', text: why[0].toUpperCase() + why.slice(1), backAt: back }
    return { id, status: 'lista', text: chain.on ? 'Con uso: espera su turno' : 'Con uso' }
  })
}

/** Who would take the turn if the holder ran out now, and when. */
export function nextInLine(chain: RelayChain, members: ChainMember[], now = Date.now()): { id: AccountId; at?: number } | undefined {
  const get = (id: AccountId) => members.find((m) => m.id === id)
  const order = rotation(chain.order, chain.holder).filter((id) => id !== chain.holder)
  const ready = order.find((id) => !cannotTake(get(id), chain))
  if (ready) return { id: ready }
  const back = order.map(get).filter((m): m is ChainMember => Boolean(m && !m.status && !chain.paused?.includes(m.id) && m.backAt && m.backAt > now))
    .sort((a, b) => a.backAt! - b.backAt! || chain.order.indexOf(a.id) - chain.order.indexOf(b.id))[0]
  return back ? { id: back.id, at: back.backAt } : undefined
}

/** An account can be in only one wheel that is on: the projects whose active wheel already has it. */
export function wheelsOf(chains: Record<string, RelayChain | undefined>, account: AccountId, except?: string): string[] {
  return Object.entries(chains).filter(([pid, c]) => pid !== except && c?.on && c.order.includes(account)).map(([pid]) => pid)
}

// ---- the turn as the hooks see it (turns.json, written by the app) ------------------------------------------------------

export interface TurnFile {
  at: number
  projects: { id: string; name: string; roots: string[]; holder?: AccountId; phase?: 'trabaja' | 'espera'; members: AccountId[]; /** The agenda's section: the holder's next tasks come from it. */ section?: string; /** EV89: also allowed to work, on small tasks. */ outgoing?: AccountId; /** EV152: also allowed to work, on what needs no shared resource. */ partner?: AccountId }[]
}

export type TurnAnswer = { inWheel: false } | { inWheel: true; mine: boolean; holder?: AccountId; project: string; projectId: string; members: AccountId[]; /** Finishing small things in the overlap, the turn already given to another. */ outgoing?: boolean; /** EV152: working at the same time as the holder. */ partner?: boolean }

/** Whether `account`, working in `cwd`, holds the turn there. Outside any wheel, or with the turn waiting, it may work. */
export function turnFor(file: TurnFile | undefined, account: AccountId, cwd: string): TurnAnswer {
  if (!file || !cwd) return { inWheel: false }
  const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  const c = norm(cwd)
  const hit = file.projects
    .flatMap((p) => p.roots.map((r) => ({ p, r: norm(r) })))
    .filter((x) => x.r.length > 3 && (c === x.r || c.startsWith(x.r + '\\')))
    .sort((a, b) => b.r.length - a.r.length)[0]
  if (!hit || !hit.p.members.includes(account)) return { inWheel: false }
  const p = hit.p
  const mine = !p.holder || p.holder === account || p.phase === 'espera' || p.outgoing === account || p.partner === account
  return { inWheel: true, mine, holder: p.holder, project: p.name, projectId: p.id, members: p.members, outgoing: p.outgoing === account && p.holder !== account, ...(p.partner === account && p.holder !== account ? { partner: true } : {}) }
}

/** What a session told to wait reads (in its window, in the PreToolUse refusal and at SessionStart). */
export function waitTurnText(account: AccountId, holder: AccountId, project: string): string {
  return `Mission Control · rueda de relevos de ${project}: ahora tiene el turno ${who(holder)}, y ${who(account)} espera el suyo para no pisarse. Si has cambiado algo, guárdalo (pmc guarda «qué queda») y termina tu turno sin empezar nada nuevo: te escribiré en este chat cuando te toque. Si el usuario te ha pedido algo expresamente, dile que puede darte el turno en Mission Control › Relevos.`
}

/** EV152: what the partner reads when it starts working at the same time as the holder. */
export function partnerText(a: { to: AccountId; holder: AccountId; project: string }): string {
  return `Mission Control · rueda de relevos de ${a.project}: trabajas a la vez que ${who(a.holder)}, que tiene el turno y se queda con lo pesado (Unity, la gráfica, compilar el juego). Tú coge las tareas que no lo necesiten (código, pruebas, documentos, guiones), en archivos distintos de los suyos (mira git status y pmc claims), reserva cada una con pmc claim y no lances nada pesado sin pmc recurso. Ejecuta pmc parte y trabaja sin parar hasta que te quedes sin uso; guarda con pmc guarda al cerrar cada bloque.`
}

/** What the account given the turn reads. */
export function takeTurnText(a: { from?: AccountId; to: AccountId; project: string; after?: AccountId; fableLost?: boolean }): string {
  const tail = `Trabaja sin parar hasta que te quedes sin uso${a.after && a.after !== a.to ? `; entonces seguirá ${who(a.after)}` : ''}. Pon al día el relevo al cerrar cada bloque (pmc guarda).`
  if (!a.from) return `Mission Control · rueda de relevos de ${a.project}: te toca empezar. Ejecuta pmc parte y sigue con lo pendiente, primero lo que otras cuentas dejaron a medias (pmc relevo <cuenta>). ${tail}`
  if (a.from === a.to) return `Mission Control · rueda de relevos de ${a.project}: ya tienes uso otra vez y el turno vuelve a ser tuyo. Sigue tu trabajo donde lo dejaste, sin repetir lo hecho (pmc parte). ${tail}`
  return [
    `Mission Control · rueda de relevos de ${a.project}: ${who(a.from)} se ha quedado sin uso y te toca a ti.`,
    `Ejecuta pmc relevo ${a.from} y pmc parte, y sigue su trabajo exactamente donde lo dejó, sin repetir lo hecho, hasta cerrar sus tareas pendientes; luego las tuyas.`,
    a.fableLost ? 'Su trabajo iba con Fable y tú no lo tienes: haz las tareas que tu modelo pueda y deja el resto apuntado en el relevo.' : '',
    tail
  ].filter(Boolean).join(' ')
}
