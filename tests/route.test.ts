// «Nueva instrucción» goes to the project its words point to, and says who will do it (EV46).
import { describe, it, expect } from 'vitest'
import { guessProject, pickAccount, type RouteAccount } from '../src/core/route'

const projects = [
  { id: 'fp', name: 'Juego de prueba', vocabulary: ['Castillo de la granja', 'Arquera con plumas', 'Rachas del cerdito', 'Mapa del pantano', 'pantalla de inicio'] },
  { id: 'lab', name: 'Laboratorio de prueba', vocabulary: ['Guion del elefante', 'Miniaturas de YouTube', 'Cada subtítulo a su tiempo', 'pantalla de inicio'] },
  { id: 'mc', name: 'Mission Control', vocabulary: ['Relevos entre cuentas', 'Galería de capturas', 'pantalla de inicio'] }
]

describe('where a request goes', () => {
  it('by the project name, or by words only its tasks use; a word every project uses says nothing', () => {
    expect(guessProject('En Juego de prueba, la arquera necesita otra animación', projects)?.id).toBe('fp')
    // Plural in the request, singular in the task; one long word only that project uses is enough.
    expect(guessProject('Los subtítulos van a destiempo en el último vídeo', projects)).toMatchObject({ id: 'lab', why: '«subtitulo» solo sale en sus tareas', byName: 0, own: 1 })
    expect(guessProject('Cambia la pantalla de inicio', projects)).toBeUndefined()
    expect(guessProject('hola', projects)).toBeUndefined()
  })

  it('who does it: the one working there, then an idle window there, then the freest with no window elsewhere', () => {
    const acc = (id: string, o: Partial<RouteAccount> = {}): RouteAccount => ({ id, out: false, limited: false, windows: [], ...o })
    expect(pickAccount('fp', [acc('claude1', { windows: [{ projectId: 'lab', working: true }] }), acc('claude6', { windows: [{ projectId: 'fp', working: true }] })])?.id).toBe('claude6')
    expect(pickAccount('fp', [acc('claude5', { weekFree: 90 }), acc('claude6', { windows: [{ projectId: 'fp', working: false }] })])?.id).toBe('claude6')
    const free = pickAccount('fp', [acc('claude1', { weekFree: 90, windows: [{ projectId: 'lab', working: true }] }), acc('claude3', { weekFree: 40 }), acc('claude5', { weekFree: 60 }), acc('claude4', { out: true, weekFree: 99 })])
    expect(free).toEqual({ id: 'claude5', why: 'está libre y le queda el 60 % de la semana' })
    expect(pickAccount('fp', [acc('claude2', { limited: true })])).toBeUndefined()
  })
})
