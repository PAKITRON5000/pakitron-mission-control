import { t } from '../../../core/i18n'
// EV131: Ajustes › Apariencia › «Forma de la app»: the eight shapes, each with a drawing of where everything goes, one
// press to change (nothing is lost: the same screens and data, and the colour theme stays).
import { Check } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { LAYOUTS, type LayoutMeta } from './meta'

const FILL: Record<LayoutMeta['boxes'][number][4], string> = {
  bar: 'var(--label-4)', nav: 'var(--accent)', main: 'var(--fill-2)', pane: 'var(--fill-2)', tile: 'color-mix(in srgb, var(--accent) 35%, var(--fill-2))', map: 'color-mix(in srgb, var(--green) 22%, var(--fill))', accent: 'color-mix(in srgb, var(--pink) 55%, var(--fill-2))'
}

export function LayoutPreview({ l }: { l: LayoutMeta }) {
  return (
    <svg viewBox="0 0 100 64" className="w-full block" style={{ borderRadius: 8, background: 'var(--bg)' }} aria-hidden>
      {l.boxes.map(([x, y, w, h, k], i) => <rect key={i} x={x + 0.6} y={y + 0.6} width={Math.max(0, w - 1.2)} height={Math.max(0, h - 1.2)} rx={k === 'bar' ? 1 : 2.4} fill={FILL[k]} opacity={k === 'nav' ? 0.75 : 1} />)}
    </svg>
  )
}

export function LayoutPicker() {
  const { state, toast, refresh } = useStore()
  const current = state?.settings.layout ?? 'pestanas'
  const choose = async (l: LayoutMeta) => {
    if (l.id === current) return
    try { await api('setSettings', { layout: l.id }); await refresh(); toast(t('Forma «{name}»: puedes volver a la de antes aquí mismo', { name: l.name })) } catch (e) { toast((e as Error).message) }
  }
  return (
    <div className="grid gap-3" role="radiogroup" aria-label={t('Forma de la app')} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))' }}>
      {LAYOUTS.map((l) => {
        const on = l.id === current
        return (
          <button key={l.id} role="radio" aria-checked={on} onClick={() => void choose(l)} className="text-left rounded-2xl p-2.5 border-0 flex flex-col gap-2 min-w-0"
            style={{ background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--fill)', boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'none' }}>
            <LayoutPreview l={l} />
            <span className="t-body flex items-center gap-1.5" style={{ fontWeight: 700 }}>{l.name}{on && <Check size={14} style={{ color: 'var(--accent)' }} />}</span>
            <span className="t-small c3">{l.sub}</span>
          </button>
        )
      })}
    </div>
  )
}
