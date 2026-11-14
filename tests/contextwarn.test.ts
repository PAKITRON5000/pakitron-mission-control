import { describe, it, expect } from 'vitest'
import { contextWarning } from '../src/core/contextwarn'

describe('aviso de contexto lleno (EV93)', () => {
  it('avisa una vez al 60 % y otra al 80 %, y nada antes ni sin dato', () => {
    expect(contextWarning(40, [])).toBeUndefined()
    expect(contextWarning(undefined, [])).toBeUndefined()
    const a = contextWarning(63, [])!
    expect(a.level).toBe(60)
    expect(a.text).toContain('63 %')
    expect(contextWarning(70, [60])).toBeUndefined()
    const b = contextWarning(85, [60])!
    expect(b.level).toBe(80)
    expect(b.text).toContain('pronto se compactará')
    expect(contextWarning(90, [60, 80])).toBeUndefined()
  })
})
