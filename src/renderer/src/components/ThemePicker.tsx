// Ajustes › Apariencia (EV87): colour, look and light/dark, all in sight as swatches you press (the user: no menus
// that hide the options). A change shows at once; «Sorpréndeme» picks a mix at random.
import { t } from '../../../core/i18n'
import { Check, Shuffle } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { LOOK_INFO, PALETTES } from '../lib/themes'
import { Segmented } from './ui'

/**
 * EV90 (the user, 13-11: «son todo colores no? no cambia nada el estilo de la app, molaría que cada tema cambiara el
 * estilo»): whole themes, each a look, a colour and light or dark together, one press. The separate choices stay below.
 */
export const FULL_THEMES: { id: string; name: string; mood: string; palette: string; look: string; theme: 'dark' | 'light' }[] = [
  { id: 'estudio', get name() { return t('Estudio') }, get mood() { return t('Sobrio y oscuro, para muchas horas') }, palette: 'grafito', look: 'sobria', theme: 'dark' },
  { id: 'cabina', get name() { return t('Cabina de mando') }, get mood() { return t('Paneles con relieve, de noche') }, palette: 'medianoche', look: 'mando', theme: 'dark' },
  { id: 'neon', get name() { return t('Neón') }, get mood() { return t('Brillos y color fuerte') }, palette: 'chicle', look: 'neon', theme: 'dark' },
  { id: 'comic', get name() { return t('Cómic') }, get mood() { return t('Bordes gruesos y viñetas') }, palette: 'fuego', look: 'comic', theme: 'light' },
  { id: 'juguete', get name() { return t('Juguete') }, get mood() { return t('Redondo, alegre, como un juego') }, palette: 'lima', look: 'ludica', theme: 'light' },
  { id: 'amanecer', get name() { return t('Amanecer') }, get mood() { return t('Cálido y luminoso') }, palette: 'atardecer', look: 'viva', theme: 'light' },
  { id: 'bosque', get name() { return t('Bosque de noche') }, get mood() { return t('Verdes tranquilos, con vida') }, palette: 'bosque', look: 'viva', theme: 'dark' },
  { id: 'hielo', get name() { return t('Hielo') }, get mood() { return t('Limpio, claro y frío') }, palette: 'hielo', look: 'sobria', theme: 'light' }
]

export function ThemePicker() {
  const { state, toast, refresh } = useStore()
  if (!state) return null
  const s = state.settings
  const palette = s.palette ?? 'clasico'
  const look = s.look ?? 'sobria'
  const set = async (patch: Record<string, unknown>, say?: string) => { await api('setSettings', patch); await refresh(); if (say) toast(say) }
  const surprise = () => {
    const p = PALETTES[Math.floor(Math.random() * PALETTES.length)]
    const l = LOOK_INFO[Math.floor(Math.random() * LOOK_INFO.length)]
    void set({ palette: p.id, look: l.id }, t('{name} con estilo {v0}', { name: p.name, v0: l.name }))
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="c2 mb-2">{t('Temas completos')} <span className="t-small c3">{t('· estilo, color y claro u oscuro de una vez')}</span></div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {FULL_THEMES.map((f) => {
            const p = PALETTES.find((x) => x.id === f.palette)
            const on = palette === f.palette && look === f.look && s.theme === f.theme
            return (
              <button key={f.id} className="theme-swatch" aria-pressed={on} title={f.mood} onClick={() => void set({ palette: f.palette, look: f.look, theme: f.theme }, t('Tema «{name}»', { name: f.name }))}
                style={{ ['--a' as any]: p?.accent, ['--t' as any]: p?.tint, ['--t2' as any]: p?.tint2, background: f.theme === 'dark' ? '#16161c' : '#f4f4f7' }}>
                <span className="theme-swatch-art">
                  <i className="theme-swatch-card" /><i className="theme-swatch-bar" /><i className="theme-swatch-dot" />
                  {on && <span className="theme-swatch-check"><Check size={13} strokeWidth={3} /></span>}
                </span>
                <span className="t-small block truncate" style={{ fontWeight: 700, color: f.theme === 'dark' ? '#f5f5f7' : '#1d1d1f' }}>{f.name}</span>
                <span className="block truncate" style={{ fontSize: 11, color: f.theme === 'dark' ? '#a1a1aa' : '#6b6b73' }}>{f.mood}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <span className="w-44 c2">{t('Claro u oscuro')}</span>
        <Segmented value={s.theme} onChange={(v) => void set({ theme: v })} options={[{ value: 'system', label: t('Como Windows') }, { value: 'light', label: t('Claro') }, { value: 'dark', label: t('Oscuro') }]} />
        <button className="btn btn-sm ml-auto" onClick={surprise}><Shuffle size={14} /> {t('Sorpréndeme')}</button>
      </div>
      <div>
        <div className="c2 mb-2">{t('Color')} <span className="t-small c3">{t('· {length} temas', { length: PALETTES.length })}</span></div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {PALETTES.map((p) => {
            const on = p.id === palette
            return (
              <button key={p.id} className="theme-swatch" aria-pressed={on} onClick={() => void set({ palette: p.id })} title={p.mood}
                style={{ ['--a' as any]: p.accent, ['--t' as any]: p.tint, ['--t2' as any]: p.tint2 }}>
                <span className="theme-swatch-art">
                  <i className="theme-swatch-card" /><i className="theme-swatch-bar" /><i className="theme-swatch-dot" />
                  {on && <span className="theme-swatch-check"><Check size={13} strokeWidth={3} /></span>}
                </span>
                <span className="t-small block truncate" style={{ fontWeight: 650 }}>{p.name}</span>
                <span className="block truncate" style={{ fontSize: 11, color: 'var(--label-3)' }}>{p.mood}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <div className="c2 mb-2">{t('Estilo')} <span className="t-small c3">{t('· la forma, el relieve y la letra; se combina con cualquier color')}</span></div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {LOOK_INFO.map((l) => (
            <button key={l.id} className={`look-card look-card-${l.id}`} aria-pressed={l.id === look} onClick={() => void set({ look: l.id })}>
              <span className="t-body block" style={{ fontWeight: 700 }}>{l.name}{l.id === look && <Check size={14} className="inline ml-1.5 -mt-0.5" style={{ color: 'var(--accent)' }} />}</span>
              <span className="t-small c3 block">{l.mood}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
