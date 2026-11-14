// EV131: eight shapes of the app, each with its preview and, but the base one, its own lazily loaded view.
import { describe, it, expect } from 'vitest'
import { LAYOUTS, layoutOf } from '../src/renderer/src/layouts/meta'
import { LAYOUT_VIEWS } from '../src/renderer/src/layouts'

describe('shapes of the app', () => {
  it('eight, the tab shape first, each named, explained and drawn inside its frame', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(['pestanas', 'lateral', 'columna', 'tablero', 'consola', 'dividida', 'mosaico', 'mapa'])
    for (const l of LAYOUTS) {
      expect(l.name.length).toBeGreaterThan(3)
      expect(l.sub.length).toBeGreaterThan(30)
      for (const [x, y, w, h] of l.boxes) {
        expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 100 && y + h <= 64).toBe(true)
      }
    }
    expect(layoutOf(undefined).id).toBe('pestanas')
    expect(layoutOf('no-existe').id).toBe('pestanas')
  })

  it('every shape but the base one loads its own code when chosen', () => {
    expect(Object.keys(LAYOUT_VIEWS).sort()).toEqual(LAYOUTS.filter((l) => l.id !== 'pestanas').map((l) => l.id).sort())
  })
})
