// «Lanzar ahora» with the model the next task asks for (EV39).
import { describe, it, expect } from 'vitest'
import { effortArgs, modelArgs } from '../src/core/models'

describe('model per task', () => {
  it('a single model is passed on; a choice («fable u opus») or none keeps the account’s own', () => {
    expect(modelArgs('sonnet')).toEqual(['--model', 'sonnet'])
    expect(modelArgs('haiku')).toEqual(['--model', 'haiku'])
    expect(modelArgs('opus')).toEqual(['--model', 'opus'])
    expect(modelArgs('fable')).toEqual(['--model', 'fable'])
    expect(modelArgs('fable u opus')).toEqual([])
    expect(modelArgs(undefined)).toEqual([])
  })
  it('an account without Fable opens a Fable task with its own model', () => {
    expect(modelArgs('fable', true)).toEqual([])
  })
  it('esfuerzo medio solo para lo mecánico (EV101)', () => {
    expect(effortArgs('sonnet')).toEqual(['--effort', 'medium'])
    expect(effortArgs('haiku')).toEqual(['--effort', 'medium'])
    expect(effortArgs('opus')).toEqual([])
    expect(effortArgs('fable u opus')).toEqual([])
    expect(effortArgs(undefined)).toEqual([])
  })
})
