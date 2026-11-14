import { describe, it, expect } from 'vitest'
import { classify, corpusOf, isNoted, isRequest, requestHash } from '../src/core/requests'

describe('lo que pediste y nadie apuntó', () => {
  it('solo cuenta peticiones de verdad', () => {
    expect(isRequest('sigue')).toBe(false)
    expect(isRequest('/plugin install frontend-design')).toBe(false)
    expect(isRequest('[Pasted text #1 +546 lines] y algo más que no importa nada de nada aquí')).toBe(false)
    expect(isRequest('quiero que haya humo y partículas en el mapa, que no moleste pero que dé profundidad')).toBe(true)
    expect(isRequest('Mission Control: el usuario ha respondido en Decidir, en Para revisar o con notas en Tareas. Míralo y sigue.')).toBe(false)
    expect(isRequest('pero una cosa, no puedo elegir la forma de la app con esas fotos, no entiendo mucho, o sea')).toBe(false)
    // EV64: questions alone are not requests; a question that asks for something is
    expect(isRequest('cómo va el trabajo del otro claude? cuando termine de hacer esto qué hará? me preguntará algo y seguiré con él trabajando o cómo?')).toBe(false)
    expect(isRequest('puedes hacer que cuando le pida a astra miniaturas pueda escribir otra idea mientras las hace?')).toBe(true)
  })

  it('una petición está apuntada si una tarea repite un trozo de sus palabras', () => {
    const corpus = corpusOf(['BZ68 · Usuario (11-11): «quiero que haya humo y partículas en el mapa, el humo, se puede hacer de alguna forma que no moleste»'])
    expect(isNoted('quiero que haya humo y partículas en el mapa, que no moleste pero que dé profundidad y sensación de peligro', corpus)).toBe(true)
    expect(isNoted('la mano del cocinero no sujeta bien la sartén cuando corre por el puente del castillo nevado', corpus)).toBe(false)
    // Said with other words, it still counts.
    expect(isNoted('mejora la sartén: la mano del cocinero no la sujeta bien', corpusOf(['BZ67 · La mano del Cocinero no está sujetando bien la sartén']))).toBe(true)
  })

  it('clasifica, quita repetidas y respeta las cerradas por el usuario', () => {
    const t1 = 'arregla la mano del cocinero, no sujeta bien la sartén cuando corre por el puente del castillo nevado'
    const t2 = 'quiero que haya humo y partículas en el mapa, que no moleste pero que dé profundidad y peligro'
    const prompts = [
      { at: 3, account: 'claude1', text: t1, projectId: 'fp' },
      { at: 2, account: 'claude3', text: t1, projectId: 'fp' },
      { at: 1, account: 'claude1', text: t2, projectId: 'fp' }
    ]
    const corpus = { fp: corpusOf(['«quiero que haya humo y partículas en el mapa»']) }
    const r = classify(prompts, corpus, new Set(), 10 * 3600_000)
    expect(r.map((x) => x.status)).toEqual(['sin-apuntar', 'apuntada'])
    expect(classify(prompts, corpus, new Set([requestHash(t1)]), 10 * 3600_000)[0].status).toBe('cerrada')
    // Just asked: not called unnoted yet.
    expect(classify(prompts, corpus, new Set(), 3)[0].status).toBe('apuntada')
  })
})
