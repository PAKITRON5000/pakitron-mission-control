import { afterEach, describe, expect, it } from 'vitest'
import { getLang, locale, pickLang, setLang, t, tn } from '../src/core/i18n'
import { en } from '../src/locales/en'

afterEach(() => setLang('es'))

describe('idiomas (EV161)', () => {
  it('sin elegir, el del sistema: español solo si el sistema está en español', () => {
    expect(pickLang(undefined, 'es-ES')).toBe('es')
    expect(pickLang(undefined, 'es')).toBe('es')
    expect(pickLang(undefined, 'en-US')).toBe('en')
    expect(pickLang(undefined, 'de-DE')).toBe('en')
    expect(pickLang(undefined, undefined)).toBe('es')
    expect(pickLang('es', 'en-US')).toBe('es')
    expect(pickLang('en', 'es-ES')).toBe('en')
  })

  it('en español, el texto tal cual; en inglés, su traducción, con sus huecos rellenos', () => {
    expect(t('Inicio')).toBe('Inicio')
    setLang('en')
    expect(getLang()).toBe('en')
    expect(t('Inicio')).toBe('Home')
    expect(t('{n} trabajando', { n: 2 })).toBe('2 working')
    expect(locale()).toBe('en-GB')
  })

  it('lo que nadie ha traducido sale en español, nunca vacío ni con su clave rara', () => {
    setLang('en')
    expect(t('Un texto que aún no está en el diccionario')).toBe('Un texto que aún no está en el diccionario')
    expect(t('Hola {nombre}', { nombre: 'Ana' })).toBe('Hola Ana')
    expect(t('Hola {nombre}')).toBe('Hola {nombre}')
  })

  it('singular y plural', () => {
    setLang('en')
    expect(tn(1, '{n} ventana', '{n} ventanas')).toBe('1 window')
    expect(tn(3, '{n} ventana', '{n} ventanas')).toBe('3 windows')
  })

  it('cada traducción conserva los mismos huecos que su texto en español', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const wrong = Object.entries(en).filter(([es, eng]) => holes(es) !== holes(eng)).map(([es]) => es)
    expect(wrong).toEqual([])
    expect(Object.values(en).filter((v) => !v.trim())).toEqual([])
  })
})
