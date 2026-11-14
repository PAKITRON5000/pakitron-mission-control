import { describe, expect, it } from 'vitest'
import { parseTasks } from '../src/core/parse/tasks'

describe('a «*» inside code in a note is not the end of the note (13-11, the game project, MP9)', () => {
  it('keeps the bold title and the code as it was', () => {
    const [t] = parseTasks('  - [~] MP9 · *12-11 09:50 (claude6): columnas escalonadas (fotos en `Logs/mp6_*`). Quedan losas sueltas en Cocotera.* **Pulido del decorado de piedra:** quedan losas sueltas.\n')
    expect(t.title).toBe('Pulido del decorado de piedra')
    expect(t.detail).toContain('`Logs/mp6_*`'.replace(/`/g, ''))
    expect(t.status).toBe('en-desarrollo')
  })
})

describe('task titles with several notes in front (13-11)', () => {
  it('a list mark left between notes is not the title (14-11: «EV141 · - [~] EV141 · Primer paso» in Inicio)', () => {
    const [t] = parseTasks('- [~] EV141 · *Casi (13-11 22:00, claude6): interruptor apagado.* *Segundo paso (13-11 21:56): «Ver».* - [~] EV141 · *Primer paso (13-11 21:53): bgsessions.* - [~] EV141 · *El usuario (#148): «A».* **La rueda con sesiones de fondo, sin escribir en ventanas** (tras: EV135): una forma de la rueda. [opus]\n')
    expect(t.title).toBe('La rueda con sesiones de fondo, sin escribir en ventanas')
    expect(t.detail).toContain('Primer paso')
    expect(t.detail).not.toContain('- [~]')
  })
  it('takes every leading note out, not only the first', () => {
    const [t] = parseTasks('- [x] EV91 · *Hecha (13-11, claude3): regla estricta.* *Antes: probado y descartado por ahora (claude1).* **Revisor de CLAUDE.md** (investigación): aviso. [sonnet]\n')
    expect(t.title).toBe('Revisor de CLAUDE.md')
    expect(t.detail).toContain('Antes: probado')
  })
  it('seven notes in front still leave the bold title (13-11: EV44 took its seventh note as its title)', () => {
    const notes = Array.from({ length: 7 }, (_, i) => `*Nota ${i + 1} (13-11, claude1): algo que pasó y quedó escrito.*`).join(' ')
    const [t] = parseTasks(`- [~] EV44 · ${notes} **Rutinas por proyecto que no gastan Claude** del usuario. [opus]\n`)
    expect(t.title).toBe('Rutinas por proyecto que no gastan Claude')
    expect(t.detail).toContain('Nota 7')
  })
})

describe('las etiquetas de una tarea quedan al final de lo que se guarda (EV125, 13-11)', () => {
  it('detrás de las notas, con lo demás en su sitio', async () => {
    const { taskTags } = await import('../src/core/coord')
    const [t] = parseTasks('- [~] EV20 · *Bloqueada (13-11, claude1): espera a que el usuario lo encienda.* *Hecho (12-11): planFronts, marcas {unity} y {gpu}, probado con [haiku].* **Reparto automático** Necesita añadir «{unity}» a taskTags. (tras: EV8) [fable u opus]\n')
    expect(t.title).toBe('Reparto automático')
    expect(t.detail.endsWith('[fable u opus]')).toBe(true)
    expect(t.detail).toContain('(tras: EV8)')
    expect(t.detail).toContain('Bloqueada (13-11, claude1)')
    expect(taskTags(`${t.title} ${t.detail}`)).toEqual({ after: ['EV8'], model: 'fable u opus', needs: [] })
    const [u] = parseTasks('- [ ] RA8 · **Rachas que matan** que el daño llegue cuando lo que se ve toca. {unity} [opus]\n')
    expect(taskTags(`${u.title} ${u.detail}`)).toEqual({ after: [], model: 'opus', needs: ['unity'] })
  })
})
