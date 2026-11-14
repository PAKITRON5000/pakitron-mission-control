import { describe, expect, it } from 'vitest'
import { strictClashes } from '../src/core/mdclash'

describe('orders that contradict each other in a CLAUDE.md (EV91)', () => {
  it('finds always against never on the same action and thing', () => {
    const r = strictClashes(['- Siempre usa la rama main para los cambios grandes.', '- Nunca uses la rama main para cambios grandes: trabaja en tu copia.'])
    expect(r).toHaveLength(1)
  })
  it('stays quiet on long console lines that only share words, and on different actions', () => {
    expect(strictClashes([
      '2. `npm test` y `npx tsc --noEmit -p tsconfig.json` antes y después de cada cambio.',
      '- En scripts de Bash, nada de heredocs con barras invertidas (se las come): para eso, un archivo con la herramienta de escribir.',
      '- No uses npm test sin compilar antes el proyecto entero.'
    ])).toEqual([])
    expect(strictClashes(['- Siempre guarda el relevo al cerrar un bloque.', '- Nunca borres el relevo al cerrar un bloque.'])).toEqual([])
  })
})
