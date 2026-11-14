import { t } from '../core/i18n'
// Smart recharge, the part that acts (EV96; the decision and the reading are core/recharge.ts). At an account's limit the
// app looks at its window for Claude Code's own `/limit-reset` offer; every two minutes it asks whether this is the moment
// to use it and, when it is (and the user left it to the app, Decidir #130 «B»), types the command in that window and
// confirms only a dialog about a reset. The claim is Claude Code's, with its own login: no credential is read here.
import type { Service } from './service'
import type { Wheel } from './wheel'
import type { AccountId } from '../core/types'
import { readResetOffer, resetStep, rechargeDecision, useByTime, type RechargeInput, type ResetOffer } from '../core/recharge'
import { cannotTake } from '../core/chain'
import { addEvent } from '../core/db'
import { weekRate, DEFAULT_RATE } from '../core/forecast'

export interface RechargeDeps {
  service: Service
  wheel: () => Wheel | undefined
  readScreen: (pid: number, lines?: number) => Promise<string>
  typeText: (pid: number, text: string) => Promise<void>
  typeKey: (pid: number, key: string) => Promise<void>
  /** On the PC and on the phone. */
  notify: (title: string, body: string) => void
}

export type ResetRecord = ResetOffer & { seenAt: number; usedAt?: number; lastTryAt?: number; tries?: number; noneAt?: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const who = (id: string) => `Claude ${id.replace(/\D/g, '')}`

export function createRecharge(d: RechargeDeps) {
  const { service } = d
  const busy = new Set<string>()
  /** «Avisar» once per limit, not every two minutes. */
  const warned = new Map<string, number>()

  const records = (): Record<string, ResetRecord> => service.settings.resets ?? {}
  function save(account: string, patch: Partial<ResetRecord>): void {
    const all = { ...records() }
    all[account] = { ...(all[account] ?? { available: false, seenAt: Date.now() }), ...patch }
    service.setSettings({ resets: all })
  }

  function windowOf(account: string, sessionId?: string) {
    const a = service.agents.find((x) => x.id === account)
    const ws = (a?.sessions ?? []).filter((s) => s.pid && s.kind !== 'background')
    return ws.find((s) => s.sessionId === sessionId) ?? ws[0]
  }

  /** At the limit: what its window says about a reset. */
  async function look(account: string, sessionId?: string): Promise<ResetOffer | undefined> {
    const w = windowOf(account, sessionId)
    if (!w?.pid) return undefined
    let screen = ''
    try { screen = await d.readScreen(w.pid, 60) } catch { return undefined }
    const offer = readResetOffer(screen)
    if (!offer) return undefined
    save(account, { ...offer, seenAt: Date.now(), ...(offer.available ? { noneAt: undefined } : { noneAt: Date.now() }) })
    if (offer.available) {
      const day = new Date().toDateString()
      addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: t('{v0} tiene una recarga de Claude Code a mano{v1}{v2}', { v0: who(account), v1: offer.kinds?.length ? ` (${offer.kinds.join(', ')})` : ' (5 horas)', v2: offer.useBy ? `, hasta ${offer.useBy}` : '' }), source: 'Mission Control', dedupe: `rc:${account}:${day}` })
    }
    return offer
  }

  /** What the decision needs about an account now. */
  function inputFor(account: string, now = Date.now()): RechargeInput {
    const a = service.agents.find((x) => x.id === account)
    const s = service.settings
    const lim = a?.usage.activeLimit
    const w = a?.usage.snapshot?.sevenDay
    const rec = records()[account]
    const entry = Object.entries(s.relayChains ?? {}).find(([, c]) => c?.on && c.order.includes(account as AccountId))
    let workLeft = Boolean(s.autonomous)
    let othersReady: string[] = []
    let othersHours: number | undefined
    let agendaHours: number | undefined
    if (entry) {
      const [pid, chain] = entry
      const tasks = service.tasks.get(pid) ?? []
      const key = chain!.until?.section?.toLowerCase()
      workLeft = tasks.some((t) => t.status !== 'terminada' && t.status !== 'idea' && (!key || t.section.toLowerCase().includes(key)))
      const ms = d.wheel()?.members(pid) ?? []
      othersReady = ms.filter((m) => m.id !== account && chain!.order.includes(m.id) && !cannotTake(m, chain!)).map((m) => m.id)
      // EV96 with EV67's forecast: hours of work the others have before this one comes back by itself, and what the agenda asks.
      const ownBack = lim && lim.resetsAt > now ? lim.resetsAt : undefined
      othersHours = chain!.order.filter((id) => id !== account && !s.accountStatus?.[id] && !chain!.paused?.includes(id)).reduce((sum, id) => {
        const o = service.agents.find((x) => x.id === id)
        if (!o) return sum
        const back = o.usage.activeLimit?.resetsAt
        if (o.state === 'sin-uso' && back && ownBack && back > ownBack) return sum
        const ow = o.usage.snapshot?.sevenDay
        const left = ow && ow.resetsAt > now ? Math.max(0, 100 - ow.usedPct) : 100
        return sum + left / (weekRate(o.usage.history, now).rate ?? DEFAULT_RATE)
      }, 0)
      const open = tasks.filter((t) => t.status !== 'terminada' && t.status !== 'idea' && (!key || t.section.toLowerCase().includes(key)))
      const done = tasks.filter((t) => t.status === 'terminada' && t.updatedAt > now - 86400_000 && (!key || t.section.toLowerCase().includes(key))).length
      const worked = chain!.order.reduce((sum, id) => { const o = service.agents.find((x) => x.id === id); return sum + (o ? weekRate(o.usage.history, now, 1).hours : 0) }, 0)
      agendaHours = Math.round(open.length * (done && worked ? Math.max(0.2, Math.min(4, worked / done)) : 1) * 10) / 10
    }
    return {
      now, mode: s.smartRecharge ?? 'sola',
      limit: lim && lim.resetsAt > now ? { kind: lim.kind, resetsAt: lim.resetsAt } : undefined,
      weekUsed: w?.usedPct, weekResetsAt: w?.resetsAt,
      offer: rec, workLeft, othersReady, useByAt: useByTime(rec?.useBy, now),
      model: a?.sessions.find((x) => x.model)?.model ?? a?.usage.snapshot?.model,
      othersHours, agendaHours
    }
  }

  /**
   * Uses the reset in the account's window: the command (with its kind on builds that have kinds), the confirmation only
   * where it talks about a reset, then «go on». Anything unexpected: Esc, and it says so.
   */
  async function apply(account: string, kind?: string): Promise<string> {
    if (busy.has(account)) return 'ya se está usando'
    const w = windowOf(account)
    if (!w?.pid) return 'no tiene ventana abierta'
    const pid = w.pid
    busy.add(account)
    const rec = records()[account]
    save(account, { lastTryAt: Date.now(), tries: (rec?.tries ?? 0) + 1 })
    const read = async () => { try { return await d.readScreen(pid, 40) } catch { return '' } }
    try {
      let screen = await read()
      // At the wall Claude Code may already show its menu with the reset as a numbered choice.
      const pick = screen.match(/(\d)\.\s*Use an available limit reset/i)
      if (pick) await d.typeKey(pid, pick[1])
      else await d.typeText(pid, `/limit-reset${kind && rec?.kinds?.length ? ' ' + kind : ''}`)
      await sleep(5000)
      screen = await read()
      let step = resetStep(screen)
      if (step === 'elegir') {
        await d.typeKey(pid, 'esc'); await sleep(800)
        await d.typeText(pid, `/limit-reset ${kind ?? '5-hour'}`); await sleep(5000)
        screen = await read(); step = resetStep(screen)
      }
      if (step === 'confirmar') {
        await d.typeKey(pid, 'enter'); await sleep(7000)
        screen = await read(); step = resetStep(screen)
      }
      if (step === 'hecho') {
        const left = rec?.left != null ? Math.max(0, rec.left - 1) : undefined
        save(account, { usedAt: Date.now(), available: Boolean(left), left })
        // The app counts it back in the turn at once (the same as «Ya está recargada»).
        service.setSettings({ recharged: { ...(service.settings.recharged ?? {}), [account]: Date.now() } })
        if (/send a message to continue/i.test(screen)) await d.typeText(pid, 'Mission Control: se ha usado tu recarga de Claude Code; sigue exactamente donde lo dejaste, sin repetir lo hecho.')
        addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: t('{v0} ha usado su recarga{v1} y sigue trabajando', { v0: who(account), v1: kind ? ` (${kind})` : '' }), source: 'Mission Control' })
        d.notify(`${who(account)} ha usado su recarga`, 'Era el mejor momento: estaba parada con trabajo y nadie más podía seguir. Sigue trabajando.')
        void service.refreshAgents()
        return 'hecho'
      }
      if (step === 'sin-recarga') {
        save(account, { available: false, noneAt: Date.now() })
        addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: t('{v0} no tiene recarga disponible ahora (Claude Code lo dice)', { v0: who(account) }), source: 'Mission Control' })
        return 'sin recarga'
      }
      // Esc only closes a chooser left open; on a plain line it would cancel Claude Code's automatic continue (13-11).
      if (/Use an? [\w -]+ \(|Enter to confirm|esc to (?:go back|exit)/i.test(screen)) { try { await d.typeKey(pid, 'esc') } catch { /* closed */ } }
      addEvent(service.db, { at: Date.now(), account, kind: 'aviso', title: t('No se ha usado la recarga de {v0}: la ventana no mostraba lo esperado{v1}', { v0: who(account), v1: step === 'peligro' ? ' (hablaba de créditos o de pago: nunca se pulsa ahí)' : '' }), detail: screen.slice(-1500), source: 'Mission Control' })
      return step === 'peligro' ? 'la pantalla hablaba de pagar: no se ha tocado' : 'no se ha podido confirmar'
    } catch (e) {
      return (e as Error).message
    } finally {
      busy.delete(account)
      service.push()
    }
  }

  /**
   * Finds out which resets an account holds without using any (the user, 13-11: «no quiero que los actives ahora… no está
   * mal que la app revise los inactivos y también te lo diga»): in a window that is open and NOT working, it types
   * `/limit-reset`, reads what Claude Code shows and leaves with Esc. It never presses Enter or a number there. A window at
   * work is left alone (the text would queue as a message).
   */
  async function probe(account: string): Promise<string> {
    const w = windowOf(account)
    if (!w?.pid) return 'sin ventana abierta: se mira cuando llegue a su límite'
    const a = service.agents.find((x) => x.id === account)
    if (a?.state === 'trabajando' || w.status === 'busy') return 'está trabajando: se mira cuando pare'
    if (busy.has(account)) return 'ya se está mirando'
    busy.add(account)
    const pid = w.pid
    try {
      // A window waiting to go on by itself at its reset («continuing automatically at 12:30pm · esc to cancel») is not
      // touched: on 13-11 the Esc of this look cancelled claude3's («Automatic continue cancelled»).
      let before = ''
      try { before = await d.readScreen(pid, 40) } catch { /* gone */ }
      if (/continuing automatically|esc to cancel/i.test(before)) return 'va a seguir sola cuando vuelva su uso: no se toca su ventana'
      await d.typeText(pid, '/limit-reset')
      await sleep(4000)
      let screen = ''
      try { screen = await d.readScreen(pid, 40) } catch { /* gone */ }
      // One Esc closes the chooser when there is one; the command that only answers with a line needs none.
      if (/Use an? [\w -]+ reset \(|Enter to confirm|esc to (?:go back|exit)/i.test(screen)) { try { await d.typeKey(pid, 'esc') } catch { /* closed */ } await sleep(500) }
      const offer = readResetOffer(screen)
      // Out of a limit, the older single reset only says «isn't available right now»: that says nothing about later.
      const limited = Boolean(a?.usage.activeLimit && a.usage.activeLimit.resetsAt > Date.now())
      if (!offer || (!offer.available && !limited)) return 'Claude Code no enseña sus recargas fuera del límite: se sabrá cuando llegue a él'
      save(account, { ...offer, seenAt: Date.now() })
      addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: offer.available ? t('{v0} tiene recarga{v1}{v2} (revisado sin usarla)', { v0: who(account), v1: offer.kinds?.length ? ` (${offer.kinds.join(', ')})` : '', v2: offer.useBy ? `, hasta ${offer.useBy}` : '' }) : t('{v0} no tiene recarga ahora', { v0: who(account) }), source: 'Mission Control', dedupe: `rp:${account}:${new Date().toDateString()}:${offer.available}` })
      return offer.available ? `tiene recarga${offer.kinds?.length ? ` (${offer.kinds.join(', ')})` : ''}${offer.useBy ? `, hasta ${offer.useBy}` : ''}` : 'no tiene recarga ahora'
    } finally {
      busy.delete(account)
      service.push()
    }
  }
  /**
   * EV101 (the user, 13-11: «si pensáis que algo lo hará mejor Fable y conocéis el cupón… cambiar de modelo… y luego seguir
   * trabajando como antes»): at «You've reached your Fable limit», its Fable reset if it has one and the user lets the app
   * use them; if not, the same conversation goes on with Opus (`/model opus`, what Claude Code itself suggests), and the
   * account is marked out of Fable until its week comes back, so new windows open with Opus meanwhile.
   */
  async function fableOut(account: string, sessionId?: string): Promise<string> {
    const s = service.settings
    if (s.accountStatus?.[account]) return 'apartada'
    const rec = records()[account]
    if ((s.smartRecharge ?? 'sola') === 'sola' && rec?.available && rec.kinds?.includes('fable')) {
      const r = await apply(account, 'fable')
      if (r === 'hecho') { unmarkFable(account); return 'cupón de Fable usado' }
    }
    const a = service.agents.find((x) => x.id === account)
    const week = a?.usage.snapshot?.sevenDay?.resetsAt
    const until = week && week > Date.now() ? week : Date.now() + 7 * 86400_000
    service.setSettings({ noFable: [...new Set([...(s.noFable ?? []), account as AccountId])], fableAuto: { ...(s.fableAuto ?? {}), [account]: until } })
    const inWheel = Object.values(s.relayChains ?? {}).some((c) => c?.on && c.order.includes(account as AccountId))
    const w = windowOf(account, sessionId)
    // Only where the app drives the work (autonomous mode or a wheel): a window the user is using is left to the user.
    if (!w?.pid || !(s.autonomous || inWheel)) {
      addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: t('{v0} se ha quedado sin Fable hasta {v1}: sus ventanas nuevas irán con Opus', { v0: who(account), v1: new Date(until).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }), source: 'Mission Control' })
      return 'marcada sin Fable'
    }
    await d.typeText(w.pid, '/model opus')
    await sleep(2500)
    await d.typeText(w.pid, 'Mission Control: se ha acabado tu límite de Fable y no hay cupón de Fable; sigue con Opus exactamente donde lo dejaste, sin repetir lo hecho.')
    addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: t('{v0} se ha quedado sin Fable: sigue con Opus en la misma conversación (Fable vuelve {v1})', { v0: who(account), v1: new Date(until).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }), source: 'Mission Control' })
    service.push()
    return 'sigue con Opus'
  }

  function unmarkFable(account: string): void {
    const s = service.settings
    if (!s.fableAuto?.[account]) return
    const rest = { ...s.fableAuto }
    delete rest[account]
    service.setSettings({ noFable: (s.noFable ?? []).filter((x) => x !== account), fableAuto: rest })
    addEvent(service.db, { at: Date.now(), account, kind: 'recarga', title: t('{v0} vuelve a tener Fable', { v0: who(account) }), source: 'Mission Control' })
  }

  /** Every two minutes, and after each limit: the accounts stopped by their limit with a reset at hand. */
  async function tick(): Promise<void> {
    const now = Date.now()
    // EV101: a Fable mark the app put ends with the account's week.
    for (const [acc, until] of Object.entries(service.settings.fableAuto ?? {})) if (until <= now) unmarkFable(acc)
    for (const a of service.agents) {
      if (a.state !== 'sin-uso' || service.settings.accountStatus?.[a.id]) continue
      const rec = records()[a.id]
      if (!rec?.available) continue
      const dec = rechargeDecision(inputFor(a.id, now))
      if (dec.action === 'usar') { await apply(a.id, dec.kind); continue }
      if (dec.action === 'avisar') {
        const at = a.usage.activeLimit?.resetsAt ?? 0
        if (warned.get(a.id) === at) continue
        warned.set(a.id, at)
        d.notify(`Buen momento para la recarga de ${who(a.id)}`, `${dec.why}. Ábrela en Inicio o escribe /limit-reset en su ventana.`)
        addEvent(service.db, { at: now, account: a.id, kind: 'recarga', title: t('Buen momento para usar la recarga de {v0}: {why}', { v0: who(a.id), why: dec.why }), source: 'Mission Control' })
      }
    }
  }

  /** For the screens: each account's reset and what the app will do with it. */
  function view() {
    const now = Date.now()
    return Object.fromEntries(service.agents.map((a) => {
      const rec = records()[a.id]
      const dec = rechargeDecision({ ...inputFor(a.id, now), offer: rec })
      return [a.id, { record: rec, decision: dec }]
    }))
  }

  return { look, tick, apply, view, inputFor, probe, fableOut }
}

export type Recharge = ReturnType<typeof createRecharge>
