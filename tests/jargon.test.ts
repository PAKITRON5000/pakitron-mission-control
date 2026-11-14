// 13-11, Decidir #140: the user did not understand a question about «ganchos» in «settings.local.json». pmc decide sends
// back a question with words he does not know.
import { describe, it, expect } from 'vitest'
import { jargonIn } from '../src/core/decisions'

describe('plain questions', () => {
  it('finds the technical words of #140 and the like', () => {
    const q140 = ['¿Que la app vea a cualquier cuenta en tus proyectos?', 'Pongo los ganchos de la app en .claude/settings.local.json de cada proyecto', 'A: todos', 'B: lo pulsas tú']
    expect(jargonIn(...q140)).toEqual(expect.arrayContaining(['ganchos', 'settings.json']))
    expect(jargonIn('Cambio `keepGoing` en src/core/autonomy.ts')).toEqual(expect.arrayContaining(['rutas de código', 'nombres entre comillas de código']))
    expect(jargonIn('¿Uso un worktree por cuenta?')).toEqual(['worktree'])
    expect(jargonIn('La statusLine no da el uso por modelo')).toEqual(['statusLine'])
  })
  it('lets plain questions through', () => {
    expect(jargonIn('Copia de seguridad de los proyectos en otro disco', 'Todo el trabajo está en git solo en este PC. ¿Dónde la hago?', 'A: D:\\Copias de proyectos', 'B: G:\\Copias de proyectos')).toEqual([])
    expect(jargonIn('¿Paso la rueda a Juego de prueba?', '¿Te gusta este color para el botón?', undefined)).toEqual([])
    // «main» or «core» alone are words, not paths.
    expect(jargonIn('El tema principal y el núcleo de la idea: main menu, core loop')).toEqual([])
  })
})
