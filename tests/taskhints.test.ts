import { describe, expect, it } from 'vitest'
import { bestHelpers, hintsLine, openPrograms, roots, type Helper } from '../src/core/taskhints'

const helpers: Helper[] = [
  { kind: 'skill', name: 'level-design', description: 'Design game levels: layout, pacing, flow, landmarks.', es: 'Diseña niveles y mapas de juego: recorrido, ritmo y puntos de referencia.' },
  { kind: 'skill', name: 'scenario-unity-world-building', description: 'Build worlds and terrains in Unity scenes.', es: 'Construye mundos y terrenos en escenas de Unity: suelo, taludes, agua.' },
  { kind: 'skill', name: 'blender-modeling', description: 'Model, retopologize and UV unwrap meshes in Blender.', es: 'Modela mallas en Blender, con su topología y sus UV.' },
  { kind: 'skill', name: 'emil-design-eng', description: 'UI polish, animation decisions and the details that make software feel great.' },
  { kind: 'agente', name: 'revisor-mapas', description: 'Revisa los mapas del juego: recorridos, taludes, arroyos, sitios por donde no se puede pasar.' },
  { kind: 'agente', name: 'arte-3d', description: 'Modelos 3D en Blender: modelado, texturas y exportación a Unity.' }
]

describe('qué le sirve a la tarea que coge un Claude (EV191)', () => {
  it('una tarea de mapas: las skills de niveles y mundos y el agente que revisa mapas', () => {
    const r = bestHelpers('MAPQA La Granja: arreglar explanada, talud y arroyos del mapa', helpers).map((h) => h.name)
    expect(r).toContain('revisor-mapas')
    expect(r.some((n) => n === 'level-design' || n === 'scenario-unity-world-building')).toBe(true)
    expect(r).not.toContain('blender-modeling')
  })

  it('una de modelado: lo de Blender', () => {
    const r = bestHelpers('Modelar el cerdo jefe en Blender con sus texturas', helpers).map((h) => h.name)
    expect(r[0] === 'blender-modeling' || r[0] === 'arte-3d').toBe(true)
    expect(r).toContain('arte-3d')
    expect(r).not.toContain('revisor-mapas')
  })

  it('lo que no encaja no sale, y como mucho tres', () => {
    expect(bestHelpers('Arreglar el porcentaje de créditos en el Mac', helpers)).toEqual([])
    expect(bestHelpers('mapas niveles mundos terrenos modelos blender texturas', helpers).length).toBeLessThanOrEqual(3)
  })

  it('plurales y terminaciones cuentan como la misma palabra', () => {
    expect([...roots('mapas')]).toEqual([...roots('mapa')])
    expect([...roots('modelado')]).toEqual([...roots('modelos')])
  })

  it('los programas abiertos solo si la tarea es de lo suyo', () => {
    const busy = { unityEditors: 1, blender: 0, userApps: ['Premiere'] }
    expect(openPrograms('arreglar la escena del mapa', busy).join(' ')).toContain('Unity')
    expect(openPrograms('arreglar la escena del mapa', busy).join(' ')).not.toContain('Premiere')
    expect(openPrograms('cambiar un texto de Ajustes', busy)).toEqual([])
  })

  it('una sola línea, corta, y nada cuando no hay nada', () => {
    expect(hintsLine([], [])).toBe('')
    const line = hintsLine(bestHelpers('arreglar el talud del mapa', helpers), ['Unity está abierto'])
    expect(line).toContain('revisor-mapas')
    expect(line).toContain('Unity está abierto')
    expect(line.split('\n').length).toBe(1)
  })
})
