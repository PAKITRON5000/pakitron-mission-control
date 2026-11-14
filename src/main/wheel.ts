// The relay wheel, carried out (core/chain.ts decides). Every minute and whenever an account stops: who holds each
// project's turn, telling the next one in its window (or opening it) when the turn passes, telling one that works out
// of turn to wait, and writing turns.json so the hooks of every window know whose turn it is.
import { writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Service } from './service'
import type { AccountId, ProjectConfig } from '../core/types'
import { addEvent } from '../core/db'
import { duplicateWindowsToClose, idleBackgroundToStop, idleWindowsToClose } from '../core/tidy'
import { paths } from '../core/paths'
import { isSessionWorking } from '../core/working'
import { addNotice, nextTasks } from '../core/coord'
import { bgResumeArgs, bgStartArgs } from '../core/bgsessions'
import { agendaBlocked, agendaDone, chainStep, partnerText, nextInLine, takeTurnText, waitTurnText, type ChainMember, type RelayChain, type TurnFile } from '../core/chain'

export interface WheelDeps {
  service: Service
  openTerminal: (account: AccountId, cwd: string, args: string[], title: string) => void
  /** EV141: with «Sin ventanas» on, a turn opened as a background session (`claude --bg`), or one stopped given a new instruction. */
  openBackground?: (account: AccountId, cwd: string, args: string[]) => Promise<void>
  /** EV141: stops a background session (`claude stop`); its conversation stays saved. */
  stopBackground?: (account: AccountId, shortId: string) => Promise<void>
  typeText: (pid: number, text: string) => Promise<void>
  /** Sessions opened before their account's hooks were updated: they must be reopened, not typed into. */
  staleWindows: () => { sessionId: string }[]
  reopenWindow: (account: AccountId, sessionId: string, prompt?: string) => Promise<unknown>
  workCopy: (p: ProjectConfig) => { path: string; label: string } | undefined
  /** When the app last opened each account by itself (shared with the dispatcher). */
  lastOpened: Record<string, number | undefined>
  /** Closes a window the app opened (never one the user opened by hand); true when it was closed. */
  closeIdleWindow: (pid: number, byHandToo: boolean) => Promise<boolean>
}


/** One reminder to wait per account and this long at most. */
const BRAKE_EVERY_MS = 20 * 60_000
/** A holder idle with usage is called again at most this often. */
const WAKE_EVERY_MS = 15 * 60_000
/** Do not open the same account twice while its window starts. */
const OPEN_COOLDOWN_MS = 10 * 60_000
/** EV148: blocked tasks (waiting for something real) do not hold the agenda (Decidir #150, the user, 14-11 01:03: «Sí, the game project»). */
const AGENDA_SKIPS_BLOCKED = true

const who = (id: string) => `Claude ${id.slice(6)}`
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

export function createWheel(d: WheelDeps) {
  const { service } = d
  const braked = new Map<string, number>()
  /** When each holder was last called to go on: at most once per this long, so a window that cannot go on is not flooded. */
  const woken = new Map<string, number>()
  let running = false

  const chains = (): Record<string, RelayChain | undefined> => service.settings.relayChains ?? {}

  function save(projectId: string, next: RelayChain | undefined): void {
    service.setSettings({ relayChains: { ...chains(), [projectId]: next } })
    writeTurns()
  }

  /** What the wheel of `projectId` needs to know about every account. */
  function members(projectId: string): ChainMember[] {
    const now = Date.now()
    const s = service.settings
    return service.agents.map((a) => {
      const f = a.usage.snapshot?.fiveHour
      const w = a.usage.snapshot?.sevenDay
      const working = a.sessions.filter((x) => isSessionWorking(x) && x.projectId)
      const elsewhere = working.find((x) => x.projectId !== projectId)?.projectId
      const back = a.usage.activeLimit?.resetsAt
      return {
        id: a.id, state: a.state, hasLogin: a.identity.hasLogin,
        status: s.accountStatus?.[a.id],
        fiveUsed: f && f.resetsAt > now ? f.usedPct : undefined,
        weekUsed: w && w.resetsAt > now ? w.usedPct : undefined,
        backAt: back && back > now ? back : undefined,
        workingHere: a.state !== 'sin-uso' && working.some((x) => x.projectId === projectId),
        workingElsewhere: elsewhere && !working.some((x) => x.projectId === projectId) ? service.project(elsewhere)?.name ?? elsewhere : undefined,
        lastActiveAt: Math.max(a.lastActivityAt ?? 0, ...a.sessions.map((x) => x.lastActivityAt ?? 0)) || undefined,
        minutesLeft: a.usage.minutesLeft
      }
    })
  }

  /** turns.json: the turn of every wheel that is on, with the folders of its project (the hooks read it on each tool). */
  function writeTurns(): void {
    const file: TurnFile = { at: Date.now(), projects: [] }
    for (const [pid, c] of Object.entries(chains())) {
      const p = service.project(pid)
      if (!c?.on || !p) continue
      file.projects.push({ id: pid, name: p.name, roots: [p.root, ...p.copies.map((x) => x.path)], holder: c.holder, phase: c.phase, members: c.order, section: c.until?.section, outgoing: c.outgoing, partner: c.pair ? c.partner : undefined })
    }
    try {
      const target = join(paths.root(), 'turns.json')
      writeFileSync(target + '.tmp', JSON.stringify(file))
      renameSync(target + '.tmp', target)
    } catch { /* next minute */ }
  }

  /** The window of an account on a project, newest first (not a background session). */
  function windowOn(account: AccountId, projectId: string) {
    const a = service.agents.find((x) => x.id === account)
    return a?.sessions.filter((x) => x.pid && x.kind !== 'background' && x.projectId === projectId).sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))[0]
  }

  /** The background session of an account on a project, newest first. */
  function bgOn(account: AccountId, projectId: string) {
    const a = service.agents.find((x) => x.id === account)
    return a?.sessions.filter((x) => x.kind === 'background' && x.projectId === projectId).sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))[0]
  }

  /**
   * A notice of the wheel to an account on a project (few minutes left, the overlap is over, the wheel moves on): typed
   * in its window; EV141, with «Sin ventanas», to its background session: one at work gets it from its hook on its next
   * step (addNotice, as a take-over notice), and one stopped is resumed with it only when `wake` (else it is left alone).
   */
  async function tell(p: ProjectConfig, account: AccountId, text: string, wake = false): Promise<string | undefined> {
    const w = windowOn(account, p.id)
    if (w?.pid) { await d.typeText(w.pid, text); return 'en su ventana' }
    if (!service.settings.bgSessions) return undefined
    const bg = bgOn(account, p.id)
    if (!bg) return undefined
    if (isSessionWorking(bg)) { addNotice(account, text, [p.root, ...p.copies.map((x) => x.path)]); return 'en su sesión de fondo, en su próximo paso' }
    // «blocked» is also a session with usage that ended its turn waiting for a message: only out of usage it is left alone.
    if (!wake || !d.openBackground || service.agents.find((a) => a.id === account)?.state === 'sin-uso') return undefined
    await d.openBackground(account, bg.cwd, bgResumeArgs(bg.sessionId, text))
    return 'en su sesión de fondo, retomada con el aviso'
  }

  /** Tells `to` it has the turn: in its window on the project if it has one, else in a new window on the project's work copy. */
  async function deliver(p: ProjectConfig, to: AccountId, text: string, fable: boolean, task?: string): Promise<string> {
    // EV141 (Decidir #148 «A»): with «Sin ventanas» on, the turn goes to a background session: the one this account has on
    // the project if it is not working (stopped and resumed with the text, same conversation), else a new one. A window
    // of that account already open on the project (the user's, or from before the switch) is used instead: never two.
    if (service.settings.bgSessions && d.openBackground && !windowOn(to, p.id)?.pid) {
      const bg = bgOn(to, p.id)
      const busy = bg && (bg.state === 'working' || bg.status === 'busy')
      if (busy) return 'su sesión de fondo está trabajando: se le dirá al terminar'
      const last = d.lastOpened[to]
      if (!bg && last && Date.now() - last < OPEN_COOLDOWN_MS) return 'ya se abrió hace un momento: se espera a que arranque'
      const copy = d.workCopy(p)
      // Named «<project> · <its next task>» so Chats and `claude agents` tell them apart.
      const args = bg ? bgResumeArgs(bg.sessionId, text) : bgStartArgs({ name: `${p.name} · ${task ?? 'rueda'}`, prompt: text, model: fable ? 'fable' : undefined, extra: ['--permission-mode', 'auto'] })
      try {
        await d.openBackground(to, bg?.cwd || copy?.path || p.root, args)
        d.lastOpened[to] = Date.now()
        return bg ? 'en su sesión de fondo, en su misma conversación' : 'en una sesión de fondo nueva (sin ventana; «Ver» en Chats o Relevos)'
      } catch (err) {
        // Still in tests: a background session that cannot be opened is not a turn lost; it goes to a window as before.
        service.log(`rueda sin ventanas: ${to} no se pudo abrir de fondo (${(err as Error).message}); va a una ventana`)
      }
    }
    const w = windowOn(to, p.id)
    if (w?.pid) {
      const stale = d.staleWindows().some((x) => x.sessionId === w.sessionId) && !isSessionWorking(w)
      if (stale) { await d.reopenWindow(to, w.sessionId, text); return 'en su misma conversación (ventana reabierta con la coordinación nueva)' }
      await d.typeText(w.pid, text)
      return 'en su ventana abierta'
    }
    const last = d.lastOpened[to]
    if (last && Date.now() - last < OPEN_COOLDOWN_MS) return 'ya se abrió hace un momento: se espera a que arranque'
    // Never a second window of the same account (Relevos says so): one open in another folder or project is told instead
    // of opening another.
    const card = service.agents.find((a) => a.id === to)
    // Its windows could not be read last time (the PC full, 13-11): not opening one blind.
    if (card?.sessionsError) return `no se pudieron leer sus ventanas (${card.sessionsError}): no se abre otra a ciegas; la próxima vuelta lo intenta`
    const other = card?.sessions.find((s) => s.pid && s.kind !== 'background')
    if (other?.pid) { await d.typeText(other.pid, text); return `en la ventana que ya tenía abierta (${other.projectId ? service.project(other.projectId)?.name ?? other.projectId : other.cwd}): no se abre una segunda` }
    const copy = d.workCopy(p)
    d.openTerminal(to, copy?.path ?? p.root, ['--permission-mode', 'auto', ...(fable ? ['--model', 'fable'] : []), text], `${to} · rueda de relevos · ${p.name}`)
    d.lastOpened[to] = Date.now()
    return `en una ventana nueva (${copy?.label ?? 'copia principal'})`
  }

  async function step(projectId: string, why?: string): Promise<void> {
    const p = service.project(projectId)
    const c = chains()[projectId]
    if (!p || !c?.on) return
    const now = Date.now()
    const ms = members(projectId)
    for (const act of chainStep(c, ms, now)) {
      if (act.kind === 'pasar') {
        const from = act.from ? service.agents.find((a) => a.id === act.from) : undefined
        const wantsFable = /fable/i.test(from?.usage.snapshot?.model ?? '')
        // EV101: the next task's own tag first («[fable]» or «[fable u opus]»: Fable while that account has it, its limit is
        // apart and spares the general one; «[opus]»/«[sonnet]»: not Fable); else the model the one before was using.
        let tag: string | undefined
        let task: string | undefined
        try { const n = nextTasks(service.db, projectId, act.to, 1)[0]; tag = n?.model; task = n?.extId } catch { /* no tasks */ }
        const byTask = /fable/i.test(tag ?? '') ? true : /opus|sonnet|haiku/i.test(tag ?? '') ? false : undefined
        const fable = (byTask ?? wantsFable) && !(service.settings.noFable ?? []).includes(act.to)
        const nextChain: RelayChain = { ...c, holder: act.to, since: now, phase: 'trabaja', last: { from: act.from, to: act.to, at: now, why: act.why } }
        save(projectId, nextChain)
        const after = nextInLine(nextChain, ms, now)?.id
        const text = takeTurnText({ from: act.from, to: act.to, project: p.name, after, fableLost: wantsFable && !fable })
        let how = 'ya estaba trabajando aquí: sigue con el turno'
        if (!act.adopt || act.from !== act.to) {
          try { how = await deliver(p, act.to, text, fable, task) } catch (err) { how = `no se le pudo avisar (${(err as Error).message})` }
        }
        addEvent(service.db, { projectId, at: now, account: act.to, kind: 'relevo-app', title: act.from && act.from !== act.to ? `Rueda de relevos: ${act.why}; sigue ${who(act.to)} en ${p.name}` : act.from ? `Rueda de relevos: ${act.why}` : `Rueda de relevos: empieza ${who(act.to)} en ${p.name}`, detail: `Avisada ${how}.${why ? ` (${why})` : ''}`, source: 'Mission Control' })
      } else if (act.kind === 'esperar') {
        save(projectId, { ...c, phase: 'espera' })
        addEvent(service.db, { projectId, at: now, account: act.from, kind: 'relevo-app', title: `Rueda de relevos en espera: ${act.from ? `${who(act.from)} se ha quedado sin uso y ` : ''}nadie más tiene uso${act.firstBack && act.backAt ? `. Seguirá ${who(act.firstBack)} cuando vuelva (${hhmm(act.backAt)})` : ''}`, detail: act.why, source: 'Mission Control' })
      } else if (act.kind === 'solapar') {
        // EV89: the next one takes the turn and the big tasks now; the one running out finishes small ones meanwhile.
        save(projectId, { ...chains()[projectId]!, holder: act.to, outgoing: act.from, since: now, phase: 'trabaja', last: { from: act.from, to: act.to, at: now, why: `${who(act.from)} está a punto de agotarse: relevo con solape` } })
        let how = ''
        try { how = await deliver(p, act.to, takeTurnText({ from: act.from, to: act.to, project: p.name, after: nextInLine({ ...c, holder: act.to }, ms, now)?.id }) + ` ${who(act.from)} sigue unos minutos en paralelo con tareas pequeñas hasta agotarse: coge tú lo grande, mejor en archivos distintos de los suyos (git status te dice cuáles tiene a medias), y, cuando se agote, pmc relevo ${act.from} para recoger lo suyo.`, false) } catch (err) { how = `no se le pudo avisar (${(err as Error).message})` }
        { try { await tell(p, act.from, `Mission Control · rueda de ${p.name}: te quedan pocos minutos. ${who(act.to)} ya tiene el turno y coge lo grande. Tú sigue con tareas pequeñas (documentos, pruebas, arreglos cortos) que no toquen los mismos archivos que ella (un archivo que editáis las dos no entra en tu pmc guarda: lo guarda ella entero, así que apunta en el relevo qué cambiaste en él), suelta las grandes que tengas (pmc release <ID>), guarda a menudo (pmc guarda) y no empieces nada grande.`) } catch { /* next round */ } }
        addEvent(service.db, { projectId, at: now, account: act.to, kind: 'relevo-app', title: `Rueda de relevos con solape: ${who(act.from)} está a punto de agotarse; entra ya ${who(act.to)} con lo grande y ${who(act.from)} termina lo pequeño`, detail: `Avisada ${how}.`, source: 'Mission Control' })
      } else if (act.kind === 'fin-solape') {
        save(projectId, { ...chains()[projectId]!, outgoing: undefined })
        if (act.holder) { try { await tell(p, act.holder, `Mission Control · rueda de ${p.name}: ${who(act.account)} se ha quedado sin uso. Recoge lo que dejó (pmc relevo ${act.account}) y sigue.`, true) } catch { /* next round */ } }
        addEvent(service.db, { projectId, at: now, account: act.account, kind: 'relevo-app', title: `Rueda de relevos: fin del solape, ${who(act.account)} se ha quedado sin uso${act.holder ? `; ${who(act.holder)} recoge lo suyo` : ''}`, source: 'Mission Control' })
      } else if (act.kind === 'pareja') {
        // EV152: two at once; the partner takes what needs no shared resource.
        save(projectId, { ...chains()[projectId]!, partner: act.to })
        let how = 'ya estaba trabajando aquí'
        const m = ms.find((x) => x.id === act.to)
        if (!m?.workingHere) { try { how = await deliver(p, act.to, partnerText({ to: act.to, holder: act.holder, project: p.name }), false) } catch (err) { how = `no se le pudo avisar (${(err as Error).message})` } }
        addEvent(service.db, { projectId, at: now, account: act.to, kind: 'relevo-app', title: `Rueda de relevos de dos en dos: ${who(act.to)} trabaja a la vez que ${who(act.holder)} en ${p.name} (lo que no necesita Unity ni la gráfica)`, detail: `Avisada ${how}.`, source: 'Mission Control' })
      } else if (act.kind === 'fin-pareja') {
        save(projectId, { ...chains()[projectId]!, partner: undefined })
        addEvent(service.db, { projectId, at: now, account: act.account, kind: 'relevo-app', title: `Rueda de relevos: ${who(act.account)} deja de trabajar a la vez (${act.why})`, source: 'Mission Control' })
      } else if (act.kind === 'despertar') {
        const last = woken.get(act.account)
        if (last && now - last < WAKE_EVERY_MS) continue
        // EV146: an account paying per use is not called back on its own (each call costs money; no limit would stop it).
        if (service.agents.find((a) => a.id === act.account)?.identity.plan?.paysPerUse) continue
        woken.set(act.account, now)
        let how = ''
        try { how = await deliver(p, act.account, `Mission Control · rueda de relevos de ${p.name}: tienes el turno y llevas un rato parada con uso. Sigue con lo pendiente (pmc parte), sin resumir ni preguntar si sigues, y trabaja sin parar hasta que te quedes sin uso; entonces seguirá la siguiente de la rueda.`, false) } catch (err) { how = `no se le pudo avisar (${(err as Error).message})` }
        addEvent(service.db, { projectId, at: now, account: act.account, kind: 'relevo-app', title: `Rueda de relevos: ${who(act.account)} tenía el turno y estaba parada con uso; se le ha pedido que siga`, detail: `Avisada ${how}.`, source: 'Mission Control', dedupe: `despierta:${act.account}:${Math.floor(now / WAKE_EVERY_MS)}` })
      } else if (act.kind === 'frenar') {
        const last = braked.get(act.account)
        if (last && now - last < BRAKE_EVERY_MS) continue
        const w = windowOn(act.account, projectId)
        if (!w?.pid) continue
        braked.set(act.account, now)
        try { await d.typeText(w.pid, waitTurnText(act.account, act.holder, p.name)) } catch { /* next round */ }
        addEvent(service.db, { projectId, at: now, account: act.account, kind: 'relevo-app', title: `Rueda de relevos: ${who(act.account)} ha vuelto a trabajar fuera de su turno; se le ha pedido que espere (tiene el turno ${who(act.holder)})`, source: 'Mission Control', dedupe: `frena:${act.account}:${Math.floor(now / BRAKE_EVERY_MS)}` })
      }
      service.push()
    }
  }

  /** The agenda: this project's list is done, so the wheel moves on to the next one, same accounts, same turn. */
  async function advance(projectId: string): Promise<boolean> {
    const c = chains()[projectId]
    if (!c?.on || !c.until?.next) return false
    const rows = service.db.prepare("SELECT section, ext_id, COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND gone = 0").all(projectId) as { section?: string; ext_id?: string; st: string }[]
    const agenda = rows.map((r) => ({ section: r.section, id: r.ext_id ?? undefined, blocked: r.st === 'bloqueada', open: !['terminada', 'revision', 'en-pruebas', 'pendiente-integracion'].includes(r.st) }))
    if (!agendaDone(c.until, agenda, { skipBlocked: AGENDA_SKIPS_BLOCKED })) return false
    const waiting = AGENDA_SKIPS_BLOCKED ? agendaBlocked(c.until, agenda) : []
    const from = service.project(projectId)
    const to = service.project(c.until.next)
    if (!from || !to) return false
    const now = Date.now()
    const nextWheel: RelayChain = { ...(chains()[to.id] ?? { on: false, order: [] }), on: true, order: c.order, paused: c.paused, passAt: c.passAt, pair: c.pair, holder: c.holder, phase: 'trabaja', since: now, last: { from: c.holder, to: c.holder ?? c.order[0], at: now, why: `terminada la lista «${c.until.section}» de ${from.name}` } }
    service.setSettings({ relayChains: { ...chains(), [projectId]: { ...c, on: false }, [to.id]: nextWheel } })
    writeTurns()
    addEvent(service.db, { projectId: to.id, at: now, kind: 'relevo-app', title: `Rueda de relevos: terminada la lista «${c.until.section}» de ${from.name}; la rueda sigue en ${to.name}`, detail: waiting.length ? `Quedan esperando algo que tiene que pasar de verdad: ${waiting.join(', ')}.` : undefined, source: 'Mission Control' })
    const holder = c.holder
    const m = holder ? members(to.id).find((x) => x.id === holder) : undefined
    if (holder && m && m.state !== 'sin-uso') {
      // Told in its window on the old project to close there, and started on the new one.
      try { await tell(from, holder, `Mission Control · rueda de relevos: la lista «${c.until.section}» de ${from.name} está terminada y la rueda sigue en ${to.name}. Guarda lo tuyo aquí (pmc guarda) y termina tu turno en esta sesión: se te abre otra en ${to.name}.`) } catch { /* next round */ }
      try { await deliver(to, holder, `Mission Control · rueda de relevos: terminada la lista «${c.until.section}» de ${from.name}, la rueda sigue en ${to.name} y te toca empezar. Ejecuta pmc parte y sigue con lo pendiente, primero lo que otras cuentas dejaron a medias (pmc relevo <cuenta>). Trabaja sin parar hasta que te quedes sin uso; entonces seguirá la siguiente de la rueda.`, false) } catch { /* the tick will retry */ }
    }
    service.push()
    return true
  }

  /**
   * The user (13-11 12:40): «en relevos que se cierren las ventanas abiertas que ya no se usen para no tener muchos cmd
   * abiertos». A window of a wheel's account that is out of usage for a while (not the holder, not the one finishing in
   * the overlap), idle for 15 minutes, opened by the app: closed. Its conversation stays saved (it can be resumed) and
   * what it left is in the relay; when its turn comes again, the wheel opens a new window.
   */
  const tidied = new Set<number>()
  const stopped = new Set<string>()
  async function tidy(now: number): Promise<void> {
    if (service.settings.closeIdleWindows === false) return
    const accounts = service.agents.map((a) => ({ id: a.id, state: a.state, backAt: a.usage.activeLimit?.resetsAt, sessions: a.sessions.map((s) => ({ pid: s.pid, kind: s.kind, projectId: s.projectId, working: isSessionWorking(s), lastActivityAt: s.lastActivityAt, shortId: s.shortId })) }))
    // EV141: the background sessions of the wheel's accounts, by the same rule as their windows (`claude stop`); only with
    // «Sin ventanas» on (with it off, a background session is one the user started by hand).
    if (d.stopBackground && service.settings.bgSessions) {
      for (const s of idleBackgroundToStop(chains(), accounts, now, stopped)) {
        stopped.add(s.shortId)
        try { await d.stopBackground(s.account as AccountId, s.shortId) } catch { continue }
        addEvent(service.db, { projectId: s.projectId, at: now, account: s.account, kind: 'relevo-app', title: `Rueda de relevos: parada la sesión de fondo de ${who(s.account)}, sin uso hasta ${new Date(s.backAt).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, detail: 'Para no dejar procesos quietos. Su conversación queda guardada y lo que dejó está en el relevo; cuando le vuelva a tocar, la rueda le abre otra sesión de fondo.', source: 'Mission Control', dedupe: `para:${s.shortId}` })
      }
    }
    // EV130: a second window of the same account that the app opened, idle 15 min, while the other one goes on.
    for (const w of duplicateWindowsToClose(accounts, now, tidied)) {
      tidied.add(w.pid)
      let closed = false
      try { closed = await d.closeIdleWindow(w.pid, false) } catch { /* left open */ }
      if (closed) addEvent(service.db, { projectId: w.projectId ?? service.projects[0]?.id ?? '', at: now, account: w.account, kind: 'relevo-app', title: `Cerrada una segunda ventana de ${who(w.account)}: la abrió la app y llevaba 15 min quieta; sigue la otra`, detail: 'Dos ventanas de la misma cuenta gastan el mismo uso y se pisan. Su conversación queda guardada.', source: 'Mission Control', dedupe: `cierra:${w.pid}` })
    }
    for (const w of idleWindowsToClose(chains(), accounts, now, tidied)) {
      tidied.add(w.pid)
      let closed = false
      // Its turn already went to another (the user, 13-11 16:20: «que los claude que no se usen y hayáis cogido relevo se
      // cierren solos»): also a window the user opened by hand, once it has been idle 15 min.
      try { closed = await d.closeIdleWindow(w.pid, true) } catch { /* left open */ }
      if (closed) addEvent(service.db, { projectId: w.projectId, at: now, account: w.account, kind: 'relevo-app', title: `Rueda de relevos: cerrada la ventana de ${who(w.account)}, sin uso hasta ${new Date(w.backAt).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, detail: 'Para no tener ventanas abiertas que no hacen nada. Su conversación queda guardada y lo que dejó está en el relevo; cuando le vuelva a tocar, la rueda le abre otra.', source: 'Mission Control', dedupe: `cierra:${w.pid}` })
    }
  }

  /** Every wheel that is on, one after the other. */
  async function tick(why?: string): Promise<void> {
    if (running || process.env.PMC_SHOT_DIR) return
    // Not before the open windows have been read once since the app started: at 16:18 of the 13-11, five seconds after an
    // install, it saw Claude 6 with no window («parada con uso») and opened a second one while it was working.
    if (!service.refreshedAt.agents) return
    running = true
    try {
      for (const [pid, c] of Object.entries(chains())) if (c?.on && c.until?.next) await advance(pid)
      for (const [pid, c] of Object.entries(chains())) if (c?.on) await step(pid, why)
      await tidy(Date.now())
      writeTurns()
    } catch (err) {
      console.error('rueda de relevos:', (err as Error).message)
    } finally { running = false }
  }

  /** The wheel of a project, as the screen shows it. */
  function view(projectId: string) {
    const c = chains()[projectId] ?? { on: false, order: [] }
    return { chain: c, members: members(projectId) }
  }

  /** Every project's wheel and what it knows of each account there, for the Relevos screen in one call. */
  function viewAll() {
    return Object.fromEntries(service.projects.map((p) => [p.id, view(p.id)]))
  }

  /** The user's changes; turning a wheel on takes its accounts out of any other wheel that is on and starts at once. */
  async function set(projectId: string, patch: Partial<RelayChain>): Promise<RelayChain> {
    const cur: RelayChain = chains()[projectId] ?? { on: false, order: [] }
    const next: RelayChain = { ...cur, ...patch }
    next.order = [...new Set(next.order)]
    next.paused = next.paused?.filter((id) => next.order.includes(id))
    if (next.holder && !next.order.includes(next.holder)) { next.holder = undefined; next.phase = undefined }
    const all = { ...chains(), [projectId]: next }
    if (next.on) {
      // One wheel per account: the others that are on lose it.
      for (const [pid, c] of Object.entries(all)) if (pid !== projectId && c?.on) all[pid] = { ...c, order: c.order.filter((id) => !next.order.includes(id)) }
      // Turning it on with someone of the wheel already at work here: that one holds the turn, nothing is opened.
      if (!cur.on || !next.holder) {
        const busy = members(projectId).find((m) => next.order.includes(m.id) && m.workingHere)
        if (busy) { next.holder = busy.id; next.phase = 'trabaja'; next.since = Date.now() }
      }
      // A wheel needs the sessions to go on by themselves until the limit cuts them.
      if (!service.settings.autonomous) service.setSettings({ autonomous: true })
    }
    service.setSettings({ relayChains: all })
    writeTurns()
    if (next.on && !cur.on) addEvent(service.db, { projectId, at: Date.now(), kind: 'relevo-app', title: `Rueda de relevos encendida: ${next.order.map(who).join(' → ')} → ${next.order.length ? who(next.order[0]) : ''}`, source: 'Mission Control' })
    if (!next.on && cur.on) addEvent(service.db, { projectId, at: Date.now(), kind: 'relevo-app', title: 'Rueda de relevos apagada', source: 'Mission Control' })
    void tick('cambio del usuario')
    return next
  }

  /** «Dar el turno»: the user hands the turn to an account now; the one that had it is asked to wait. */
  async function give(projectId: string, to: AccountId): Promise<void> {
    const p = service.project(projectId)
    const c = chains()[projectId]
    if (!p || !c) throw new Error('Esta rueda no existe')
    if (!c.order.includes(to)) throw new Error(`${who(to)} no está en la rueda`)
    const m = members(projectId).find((x) => x.id === to)
    if (m?.state === 'sin-uso') throw new Error(`${who(to)} no tiene uso ahora`)
    const from = c.holder
    const now = Date.now()
    save(projectId, { ...c, holder: to, since: now, phase: 'trabaja', last: { from, to, at: now, why: 'se lo has dado tú' } })
    let how = 'ya estaba trabajando aquí'
    if (!m?.workingHere && c.on) how = await deliver(p, to, takeTurnText({ from: from && from !== to ? from : undefined, to, project: p.name, after: nextInLine({ ...c, holder: to }, members(projectId), now)?.id }), false)
    addEvent(service.db, { projectId, at: now, account: to, kind: 'relevo-app', title: `Rueda de relevos: le has dado el turno a ${who(to)} en ${p.name}`, detail: `Avisada ${how}.`, source: 'Mission Control' })
    braked.delete(to)
    void tick('turno dado por el usuario')
  }

  /** Is this account in an active wheel of this project? (the old automatisms leave those alone). */
  function governs(projectId: string | undefined, account?: AccountId): boolean {
    if (!projectId) return false
    const c = chains()[projectId]
    return Boolean(c?.on && (!account || c.order.includes(account)))
  }

  return { tick, view, viewAll, set, give, governs, writeTurns, members }
}

export type Wheel = ReturnType<typeof createWheel>
