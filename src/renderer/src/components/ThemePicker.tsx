// Ajustes › Apariencia (EV87): colour, look and light/dark, all in sight as swatches you press (the user: no menus
// that hide the options). A change shows at once; «Sorpréndeme» picks a mix at random.
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
  { id: 'estudio', name: 'Estudio', mood: 'Sobrio y oscuro, para muchas horas', palette: 'grafito', look: 'sobria', theme: 'dark' },
  { id: 'cabina', name: 'Cabina de mando', mood: 'Paneles con relieve, de noche', palette: 'medianoche', look: 'mando', theme: 'dark' },
  { id: 'neon', name: 'Neón', mood: 'Brillos y color fuerte', palette: 'chicle', look: 'neon', theme: 'dark' },
  { id: 'comic', name: 'Cómic', mood: 'Bordes gruesos y viñetas', palette: 'fuego', look: 'comic', theme: 'light' },
  { id: 'juguete', name: 'Juguete', mood: 'Redondo, alegre, como un juego', palette: 'lima', look: 'ludica', theme: 'light' },
  { id: 'amanecer', name: 'Amanecer', mood: 'Cálido y luminoso', palette: 'atardecer', look: 'viva', theme: 'light' },
  { id: 'bosque', name: 'Bosque de noche', mood: 'Verdes tranquilos, con vida', palette: 'bosque', look: 'viva', theme: 'dark' },
  { id: 'hielo', name: 'Hielo', mood: 'Limpio, claro y frío', palette: 'hielo', look: 'sobria', theme: 'light' }
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
    void set({ palette: p.id, look: l.id }, `${p.name} con estilo ${l.name}`)
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="c2 mb-2">Temas completos <span className="t-small c3">· estilo, color y claro u oscuro de una vez</span></div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {FULL_THEMES.map((f) => {
            const p = PALETTES.find((x) => x.id === f.palette)
            const on = palette === f.palette && look === f.look && s.theme === f.theme
            return (
              <button key={f.id} className="theme-swatch" aria-pressed={on} title={f.mood} onClick={() => void set({ palette: f.palette, look: f.look, theme: f.theme }, `Tema «${f.name}»`)}
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
        <span className="w-44 c2">Claro u oscuro</span>
        <Segmented value={s.theme} onChange={(v) => void set({ theme: v })} options={[{ value: 'system', label: 'Como Windows' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]} />
        <button className="btn btn-sm ml-auto" onClick={surprise}><Shuffle size={14} /> Sorpréndeme</button>
      </div>
      <div>
        <div className="c2 mb-2">Color <span className="t-small c3">· {PALETTES.length} temas</span></div>
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
        <div className="c2 mb-2">Estilo <span className="t-small c3">· la forma, el relieve y la letra; se combina con cualquier color</span></div>
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
