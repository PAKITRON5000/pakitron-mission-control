// EV115: what is written down is fingerprinted, so its corpus and index are kept between calls while nothing changes.
import { describe, it, expect } from 'vitest'
import { textsSignature, classify, corpusOf } from '../src/core/requests'

describe('written-down fingerprint', () => {
  it('is the same for the same texts and changes with any edit, even of the same length', () => {
    const a = { mc: ['EV1 Hecho 13:10', 'EV2 otra'], fp: ['F1'] }
    expect(textsSignature(a)).toBe(textsSignature({ fp: ['F1'], mc: ['EV1 Hecho 13:10', 'EV2 otra'] }))
    expect(textsSignature(a)).not.toBe(textsSignature({ ...a, mc: ['EV1 Hecho 13:20', 'EV2 otra'] }))
    expect(textsSignature(a)).not.toBe(textsSignature({ ...a, mc: ['EV1 Hecho 13:10', 'EV2 otra', ''] }))
    expect(textsSignature(a)).not.toBe(textsSignature({ ...a, mc: ['EV1 Hecho 13:10EV2', ' otra'] }))
  })
  it('classifies the same with a kept corpus object, call after call', () => {
    const corpus = { mc: corpusOf(['Copia de seguridad cada noche en otro disco G Copias de proyectos']) }
    const prompts = [{ at: 1, account: 'claude1', text: 'haz una copia de seguridad cada noche en otro disco por favor' }]
    const one = classify(prompts, corpus, new Set(), 10 ** 13)
    const two = classify(prompts, corpus, new Set(), 10 ** 13)
    expect(one).toEqual(two)
    expect(one[0].status).toBe('apuntada')
  })
})
