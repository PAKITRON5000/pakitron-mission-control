// EV127: every session's brief says how its project is worked, from the project's card (docs/PROYECTO.md).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workingNotes } from '../src/core/brief'

const project = (docs: string) => ({ id: 'p', name: 'Prueba', root: join(docs, '..'), docsDirs: [docs], copies: [] }) as any

describe('«Cómo se trabaja aquí» in pmc parte', () => {
  it('takes the card’s section, and says when the card still has parts to fill', () => {
    const docs = join(mkdtempSync(join(tmpdir(), 'pmc-how-')), 'docs')
    mkdirSync(docs)
    writeFileSync(join(docs, 'PROYECTO.md'), '# Prueba\n\n## Qué es\n\nUna web.\n\n## Cómo trabajarlo mejor\n\nCada pantalla, con captura a tamaño de móvil.\nLas dependencias, una cuenta cada vez.\n\n## Ayudas instaladas\n\nSubagentes: explorador.\n')
    const how = workingNotes(project(docs))!
    expect(how).toBe('CÓMO SE TRABAJA AQUÍ: Cada pantalla, con captura a tamaño de móvil. Las dependencias, una cuenta cada vez.')
    writeFileSync(join(docs, 'PROYECTO.md'), '# Prueba\n\n## Qué es\n\nPara qué: (por completar)\n\n## Cómo trabajarlo mejor\n\nUna cuenta cada vez.\n')
    expect(workingNotes(project(docs))).toContain('«(por completar)»')
  })

  it('without a card, it tells how to make one', () => {
    const docs = join(mkdtempSync(join(tmpdir(), 'pmc-how-')), 'docs')
    mkdirSync(docs)
    expect(workingNotes(project(docs))).toContain('pmc preparar')
  })
})
