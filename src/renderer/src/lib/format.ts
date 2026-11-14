import { getLang, locale, t } from '../../../core/i18n'

// EV161: in the app's language (the formatter is made again when it changes).
let rtfLang = ''
let rtfFmt: Intl.RelativeTimeFormat
const rtf = { format: (v: number, u: Intl.RelativeTimeFormatUnit) => { if (rtfLang !== getLang()) { rtfLang = getLang(); rtfFmt = new Intl.RelativeTimeFormat(rtfLang, { numeric: 'auto' }) } return rtfFmt.format(v, u) } }

export function ago(ms?: number, now = Date.now()): string {
  if (!ms) return t('Sin datos')
  const s = Math.round((ms - now) / 1000)
  const a = Math.abs(s)
  if (a < 45) return s <= 0 ? t('ahora mismo') : t('en unos segundos')
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day')
  return dateShort(ms)
}

export function countdown(to: number, now = Date.now()): string {
  let s = Math.max(0, Math.round((to - now) / 1000))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min`
  return t('menos de 1 min')
}

export function duration(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

export function dateShort(ms: number): string {
  return new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}

export function whenFull(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const today = new Date(now)
  const sameDay = d.toDateString() === today.toDateString()
  const tomorrow = new Date(now + 86400_000).toDateString() === d.toDateString()
  if (sameDay) return t('hoy a las {hm}', { hm: clock(ms) })
  if (tomorrow) return t('mañana a las {hm}', { hm: clock(ms) })
  return `${d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short' })}, ${clock(ms)}`
}

export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms); d.setHours(0, 0, 0, 0)
  const day = new Date(now); day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - d.getTime()) / 86400_000)
  if (diff === 0) return t('Hoy')
  if (diff === 1) return t('Ayer')
  const s = new Date(ms).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
  return s[0].toUpperCase() + s.slice(1)
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1 << 20) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1 << 30) return `${(n / (1 << 20)).toFixed(1)} MB`
  return `${(n / (1 << 30)).toFixed(2)} GB`
}

export function modelName(id?: string): string | undefined {
  if (!id) return undefined
  const m = id.match(/claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
  return id.replace(/^claude-/, '')
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
