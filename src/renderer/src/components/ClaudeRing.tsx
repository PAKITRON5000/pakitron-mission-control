import { useId } from 'react'
import { motion } from 'motion/react'
import type { AgentCard } from '../lib/api'
import { ACCOUNT_COLOR, SPRING, STATE_META } from './ui'
import { countdown } from '../lib/format'

// Usage, said the way it is asked (the user, 12-11: «a veces no se entiende bien o no sabes cuánto queda o lo que has
// gastado»). Everything draws what is LEFT, like a battery: a full ring or bar is plenty, an empty red one is nothing.
// The words say both («queda 41 % · gastado 59 %»), the reset time, and where it would run out at the current pace.

const SPAN = { five: 5 * 3600_000, week: 7 * 86400_000 } as const

export interface UsageView {
  which: 'five' | 'week'
  /** 0..100; undefined without a current reading. */
  used?: number
  left?: number
  resetsAt?: number
  /** Share of the window's time still to go (0..1): where the bar should be to last until the reset. */
  timeLeft?: number
  /** It ran into this limit and waits for the reset. */
  out: boolean
  /** At the pace since the window started it runs out before the reset, at this time. */
  emptyAt?: number
  /** EV105: the last reading's window already renewed, at this time, with no use read since: it is full again. */
  renewedAt?: number
}

export function usageView(a: AgentCard, which: 'five' | 'week', now: number): UsageView {
  const lim = a.usage.activeLimit
  if (lim && ((which === 'week' && lim.kind === 'semanal') || (which === 'five' && lim.kind !== 'semanal'))) return { which, used: 100, left: 0, resetsAt: lim.resetsAt, out: true }
  const w = which === 'week' ? a.usage.snapshot?.sevenDay : a.usage.snapshot?.fiveHour
  if (!w) return { which, out: false }
  // EV105 (the user, 13-11: «los créditos restantes aunque estén en No usar»): an account that has not worked since its
  // window renewed has it whole; every session writes a new reading, so none since means none spent.
  if (w.resetsAt <= now) return { which, used: 0, left: 100, out: false, renewedAt: w.resetsAt }
  const used = Math.max(0, Math.min(100, w.usedPct))
  const span = SPAN[which]
  const start = w.resetsAt - span
  const timeLeft = Math.max(0, Math.min(1, (w.resetsAt - now) / span))
  let emptyAt: number | undefined
  if (used > 1 && now > start + 60_000) {
    const rate = used / (now - start)
    const at = now + (100 - used) / rate
    if (at < w.resetsAt) emptyAt = at
  }
  return { which, used, left: 100 - used, resetsAt: w.resetsAt, timeLeft, out: used >= 100, emptyAt }
}

/** Colour of what is left: the account's while there is room, orange below 25 %, red below 10 %. */
export function leftColor(left: number | undefined, base: string): string {
  if (left == null) return base
  return left <= 10 ? 'var(--red)' : left <= 25 ? 'var(--orange)' : base
}

export const hhmm = (ms: number, now: number) => {
  const d = new Date(ms)
  const t = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return ms - now < 20 * 3600_000 ? t : `${d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} ${t}`
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
 * Two rings of what is left: outer, the week; inner, the 5 hours. The centre says how much is left of the one that will
 * run out first, and which one it is; out of usage, when it comes back. No reading draws a dotted track, never a guess.
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
  const tight = [five, week].filter((v) => v.left != null).sort((x, y) => x.left! - y.left!)[0]
  // Never smaller than this, whatever the ring (13-11, the user: «se siguen viendo cosas pequeñas como lo que pone bajo
  // del porcentaje»): a small ring says less, in one line, instead of the same at 6 px.
  const small = size < 110
  const tiny = (k: number) => Math.max(11, size * k)
  // The «working» dot sits outside the ring, at its corner, not on top of the bar («el verde del activo muy cerca de la barra»).
  const dot = Math.max(12, Math.round(size * 0.14))
  return (
    <div className="relative flex-none" style={{ width: size, height: size }} role="img"
      aria-label={`Queda ${five.left != null ? Math.round(five.left) + ' %' : 'sin lectura'} de las 5 horas y ${week.left != null ? Math.round(week.left) + ' %' : 'sin lectura'} de la semana`}
      title="Anillo de fuera: la semana. Anillo de dentro: las 5 horas. Lo coloreado es lo que queda.">
      <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <Arc r={r1} stroke={s} frac={week.left != null ? week.left / 100 : undefined} color={leftColor(week.left, base)} gid={`w${uid}`} />
        <Arc r={r2} stroke={s} frac={five.left != null ? five.left / 100 : undefined} color={leftColor(five.left, base)} gid={`f${uid}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {lim ? (
          <>
            <span style={{ fontSize: tiny(0.1), color: 'var(--label-2)', fontWeight: 650, marginBottom: 3 }}>vuelve</span>
            <span className="num" style={{ fontSize: size * (lim.resetsAt - now < 20 * 3600_000 ? 0.2 : 0.14), fontWeight: 760, color: 'var(--red)', letterSpacing: '-0.02em' }}>{hhmm(lim.resetsAt, now)}</span>
          </>
        ) : tight ? (
          <>
            <span className="num" style={{ fontSize: size * (small ? 0.24 : 0.2), fontWeight: 760, color: leftColor(tight.left, 'var(--label)'), letterSpacing: '-0.03em' }}>{Math.round(tight.left!)}<span style={{ fontSize: size * (small ? 0.13 : 0.11) }}>%</span></span>
            {small
              ? <span style={{ fontSize: tiny(0.1), color: 'var(--label-2)', fontWeight: 650, marginTop: 2 }}>{tight.which === 'five' ? '5 h' : 'semana'}</span>
              : <>
                <span style={{ fontSize: tiny(0.09), color: 'var(--label-2)', fontWeight: 650, marginTop: 1 }}>queda</span>
                <span style={{ fontSize: tiny(0.085), color: 'var(--label-2)', fontWeight: 550 }}>{tight.which === 'five' ? '5 horas' : 'semana'}</span>
              </>}
          </>
        ) : (
          <span className="num" style={{ fontSize: size * 0.28, fontWeight: 740, color: base, letterSpacing: '-0.04em' }}>{a.id.slice(6)}</span>
        )}
      </div>
      {a.state === 'trabajando' && (
        <span className="absolute live-dot rounded-full" title="Trabajando ahora" style={{ right: -dot * 0.35, top: -dot * 0.35, width: dot, height: dot, background: STATE_META.trabajando.color, color: STATE_META.trabajando.color, boxShadow: '0 0 0 3px var(--bg-elev)' }} />
      )}
    </div>
  )
}

/**
 * One window as a bar of what is left, with a thin mark where it should be to last until the reset (the time still to
 * go). Left of the mark: spending faster than the clock. Below, in words: left, spent, reset and pace.
 */
export function UsageBar({ a, which, now, compact }: { a: AgentCard; which: 'five' | 'week'; now: number; compact?: boolean }) {
  const v = usageView(a, which, now)
  const base = ACCOUNT_COLOR[a.id]
  const color = leftColor(v.left, base)
  const name = which === 'five' ? '5 horas' : 'Semana'
  const fast = v.left != null && v.timeLeft != null && !v.out && v.left / 100 < v.timeLeft - 0.08
  // EV114: with the week used up, what is left of the 5 hours cannot be used: said so, and the bar greyed (13-11: Claude 1
  // showed «queda 21 %» in orange and «a este ritmo se acaba 14:02» with no week left).
  const weekOut = which === 'five' && !v.out && usageView(a, 'week', now).out
  if (weekOut) return (
    <div className="flex flex-col gap-1 min-w-0" style={{ opacity: 0.55 }}>
      <div className="flex items-baseline gap-2 min-w-0"><span className={compact ? 't-small' : 't-body'} style={{ fontWeight: 600 }}>{name}</span><span className="ml-auto whitespace-nowrap c3" style={{ fontWeight: 650, fontSize: compact ? 13 : 15 }}>no se puede usar</span></div>
      <div style={{ height: compact ? 7 : 9, borderRadius: 99, background: 'var(--fill-2)' }} />
      <div className="t-small c3 truncate">mientras la semana esté agotada no cuenta lo que quede de las 5 horas</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className={compact ? 't-small' : 't-body'} style={{ fontWeight: 600 }}>{name}</span>
        <span className="ml-auto num whitespace-nowrap" style={{ fontWeight: 700, fontSize: compact ? 13 : 15, color: v.left == null ? 'var(--label-3)' : color }}>
          {v.out ? 'agotada' : v.left == null ? 'sin lectura' : v.renewedAt ? 'entera' : `queda ${Math.round(v.left)} %`}
        </span>
      </div>
      <div className="relative" style={{ height: compact ? 7 : 9, borderRadius: 99, background: 'var(--fill-2)' }} title={v.timeLeft != null ? 'La raya marca el tiempo que falta hasta que se renueva: si la barra llega más allá de la raya, te dura de sobra' : undefined}>
        {v.left != null && v.left > 0 && (
          <motion.i className="block absolute left-0 top-0 bottom-0" style={{ borderRadius: 99, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 72%, white), ${color})` }}
            initial={{ width: 0 }} animate={{ width: `${Math.max(2, v.left)}%` }} transition={{ ...SPRING, duration: 0.8 }} />
        )}
        {v.timeLeft != null && !v.out && (
          <span className="absolute" style={{ left: `calc(${v.timeLeft * 100}% - 1px)`, top: -3, bottom: -3, width: 2, borderRadius: 2, background: 'var(--label-2)' }} />
        )}
      </div>
      <div className="t-small c3 truncate" title={v.resetsAt ? `Se renueva el ${new Date(v.resetsAt).toLocaleString('es-ES')}` : undefined}>
        {v.out && v.resetsAt ? <>vuelve <b className="c2">{hhmm(v.resetsAt, now)}</b> · en {countdown(v.resetsAt, now)}</>
          : v.renewedAt ? <>se renovó {hhmm(v.renewedAt, now)} y no ha trabajado desde entonces</>
          : v.used != null && v.resetsAt ? <>gastado {Math.round(v.used)} % · se renueva <b className="c2">{hhmm(v.resetsAt, now)}</b>{!compact && <> (en {countdown(v.resetsAt, now)})</>}
            {v.emptyAt ? <span style={{ color: 'var(--orange)' }}> · a este ritmo se acaba {hhmm(v.emptyAt, now)}</span> : fast ? <span style={{ color: 'var(--orange)' }}> · ritmo alto</span> : !compact ? <span style={{ color: 'var(--green)' }}> · te dura de sobra</span> : null}</>
          : 'llega con la próxima respuesta de esta cuenta'}
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
        <span className="t-small c3">Leído hace {countdown(now, a.usage.snapshot.capturedAt)}{compact ? '' : ', la última vez que trabajó'}</span>
      )}
    </div>
  )
}

/** «Queda 41 % de 5 h · 37 % de la semana», for one line. */
export function freeLabel(a: AgentCard, now: number): string {
  const five = usageView(a, 'five', now)
  const week = usageView(a, 'week', now)
  if (five.left == null && week.left == null) return 'Uso sin lectura'
  const f = (v: UsageView) => (v.out ? 'agotado' : v.left == null ? '—' : `${Math.round(v.left)} %`)
  return `Queda ${f(five)} de 5 h · ${f(week)} de la semana`
}
