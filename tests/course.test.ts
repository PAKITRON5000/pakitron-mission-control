import { describe, expect, it } from 'vitest'
import { courseText } from '../src/core/course'

describe('the course of a project (EV102)', () => {
  it('puts the user\'s words first and says how to act, never retiring without his words', () => {
    const t = courseText({
      project: 'Laboratorio de prueba',
      decisions: [{ title: '¿Seguimos con los vídeos largos?', choice: 'B: solo shorts', note: 'los largos ya no', status: 'decidida', at: Date.UTC(2026, 10, 12) }],
      memories: [{ kind: 'regla', text: 'Solo vídeos verticales' }, { kind: 'preferencia', text: 'Colores vivos' }],
      notes: [{ body: 'Esta intro sobra', status: 'pendiente', at: Date.UTC(2026, 10, 11) }],
      discarded: ['Editor de largos (decisión descartada)']
    })
    expect(t).toContain('REGLAS DEL USUARIO:\n- Solo vídeos verticales')
    expect(t).toContain('→ B: solo shorts («los largos ya no»)')
    expect(t).toContain('SUS NOTAS AL MIRAR')
    expect(t).toContain('retirado/<nombre>')
    expect(t).toContain('Nunca retires nada por tu cuenta sin una frase del usuario')
  })
})
