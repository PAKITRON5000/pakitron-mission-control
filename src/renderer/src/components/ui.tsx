import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { t } from '../../../core/i18n'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { api, type AgentState, type AccountId, type AgentCard, type AccountActivity } from '../lib/api'

export const SPRING = { type: 'spring', bounce: 0, duration: 0.38 } as const
export const SPRING_SOFT = { type: 'spring', bounce: 0.12, duration: 0.45 } as const

export const STATE_META: Record<AgentState, { label: string; color: string }> = {
  trabajando: { get label() { return t('Trabajando') }, color: 'var(--green)' },
  esperando: { get label() { return t('Te espera') }, color: 'var(--yellow)' },
  'sin-uso': { get label() { return t('Sin uso') }, color: 'var(--red)' },
  bloqueado: { get label() { return t('Bloqueado') }, color: 'var(--orange)' },
  disponible: { get label() { return t('Disponible') }, color: 'var(--teal)' },
  desconectado: { get label() { return t('Sin sesión') }, color: 'var(--label-3)' },
  apartada: { get label() { return t('No usar') }, color: 'var(--label-3)' },
  baja: { get label() { return t('De baja') }, color: 'var(--label-3)' }
}

/** Filled from the accounts in Ajustes as the state arrives; an unknown one is grey. */
export const ACCOUNT_COLOR: Record<AccountId, string> = new Proxy({ claude1: '#FF9F0A', claude2: '#0A84FF', claude3: '#BF5AF2', claude4: '#30D158' } as Record<AccountId, string>, {
  get: (t, k: string) => (t as any)[k] ?? '#8E8E93'
})

export const accountNum = (id: string) => id.slice(6)

/** The name the user gave each account («cuenta-principal»), filled from the state like the colours. */
export const ACCOUNT_ALIAS: Record<string, string | undefined> = {}
/**
 * EV99 (the user, 13-11: «renombrar a los claude dentro de la app, sin afectar el arranque, que sea solo visual»): the
 * name the user gives each Claude, filled from the state like the colours. Launching and what the Claudes are told keep
 * claudeN. The account's own label (ACCOUNT_ALIAS, the start of its e-mail) only shows in its sheet now.
 */
export const ACCOUNT_NAME: Record<string, string | undefined> = {}
/** The user's name for it, else «Claude 1». */
export const accName = (id: string) => ACCOUNT_NAME[id] || `Claude ${id.slice(6)}`
export const accLabel = (id: string) => accName(id)
/** Texts made by the app («Claude 3 abrió una sesión») with the user's names in them. */
export const nameify = (text: string) => (Object.values(ACCOUNT_NAME).some(Boolean) ? text.replace(/\bClaude (\d{1,2})\b/g, (m, n: string) => ACCOUNT_NAME[`claude${n}`] || m) : text)

export const PRIORITY: { v: number; label: string; color: string }[] = [
  { v: 0, get label() { return t('Urgente') }, color: 'var(--red)' },
  { v: 1, get label() { return t('Alta') }, color: 'var(--orange)' },
  { v: 2, get label() { return t('Normal') }, color: 'var(--label-3)' },
  { v: 3, get label() { return t('Baja') }, color: 'var(--teal)' }
]

/** A small flag for urgente/alta/baja (normal shows nothing). */
export function PriorityBadge({ p, withLabel }: { p: number; withLabel?: boolean }) {
  if (p === 2 || p == null) return null
  const m = PRIORITY[p] ?? PRIORITY[2]
  return (
    <span className="pill" style={{ background: `color-mix(in srgb, ${m.color} 16%, transparent)`, color: m.color, padding: withLabel ? undefined : '1px 6px' }} title={t('Prioridad {label}', { label: m.label.toLowerCase() })}>
      <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden><path d="M1.5 10.5V1M1.5 1.5h6.2L6.4 4l1.3 2.5H1.5" fill={p <= 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      {withLabel && m.label}
    </span>
  )
}

/**
 * What an account is working on, in one sentence the user understands at a glance: what it said with `pmc ahora`;
 * else the task it holds; else its session's title. `fresh` is false when it is only the last thing it was doing.
 */
export function workingOn(a: AgentCard, act: AccountActivity | undefined, claimKeys: string[], now: number): { text: string; fresh: boolean; since?: number; source: 'dice' | 'tarea' | 'sesion' | 'estado' } {
  const active = a.state === 'trabajando' || a.state === 'esperando'
  const f = act?.focus
  if (f && (active ? now - f.at < 8 * 3600_000 : now - f.at < 30 * 60_000)) return { text: f.text, fresh: active, since: f.at, source: 'dice' }
  const s = a.sessions.find((x) => x.status === 'busy') ?? a.sessions[0]
  // Only tasks of the project it is working in (12-11: claude3, at work in Mission Control, showed «C1b», an old task
  // of the game project whose note named it).
  const pool = s?.projectId ? a.assigned.filter((t) => !t.projectId || t.projectId === s.projectId) : a.assigned
  const held = claimKeys.map((k) => pool.find((t) => t.extId === k)).find(Boolean)
  const task = held ?? pool.find((t) => t.status === 'en-desarrollo')
  if (active && task) return { text: `${task.extId ? task.extId + ' · ' : ''}${task.title}`, fresh: true, source: 'tarea' }
  if (active && s?.title) return { text: s.title, fresh: true, source: 'sesion' }
  if (f) return { text: f.text, fresh: false, since: f.at, source: 'dice' }
  return { text: a.stateReason, fresh: false, source: 'estado' }
}

/** Scrolls an element into view and makes it glow for a moment (search results, links between screens). */
export function flashElement(id: string, tries = 14): void {
  const el = document.getElementById(id)
  if (!el) {
    if (tries > 0) window.setTimeout(() => flashElement(id, tries - 1), 120)
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
  window.setTimeout(() => el.classList.remove('flash'), 2600)
}

export function StatePill({ state, compact }: { state: AgentState; compact?: boolean }) {
  const m = STATE_META[state]
  return (
    <span className="pill" style={{ background: `color-mix(in srgb, ${m.color} 16%, transparent)`, color: m.color }}>
      <span className={`dot ${state === 'trabajando' ? 'live-dot' : ''}`} style={{ background: m.color, color: m.color }} />
      {!compact && m.label}
    </span>
  )
}

export function Avatar({ id, size = 40 }: { id: AccountId; size?: number }) {
  const c = ACCOUNT_COLOR[id]
  const n = id.slice(6)
  return (
    <div
      className="flex items-center justify-center flex-none num"
      style={{
        width: size, height: size, borderRadius: size * 0.32,
        background: `linear-gradient(145deg, color-mix(in srgb, ${c} 92%, white), color-mix(in srgb, ${c} 78%, black))`,
        color: 'white', fontWeight: 720, fontSize: size * 0.42, letterSpacing: '-0.02em',
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.35), 0 2px 10px color-mix(in srgb, ${c} 35%, transparent)`
      }}
      aria-label={accLabel(id)}
      title={accLabel(id)}
    >
      {n}
    </div>
  )
}

export function Ring({ value, total, size = 64, stroke = 7, color = 'var(--accent)', children }: { value: number; total: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = total > 0 ? Math.min(1, value / total) : 0
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--fill-2)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - f) }} transition={{ ...SPRING, duration: 0.9 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

export function usageColor(p: number): string {
  return p >= 90 ? 'var(--red)' : p >= 75 ? 'var(--orange)' : 'var(--label)'
}

export function Bar({ pct, color }: { pct: number; color?: string }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <motion.i
        style={{ background: color ?? (p >= 90 ? 'linear-gradient(90deg, #FF6B60, #FF3B30)' : p >= 75 ? 'linear-gradient(90deg, #FFC043, #FF9F0A)' : 'linear-gradient(90deg, #5AC8FA, #0A84FF)') }}
        initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ ...SPRING, duration: 0.8 }}
      />
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <div className="seg no-drag" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.div layoutId={`seg-${id}`} className="seg-thumb" transition={SPRING} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-2">
      {icon && <div className="c3 mb-1">{icon}</div>}
      <div className="t-head">{title}</div>
      {text && <div className="t-small c3 max-w-[460px]">{text}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function SectionTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end gap-3 mb-3">
      <div className="min-w-0">
        <div className="t-section">{title}</div>
        {sub && <div className="t-small c3 mt-0.5 truncate">{sub}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  )
}

/** A panel that slides in from the right edge and leaves the same way (spatial consistency). */
export function Sheet({ open, onClose, children, width }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside
            className="sheet"
            style={width ? { width: `min(${width}px, calc(100vw - 20px))` } : undefined}
            initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            transition={SPRING}
            role="dialog"
            aria-modal="true"
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

export function SheetHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--sep)' }}>
      <div className="min-w-0 flex-1">{children}</div>
      <button className="btn btn-sm btn-icon btn-ghost" onClick={onClose} aria-label={t('Cerrar')}>
        <X size={16} />
      </button>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-[120px] flex-1">
      <div className="t-micro c3">{label}</div>
      <div className="t-title num mt-1" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="t-small c3 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

export function Source({ children }: { children: ReactNode }) {
  return <span className="t-small c4">{children}</span>
}

/**
 * An account out of usage, handled from here (the user, 12-11: «un botón de recargar dentro de la app»): «Recargar» opens
 * Claude's usage page, where the recharge is bought with that account's login, and «Ya está recargada» tells Mission
 * Control, which cannot know it until the account replies. The purchase itself is never made by the app.
 */
export function Recharge({ a, onDone }: { a: Pick<AgentCard, 'id' | 'identity'>; recharged?: Record<string, number>; onDone?: (text: string) => void }) {
  const n = a.id.slice(6)
  const [checking, setChecking] = useState(false)
  // EV120: checked with Claude Code itself (a few seconds, free while it is still out) instead of taken on trust.
  const check = () => {
    setChecking(true)
    void api<{ ok: boolean; checked: boolean; words: string; backAt?: number }>('probeNow', a.id).then((r) => {
      const at = r.backAt ? new Date(r.backAt).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''
      onDone?.(!r.checked ? t('No se pudo comprobar: cuento con Claude {n} como dices', { n: n })
        : r.ok ? t('Comprobado: Claude {n} ya tiene uso ({words}) y vuelve al turno', { n: n, words: r.words })
        : t('Comprobado: Claude {n} sigue sin uso{v0}', { n: n, v0: at ? t('; vuelve el {at}', { at: at }) : '' }))
    }, (e) => onDone?.((e as Error).message)).finally(() => setChecking(false))
  }
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button className="btn btn-sm btn-primary" title={t('Abre la página de uso de Claude: entra con la cuenta de Claude {n}{v0} y recárgala allí', { n: n, v0: a.identity?.email ? ` (${a.identity.email})` : '' })} onClick={() => void api('openUsagePage')}>Recargar</button>
      <button className="btn btn-sm" disabled={checking} title={t('La app se lo pregunta a Claude en unos segundos, sin abrir ventana. Además lo comprueba sola cada 10 minutos')} onClick={check}>{checking ? t('Comprobando…') : t('Ya está recargada')}</button>
    </span>
  )
}
