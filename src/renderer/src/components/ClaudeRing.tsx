import { locale, t } from '../../../core/i18n'
import { useId, useState } from 'react'
import { motion } from 'motion/react'
import { api, type AgentCard } from '../lib/api'
import { useStore } from '../lib/store'
import { ACCOUNT_COLOR, SPRING, STATE_META } from './ui'
import { countdown } from '../lib/format'

import { fastPace, usageView as viewOf, usedColor, type UsageView } from '../../../core/usageview'

// Usage, said the way Claude Code's /usage says it (EV175): the big number and the fill are what is USED, orange from
// 75 %, red from 90 %; the words add what is left and the reset. The reading itself: core/usageview.ts.

export { usedColor, type UsageView }
export const usageView = (a: AgentCard, which: 'five' | 'week', now: number): UsageView => viewOf(a.usage, which, now)

export const hhmm = (ms: number, now: number) => {
  const d = new Date(ms)
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  return ms - now < 20 * 3600_000 ? time : `${d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '')} ${time}`
}

function Arc({ r, stroke, frac, color, gid }: { r: number; stroke: number; frac?: number; color: string; gid: string }) {
  const c = 2 * Math.PI * r
  return (
    <>
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={`color-mix(in srgb, ${color} 70%, white)`} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <circle r={r} fill="none" stroke="var(--fill-2)" strokeWidth={stroke} strokeDasharray={frac == null ? '2 5' : undefined} />
      {frac != null && frac > 0 && (
        <motion.circle r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(0.006, frac)) }} transition={{ ...SPRING, duration: 1.1 }} />
      )}
    </>
  )
}

/**
 * Two rings of what is used, as /usage fills its bars: outer, the week; inner, the 5 hours. The centre says how much is
 * used of the one nearer its end, and which one it is; out of usage, when it comes back. No reading draws a dotted
 * track, never a guess.
 */
export function ClaudeRing({ a, size = 100, now }: { a: AgentCard; size?: number; now: number }) {
  const base = ACCOUNT_COLOR[a.id]
  const uid = useId().replace(/:/g, '')
  const five = usageView(a, 'five', now)
  const week = usageView(a, 'week', now)
  // Thinner bars on a small ring, so the words in the middle have room (13-11: «semana» touched the inner ring).
  const s = size * (size < 110 ? 0.085 : 0.11)
  const r1 = size / 2 - s / 2 - 0.5
  const r2 = r1 - s - 3
  const lim = a.usage.activeLimit
  const tight = [five, week].filter((v) => v.used != null).sort((x, y) => y.used! - x.used!)[0]
  // Never smaller than this, whatever the ring (13-11, the user: «se siguen viendo cosas pequeñas como lo que pone bajo
  // del porcentaje»): a small ring says less, in one line, instead of the same at 6 px.
  const small = size < 110
  const tiny = (k: number) => Math.max(11, size * k)
  // The «working» dot sits outside the ring, at its corner, not on top of the bar («el verde del activo muy cerca de la barra»).
  const dot = Math.max(12, Math.round(size * 0.14))
  return (
    <div className="relative flex-none" style={{ width: size, height: size }} role="img"
      aria-label={t('Usado: {v0} de las 5 horas y {v1} de la semana', { v0: five.used != null ? Math.round(five.used) + ' %' : t('sin lectura'), v1: week.used != null ? Math.round(week.used) + ' %' : t('sin lectura') })}
      title={t('Anillo de fuera: la semana. Anillo de dentro: las 5 horas. Lo coloreado es lo usado, como en /usage.')}>
      <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <Arc r={r1} stroke={s} frac={week.used != null ? week.used / 100 : undefined} color={usedColor(week.used, base)} gid={`w${uid}`} />
        <Arc r={r2} stroke={s} frac={five.used != null ? five.used / 100 : undefined} color={usedColor(five.used, base)} gid={`f${uid}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {lim ? (
          <>
            <span style={{ fontSize: tiny(0.1), color: 'var(--label-2)', fontWeight: 650, marginBottom: 3 }}>{t('vuelve')}</span>
            <span className="num" style={{ fontSize: size * (lim.resetsAt - now < 20 * 3600_000 ? 0.2 : 0.14), fontWeight: 760, color: 'var(--red)', letterSpacing: '-0.02em' }}>{hhmm(lim.resetsAt, now)}</span>
          </>
        ) : tight ? (
          <>
            <span className="num" style={{ fontSize: size * (small ? 0.24 : 0.2), fontWeight: 760, color: usedColor(tight.used, 'var(--label)'), letterSpacing: '-0.03em' }}>{Math.round(tight.used!)}<span style={{ fontSize: size * (small ? 0.13 : 0.11) }}>%</span></span>
            {small
              // In two short lines («usado · sem.» in one went over the inner ring in Cuentas, at 96 px).
              ? <>
                <span style={{ fontSize: tiny(0.1), color: 'var(--label-2)', fontWeight: 650, marginTop: 2 }}>{t('usado')}</span>
                <span style={{ fontSize: tiny(0.09), color: 'var(--label-3)', fontWeight: 600, marginTop: 1 }}>{tight.which === 'five' ? t('5 h') : t('sem.')}</span>
              </>
              : <>
                <span style={{ fontSize: tiny(0.09), color: 'var(--label-2)', fontWeight: 650, marginTop: 1 }}>{t('usado')}</span>
                <span style={{ fontSize: tiny(0.085), color: 'var(--label-2)', fontWeight: 550 }}>{tight.which === 'five' ? t('5 horas') : t('semana')}</span>
              </>}
          </>
        ) : (
          <span className="num" style={{ fontSize: size * 0.28, fontWeight: 740, color: base, letterSpacing: '-0.04em' }}>{a.id.slice(6)}</span>
        )}
      </div>
      {a.state === 'trabajando' && (
        <span className="absolute live-dot rounded-full" title={t('Trabajando ahora')} style={{ right: -dot * 0.35, top: -dot * 0.35, width: dot, height: dot, background: STATE_META.trabajando.color, color: STATE_META.trabajando.color, boxShadow: '0 0 0 3px var(--bg-elev)' }} />
      )}
    </div>
  )
}

/**
 * One window as a bar of what is used, as /usage draws it, with a thin mark at the share of the window's time gone. Past
 * the mark: spending faster than the clock. Below, in words: what is left, the reset and the pace.
 */
export function UsageBar({ a, which, now, compact }: { a: AgentCard; which: 'five' | 'week'; now: number; compact?: boolean }) {
  const v = usageView(a, which, now)
  const base = ACCOUNT_COLOR[a.id]
  const color = usedColor(v.used, base)
  const name = which === 'five' ? t('5 horas') : t('Semana')
  const fast = fastPace(v)
  // EV114: with the week used up, what is left of the 5 hours cannot be used: said so, and the bar greyed (13-11: Claude 1
  // showed «queda 21 %» in orange and «a este ritmo se acaba 14:02» with no week left).
  const weekOut = which === 'five' && !v.out && usageView(a, 'week', now).out
  if (weekOut) return (
    <div className="flex flex-col gap-1 min-w-0" style={{ opacity: 0.55 }}>
      <div className="flex items-baseline gap-2 min-w-0"><span className={compact ? 't-small' : 't-body'} style={{ fontWeight: 600 }}>{name}</span><span className="ml-auto whitespace-nowrap c3" style={{ fontWeight: 650, fontSize: compact ? 13 : 15 }}>{t('no se puede usar')}</span></div>
      <div style={{ height: compact ? 7 : 9, borderRadius: 99, background: 'var(--fill-2)' }} />
      <div className="t-small c3 truncate">{t('mientras la semana esté agotada no cuenta lo que quede de las 5 horas')}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className={compact ? 't-small' : 't-body'} style={{ fontWeight: 600 }}>{name}</span>
        <span className="ml-auto num whitespace-nowrap" style={{ fontWeight: 700, fontSize: compact ? 13 : 15, color: v.used == null ? 'var(--label-3)' : color }}>
          {v.out ? t('agotada') : v.used == null ? t('sin lectura') : t('{v0} % usado', { v0: Math.round(v.used) })}
        </span>
      </div>
      <div className="relative" style={{ height: compact ? 7 : 9, borderRadius: 99, background: 'var(--fill-2)' }} title={v.elapsed != null ? t('La barra es lo usado, como en /usage. La raya marca el tiempo que ha pasado de esta ventana: si la barra pasa de la raya, se gasta más deprisa de lo que dura') : undefined}>
        {v.used != null && v.used > 0 && (
          <motion.i className="block absolute left-0 top-0 bottom-0" style={{ borderRadius: 99, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 72%, white), ${color})` }}
            initial={{ width: 0 }} animate={{ width: `${Math.max(2, Math.min(100, v.used))}%` }} transition={{ ...SPRING, duration: 0.8 }} />
        )}
        {v.elapsed != null && !v.out && (
          <span className="absolute" style={{ left: `calc(${v.elapsed * 100}% - 1px)`, top: -3, bottom: -3, width: 2, borderRadius: 2, background: 'var(--label-2)' }} />
        )}
      </div>
      <div className="t-small c3 truncate" title={v.resetsAt ? t('Se renueva el {v0}', { v0: new Date(v.resetsAt).toLocaleString(locale()) }) : undefined}>
        {v.out && v.resetsAt ? <>{t('vuelve')} <b className="c2">{hhmm(v.resetsAt, now)}</b> {t('· en {v0}', { v0: countdown(v.resetsAt, now) })}</>
          : v.renewedAt ? <>{t('se renovó {v0} y no ha trabajado desde entonces', { v0: hhmm(v.renewedAt, now) })}</>
          : v.left != null && v.resetsAt ? <>{t('queda {v0} % · se renueva', { v0: Math.round(v.left) })} <b className="c2">{hhmm(v.resetsAt, now)}</b>{!compact && <> {t('(en {v0})', { v0: countdown(v.resetsAt, now) })}</>}
            {v.emptyAt ? <span style={{ color: 'var(--orange)' }}> {t('· a este ritmo se acaba {v0}', { v0: hhmm(v.emptyAt, now) })}</span> : fast ? <span style={{ color: 'var(--orange)' }}> {t('· ritmo alto')}</span> : !compact ? <span style={{ color: 'var(--green)' }}> {t('· te dura de sobra')}</span> : null}</>
          : t('llega con la próxima respuesta de esta cuenta')}
      </div>
    </div>
  )
}

/** Both windows, one under the other: the legend of the rings. */
export function UsageBars({ a, now, compact }: { a: AgentCard; now: number; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      <UsageBar a={a} which="five" now={now} compact={compact} />
      <UsageBar a={a} which="week" now={now} compact={compact} />
      {/* EV105: an account that is not working keeps its last reading; say how old it is. */}
      {a.usage.snapshot && now - a.usage.snapshot.capturedAt > 30 * 60_000 && (
        <span className="t-small c3">{t('Leído hace {v0}{v1}', { v0: countdown(now, a.usage.snapshot.capturedAt), v1: compact ? '' : t(', la última vez que trabajó') })}
          {/* EV174: what it spent elsewhere (another computer, the phone, claude.ai) is only seen by asking. */}
          {a.state !== 'baja' && window.pmc?.platform !== 'remote' && <CheckNow id={a.id} />}</span>
      )}
    </div>
  )
}

/** «Usado: 59 % de 5 h · 63 % de la semana», for one line (as /usage says it). */
export function freeLabel(a: AgentCard, now: number): string {
  const five = usageView(a, 'five', now)
  const week = usageView(a, 'week', now)
  if (five.used == null && week.used == null) return t('Uso sin lectura')
  const f = (v: UsageView) => (v.out ? t('agotado') : v.used == null ? '—' : `${Math.round(v.used)} %`)
  return t('Usado: {v0} de 5 h · {v1} de la semana', { v0: f(five), v1: f(week) })
}

/**
 * EV174 «Comprobar ahora»: the account's real usage, asked to Anthropic with one tiny question (it counts as a request of
 * that account). Only on the PC, only when pressed.
 */
function CheckNow({ id }: { id: string }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const go = () => {
    setBusy(true)
    void api<{ words: string; out: boolean }>('usageCheck', id).then(
      (r) => toast(r.out ? t('Sin uso ahora: {v0}', { v0: r.words }) : t('Uso real: {v0}', { v0: r.words })),
      (e: Error) => toast(e.message)
    ).finally(() => setBusy(false))
  }
  return (
    <button className="ml-1.5 underline decoration-dotted" style={{ color: 'var(--accent)', cursor: busy ? 'progress' : 'pointer' }} disabled={busy}
      title={t('Pregunta a Anthropic con esta cuenta cuánto uso le queda de verdad, también lo gastado en otro ordenador, el móvil o claude.ai (gasta una pregunta mínima)')}
      onClick={go}>{busy ? t('comprobando…') : t('Comprobar ahora')}</button>
  )
}
