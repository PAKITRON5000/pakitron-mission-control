// EV201: dónde trabaja ahora cada conversación según lo que toca, con los datos reales (solo lee la actividad; los
// proyectos, de una copia de la base de datos, la de las capturas). Uso:
// npx tsx scripts/donde-trabaja.ts claude5 [copia de mission.db]
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readActivity, workingProjectOf } from '../src/core/live'
import { loadProjects, projectForPath } from '../src/core/projects'
import { openDb } from '../src/core/db'
import type { AccountId } from '../src/core/types'

const account = (process.argv[2] ?? 'claude5') as AccountId
const projects = loadProjects(openDb(process.argv[3] ?? join(tmpdir(), 'pmc-capturas-datos', 'mission.db')))
const a = readActivity(account)
for (const [sid, touches] of Object.entries(a.touchesBySession ?? {})) {
  const w = workingProjectOf(touches, (p) => projectForPath(projects, p).project?.id, Date.now(), 7 * 24 * 3600_000)
  const name = projects.find((p) => p.id === w)?.name ?? '(su carpeta)'
  console.log(`${sid.slice(0, 8)} · ${touches.length} toques, el último ${new Date(touches[0].at).toLocaleTimeString('es-ES')} en ${touches[0].path} → ${name}`)
}
