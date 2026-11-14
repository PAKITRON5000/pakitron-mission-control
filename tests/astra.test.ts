// Astra's chat folders placed in the gallery of the project their name points to (12-11).
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexChats, placeCodexChats } from '../src/core/astra'

describe('Astra folders', () => {
  it('lists chats with images, and places the ones whose name points clearly to a project', () => {
    const codex = mkdtempSync(join(tmpdir(), 'pmc-codex-'))
    const mk = (day: string, chat: string, file = 'a.png') => { mkdirSync(join(codex, day, chat), { recursive: true }); writeFileSync(join(codex, day, chat, file), 'x') }
    mk('2026-11-12', 'hola-astra-soy-claude-juego')
    mk('2026-11-10', 'encargo-para-astra-laboratorio')
    mk('2026-11-12', 'castillos')
    mk('2026-11-07', 'mira')
    mk('2026-11-07', 'solo-texto', 'notas.txt')
    const chats = codexChats(codex)
    expect(chats.map((c) => c.name).sort()).toEqual(['castillos', 'encargo-para-astra-laboratorio', 'hola-astra-soy-claude-juego', 'mira'])
    const projects = [
      { id: 'fp', name: 'Juego de prueba', vocabulary: ['Castillo de la granja', 'Arquera con plumas'] },
      { id: 'lab', name: 'Laboratorio de prueba', vocabulary: ['Guion del elefante', 'Miniaturas de YouTube'] },
      { id: 'mc', name: 'Mission Control', vocabulary: ['Relevos entre cuentas'] }
    ]
    const taken = new Set([join(codex, '2026-11-12', 'castillos').toLowerCase()])
    const placed = placeCodexChats(chats, projects, taken)
    expect(placed.map((p) => [p.dir.split(/[\\/]/).pop(), p.projectId]).sort()).toEqual([
      ['encargo-para-astra-laboratorio', 'lab'],
      ['hola-astra-soy-claude-juego', 'fp']
    ])
  })

  it('does not place a folder for two common words of one project (13-11: a CV app in Mission Control)', () => {
    const projects = [
      { id: 'fp', name: 'Juego de prueba', vocabulary: ['Castillo de la granja'] },
      { id: 'mc', name: 'Mission Control', vocabulary: ['Lo importante del contexto de cada sesión'] }
    ]
    expect(placeCodexChats([{ dir: 'C:/x/importante-sobre-el-contexto-esta-es', name: 'importante-sobre-el-contexto-esta-es' }], projects, new Set())).toEqual([])
  })
})
