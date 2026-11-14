// Colour themes (EV87; the user, 13-11: «con una gran variedad de temas si es posible», «deja una interfaz chula»).
// A theme is a palette over any of the six looks (looks.css: shape, depth and type) and over light or dark, so the user
// can mix them. One list is the source of everything: the CSS below is made from it and Ajustes draws its swatches from it.

export interface Palette {
  id: string
  name: string
  /** The accent in dark mode; light mode darkens it a little so text and buttons keep their contrast. */
  accent: string
  /** The colour that tints backgrounds and the ambient glow, and a second one for the other corner. */
  tint: string
  tint2: string
  /** Text on the accent: dark for the light accents (gold, ice…). */
  onAccent?: string
  /** One line for the swatch. */
  mood: string
}

export const PALETTES: Palette[] = [
  { id: 'clasico', name: 'Clásico', accent: '#0a84ff', tint: '#0a84ff', tint2: '#5e5ce6', mood: 'El de siempre: neutro y azul' },
  { id: 'oceano', name: 'Océano', accent: '#1e9bff', tint: '#0077b6', tint2: '#00b4d8', mood: 'Azules profundos y turquesa' },
  { id: 'bosque', name: 'Bosque', accent: '#34c759', tint: '#1f7a3f', tint2: '#5c9e31', mood: 'Verdes tranquilos' },
  { id: 'atardecer', name: 'Atardecer', accent: '#ff7a45', tint: '#ff4f6d', tint2: '#ffb020', mood: 'Naranja, rosa y oro' },
  { id: 'lavanda', name: 'Lavanda', accent: '#a78bfa', tint: '#7c5cff', tint2: '#d58bff', mood: 'Lilas suaves' },
  { id: 'cereza', name: 'Cereza', accent: '#ff375f', tint: '#c2185b', tint2: '#ff6b8b', mood: 'Rojo cereza con fuerza' },
  { id: 'oro', name: 'Oro', accent: '#f5b301', tint: '#b8860b', tint2: '#ffd60a', onAccent: '#2a1d00', mood: 'Dorado, de campeón' },
  { id: 'menta', name: 'Menta', accent: '#2dd4bf', tint: '#0f9f8f', tint2: '#7ee8c8', onAccent: '#032b26', mood: 'Fresco y limpio' },
  { id: 'aurora', name: 'Aurora', accent: '#34d399', tint: '#8b5cf6', tint2: '#22d3ee', onAccent: '#04281b', mood: 'Verde y violeta del norte' },
  { id: 'medianoche', name: 'Medianoche', accent: '#6366f1', tint: '#1e3a8a', tint2: '#4338ca', mood: 'Azul noche, para trabajar tarde' },
  { id: 'fuego', name: 'Fuego', accent: '#ff453a', tint: '#ff6a00', tint2: '#ffb300', mood: 'Rojo y naranja encendidos' },
  { id: 'chicle', name: 'Chicle', accent: '#ff6ad5', tint: '#8a5cff', tint2: '#26c6da', mood: 'Rosa, violeta y cian, años 80' },
  { id: 'hielo', name: 'Hielo', accent: '#64d2ff', tint: '#5ac8fa', tint2: '#c7f0ff', onAccent: '#032433', mood: 'Celeste helado' },
  { id: 'lima', name: 'Lima', accent: '#a3e635', tint: '#65a30d', tint2: '#facc15', onAccent: '#1a2600', mood: 'Verde lima con energía' },
  { id: 'cafe', name: 'Café', accent: '#d4a373', tint: '#8b5e3c', tint2: '#c08552', onAccent: '#2a1a0c', mood: 'Marrones cálidos' },
  { id: 'grafito', name: 'Grafito', accent: '#a1a1aa', tint: '#52525b', tint2: '#71717a', onAccent: '#111114', mood: 'Grises, sin color que distraiga' }
]

export const LOOK_INFO: { id: 'sobria' | 'viva' | 'ludica' | 'mando' | 'neon' | 'comic'; name: string; mood: string }[] = [
  { id: 'sobria', name: 'Sobria', mood: 'Limpia y tranquila' },
  { id: 'viva', name: 'Viva', mood: 'Con luz y tarjetas que se levantan' },
  { id: 'ludica', name: 'Lúdica', mood: 'Redonda y con relieve, como un juego' },
  { id: 'mando', name: 'Panel de mando', mood: 'Sala de control, bordes finos' },
  { id: 'neon', name: 'Neón', mood: 'Brillos de neón sobre oscuro' },
  { id: 'comic', name: 'Cómic', mood: 'Papel, tinta negra y sombras duras' }
]

/**
 * The CSS of every palette. Neón and Cómic keep their own backgrounds (they are made of them) and only take the accent;
 * the other looks are also tinted: background, cards, separators and an ambient glow in the palette's colours.
 */
export function paletteCss(list = PALETTES): string {
  const out: string[] = []
  const tinted = (p: Palette) => `html[data-palette='${p.id}']:not([data-look='comic']):not([data-look='neon'])`
  for (const p of list) {
    if (p.id === 'clasico') continue
    out.push(`html[data-palette='${p.id}'] { --accent: color-mix(in srgb, ${p.accent} 80%, black); --accent-soft: color-mix(in srgb, ${p.accent} 16%, transparent); --tint: ${p.tint}; --tint-2: ${p.tint2}; --on-accent: white; }`)
    out.push(`html[data-palette='${p.id}'].dark { --accent: ${p.accent}; --accent-soft: color-mix(in srgb, ${p.accent} 22%, transparent); --on-accent: ${p.onAccent ?? 'white'}; }`)
    out.push(`${tinted(p)}.dark { --bg: color-mix(in srgb, ${p.tint} 7%, #050507); --bg-elev: color-mix(in srgb, ${p.tint} 9%, #16161a); --bg-elev-2: color-mix(in srgb, ${p.tint} 11%, #202026); --bg-sunken: color-mix(in srgb, ${p.tint} 5%, #030304); --chrome: color-mix(in srgb, ${p.tint} 8%, rgb(16 16 20 / 0.94)); --sep: color-mix(in srgb, ${p.tint} 26%, rgb(84 84 88 / 0.4)); --fill: color-mix(in srgb, ${p.tint} 14%, rgb(118 118 128 / 0.16)); --fill-2: color-mix(in srgb, ${p.tint} 18%, rgb(118 118 128 / 0.22)); }`)
    out.push(`${tinted(p)}:not(.dark) { --bg: color-mix(in srgb, ${p.tint} 7%, #f4f4f7); --bg-elev: color-mix(in srgb, ${p.tint} 2%, #ffffff); --bg-elev-2: color-mix(in srgb, ${p.tint} 4%, #fafafc); --chrome: color-mix(in srgb, ${p.tint} 7%, rgb(238 238 243 / 0.94)); --sep: color-mix(in srgb, ${p.tint} 18%, rgb(60 60 67 / 0.12)); --fill: color-mix(in srgb, ${p.tint} 10%, rgb(118 118 128 / 0.08)); }`)
    out.push(`${tinted(p)} .content { background: radial-gradient(1100px 520px at 8% -10%, color-mix(in srgb, ${p.tint} 20%, transparent), transparent 62%), radial-gradient(900px 480px at 98% 0%, color-mix(in srgb, ${p.tint2} 14%, transparent), transparent 60%), var(--bg); }`)
  }
  // The playful look builds its button from the accent instead of its own pink when a palette is on.
  out.push(`html[data-palette]:not([data-palette='clasico'])[data-look='ludica'] .btn-primary { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, white), var(--accent)); box-shadow: 0 3px 0 color-mix(in srgb, var(--accent) 55%, black); }`)
  out.push(`html[data-palette]:not([data-palette='clasico']) .btn-primary { color: var(--on-accent, white); }`)
  return out.join('\n')
}
