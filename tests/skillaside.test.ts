import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asideIn, bringBack, setAside } from '../src/core/skillaside'

describe('apartar skills (EV95)', () => {
  it('la mueve fuera de skills sin borrarla y la devuelve igual', () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-skills-'))
    const dir = join(base, 'skills', 'resolve-color')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: resolve-color\n---\n')
    const away = setAside(dir)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(join(away, 'SKILL.md'))).toBe(true)
    expect(asideIn(base)).toEqual([away])
    const back = bringBack(away)
    expect(back).toBe(dir)
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
    expect(asideIn(base)).toEqual([])
  })
  it('no toca nada que no sea una skill', () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-skills-'))
    mkdirSync(join(base, 'otra', 'x'), { recursive: true })
    expect(() => setAside(join(base, 'otra', 'x'))).toThrow()
    expect(() => setAside(join(base, 'skills', 'no-existe'))).toThrow()
  })
})
