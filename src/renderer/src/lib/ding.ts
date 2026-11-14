import { t } from '../../../core/i18n'
// The tones of the notice, made here so there are no sound files to carry and the volume is exact.
export const TONES: { id: string; label: string }[] = [
  { id: 'campana', get label() { return t('Campanita') } },
  { id: 'moneda', get label() { return t('Moneda') } },
  { id: 'madera', get label() { return t('Madera') } },
  { id: 'cerdito', get label() { return t('Cerdito') } },
  { id: 'suave', get label() { return t('Suave') } },
  { id: 'ninguno', get label() { return t('Sin sonido') } }
]

type Note = { at: number; freq: number; to?: number; length: number; wave: OscillatorType; level: number }

const SCORES: Record<string, Note[]> = {
  campana: [
    { at: 0, freq: 1318, length: 0.9, wave: 'sine', level: 0.7 },
    { at: 0, freq: 2637, length: 0.45, wave: 'sine', level: 0.2 },
    { at: 0.16, freq: 1760, length: 1.1, wave: 'sine', level: 0.6 },
    { at: 0.16, freq: 3520, length: 0.5, wave: 'sine', level: 0.15 }
  ],
  moneda: [
    { at: 0, freq: 988, length: 0.09, wave: 'square', level: 0.28 },
    { at: 0.08, freq: 1319, length: 0.5, wave: 'square', level: 0.28 }
  ],
  madera: [
    { at: 0, freq: 620, to: 420, length: 0.09, wave: 'triangle', level: 0.9 },
    { at: 0.13, freq: 820, to: 560, length: 0.09, wave: 'triangle', level: 0.9 }
  ],
  cerdito: [
    { at: 0, freq: 300, to: 190, length: 0.16, wave: 'sawtooth', level: 0.4 },
    { at: 0.2, freq: 340, to: 210, length: 0.2, wave: 'sawtooth', level: 0.4 }
  ],
  suave: [
    { at: 0, freq: 523, length: 0.7, wave: 'sine', level: 0.6 },
    { at: 0.22, freq: 659, length: 0.9, wave: 'sine', level: 0.6 }
  ]
}

let context: AudioContext | undefined

export function playDing(tone = 'campana', volume = 70): void {
  const score = SCORES[tone]
  if (!score || volume <= 0) return
  context ??= new AudioContext()
  void context.resume()
  const start = context.currentTime + 0.02
  const master = context.createGain()
  master.gain.value = Math.min(1, volume / 100)
  master.connect(context.destination)
  for (const n of score) {
    const osc = context.createOscillator()
    const env = context.createGain()
    osc.type = n.wave
    osc.frequency.setValueAtTime(n.freq, start + n.at)
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.at + n.length)
    env.gain.setValueAtTime(0.0001, start + n.at)
    env.gain.exponentialRampToValueAtTime(n.level, start + n.at + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.length)
    osc.connect(env)
    env.connect(master)
    osc.start(start + n.at)
    osc.stop(start + n.at + n.length + 0.02)
  }
}
