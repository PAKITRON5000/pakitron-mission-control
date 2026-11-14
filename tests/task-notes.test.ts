// 14-11: `pmc tarea` printed every account's note in front of a task (EV141: ~4,000 characters); now the newest two and
// the task's own words, with the older ones counted (--todo prints them all).
import { describe, it, expect } from 'vitest'
import { condenseNotes } from '../src/core/brief'

const EV141 = '- [x] EV141 · *Hecha (14-11 00:11, claude1): relevo real hecho.* *Casi (13-11 22:00, claude6): interruptor apagado.* *Segundo paso (13-11 21:56): «Ver» en Chats.* - [~] EV141 · *Primer paso (13-11 21:53): bgsessions con `Logs/mp6_*` dentro.* - [~] EV141 · *El usuario (#148): «A».* *A medias (13-11 21:14): probado el límite.* **La rueda con sesiones de fondo, sin escribir en ventanas** (tras: EV135): una forma de la rueda. Se da por buena cuando un relevo real pasa entero. [opus]'

describe('pmc tarea con muchas notas', () => {
  it('deja las dos más recientes y el texto propio, y cuenta las demás', () => {
    const r = condenseNotes(EV141)
    expect(r.hidden).toBe(4)
    expect(r.text).toContain('*Hecha (14-11 00:11, claude1): relevo real hecho.*')
    expect(r.text).toContain('*Casi (13-11 22:00, claude6): interruptor apagado.*')
    expect(r.text).toContain('*(4 notas anteriores: pmc tarea <ID> --todo)*')
    expect(r.text).toContain('**La rueda con sesiones de fondo, sin escribir en ventanas**')
    expect(r.text).toContain('Se da por buena cuando un relevo real pasa entero')
    expect(r.text).not.toContain('Primer paso')
    expect(r.text).not.toContain('A medias')
    expect(r.text.startsWith('- [x] EV141 · ')).toBe(true)
    expect(r.text.length).toBeLessThan(EV141.length)
  })
  it('una tarea con pocas notas, o sin marca de lista, queda igual', () => {
    const few = '- [ ] EV148 · *Preparada (14-11 00:47): falta la respuesta.* **La agenda no espera** a las bloqueadas.'
    expect(condenseNotes(few)).toEqual({ text: few, hidden: 0 })
    const three = '- [~] X1 · *Uno: algo largo de verdad.* *Dos: algo largo de verdad.* *Tres: algo largo de verdad.* **Título** y su texto propio.'
    expect(condenseNotes(three).hidden).toBe(0)
    expect(condenseNotes('Un párrafo cualquiera').hidden).toBe(0)
  })
  it('un «*» dentro de `código` en una nota que se queda no se pierde', () => {
    const line = '- [~] MP9 · *Hecha (14-11): fotos en `Logs/mp6_*`.* *Dos: algo largo de verdad.* *Tres: algo largo de verdad.* *Cuatro: algo largo.* **Pulido** del decorado.'
    const r = condenseNotes(line)
    expect(r.hidden).toBe(2)
    expect(r.text).toContain('`Logs/mp6_*`')
  })
})
