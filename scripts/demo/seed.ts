// EV157: an invented world for the README's pictures (and any capture that must show no one's real data). Three
// accounts, three projects with their docs, questions, notes, memory and live activity, all made up. Run through
// scripts/demo.mjs, which builds this file and then opens the app in capture mode on it. Nothing here touches real data:
// every path is under the folder given on the command line, and PMC_DATA_DIR points there before anything is opened.
// EV165: with --lang en the world itself is in English too (tasks, questions, notes), not only the app's own words.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, addEvent } from '../../src/core/db'
import { saveProject } from '../../src/core/projects'
import { addDecision } from '../../src/core/decisions'
import { addMemory } from '../../src/core/memory'
import { addInstruction } from '../../src/core/review'
import { claimTask } from '../../src/core/coord'
import { markTyped } from '../../src/core/notes'
import { installHooks, installStatusLine } from '../../src/core/integrations'
import type { AccountId, ProjectConfig } from '../../src/core/types'

const out = process.argv[2]
if (!out) throw new Error('Uso: seed <carpeta>')
const lang = process.env.PMC_DEMO_LANG || 'es'
/** The Spanish text, or the English one with --lang en. */
const L = (es: string, en: string): string => (lang === 'en' ? en : es)
const data = join(out, 'data')
const user = join(out, 'usuario')
const projects = join(out, 'proyectos')
process.env.PMC_DATA_DIR = data
// Every account gets its own folder in the demo user's home, claude1 too: nothing may land in this PC's real ~/.claude.
process.env.USERPROFILE = user
process.env.HOME = user
const now = Date.now()
const min = 60_000
const hour = 60 * min
const put = (file: string, text: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text.replace(/\n/g, '\r\n')) }

// ---- accounts: three logins, each in its own folder (the credentials file only has to exist; it is never read) --------
const accounts = [
  { id: 'claude1', alias: 'personal', dir: '.claude', color: '#FF9F0A' },
  { id: 'claude2', alias: L('trabajo', 'work'), dir: L('.claude-segunda', '.claude-work'), color: '#0A84FF' },
  { id: 'claude3', alias: L('estudio', 'study'), dir: L('.claude-tercera', '.claude-study'), color: '#BF5AF2' }
]
for (const a of accounts) put(join(user, a.dir, '.credentials.json'), '{}')
const accountList = accounts.map((a) => ({ id: a.id, alias: a.alias, configDir: join(user, a.dir), color: a.color }))
// Coordination and the usage reading on, as on a PC set up with the app (in the demo's own settings.json files).
for (const a of accountList) { installHooks(a as never, 'node', join(data, 'bin', 'pmc.mjs')); installStatusLine(a as never, 'node', join(data, 'bin', 'pmc.mjs')) }
put(join(data, 'accounts.json'), JSON.stringify(accountList, null, 1))
put(join(data, 'logins.json'), JSON.stringify(Object.fromEntries(accounts.map((a) => [a.id, { method: 'claude.ai', plan: 'max', at: now }]))))

// ---- usage, as each account's status line reports it --------------------------------------------------------------
const usage: Record<string, [number, number]> = { claude1: [38, 46], claude2: [71, 63], claude3: [12, 22] }
for (const [acc, [five, week]] of Object.entries(usage)) {
  const fiveResets = now + 2 * hour + 40 * min
  const weekResets = now + 3 * 24 * hour
  put(join(data, 'usage', `${acc}.json`), JSON.stringify({ account: acc, capturedAt: now - 2 * min, source: 'statusline', model: 'claude-opus-5-5', fiveHour: { usedPct: five, resetsAt: fiveResets }, sevenDay: { usedPct: week, resetsAt: weekResets } }))
  const rows: string[] = []
  for (let i = 30; i >= 0; i--) rows.push(JSON.stringify({ at: now - i * 10 * min, five: Math.max(0, five - i * 1.2), week: Math.max(0, week - i * 0.4), fiveResets, weekResets }))
  put(join(data, 'usage', `${acc}.history.jsonl`), rows.join('\n') + '\n')
}

// ---- projects ------------------------------------------------------------------------------------------------------
const NAMES = { starfall: 'Starfall', recetario: L('Recetario', 'Recipes'), tesis: L('Tesis', 'Thesis') }
const P = {
  starfall: join(projects, NAMES.starfall),
  recetario: join(projects, NAMES.recetario),
  tesis: join(projects, NAMES.tesis)
}
put(join(P.starfall, 'project.godot'), '[application]\nconfig/name="Starfall"\n')
put(join(P.starfall, 'CLAUDE.md'), L('# Starfall\n\nJuego de naves en Godot 4.\n\n## Cada sesión\n\n1. `pmc parte`.\n', '# Starfall\n\nA space shooter in Godot 4.\n\n## Each session\n\n1. `pmc parte`.\n'))
put(join(P.starfall, 'docs', 'TASKS.md'), L(`# Tareas de Starfall

## Juego

- [x] SF1 · **Nave del jugador con inercia** Movimiento con aceleración y frenada suave. Se da por buena cuando la nave se mueve a 60 fps sin tirones. [sonnet]
- [x] SF2 · **Disparo y enemigos básicos** Tres tipos de enemigo con patrones distintos. [sonnet]
- [~] SF3 · **Jefe del nivel 1 (claude1)** Tres fases; la segunda con escudos que rotan. Se da por buena cuando se puede ganar y perder contra él. [opus]
- [~] SF4 · **Menú de opciones (claude2)** Volumen, pantalla completa y mandos. [sonnet]
- [ ] SF5 · **Música adaptativa** Que suba de intensidad con el número de enemigos. [opus]
- [ ] SF6 · **Tabla de récords en línea** (tras: SF4) Guardar las 10 mejores partidas. [sonnet]
- [ ] SF7 · **Efectos de partículas al explotar** [sonnet]

## Pulido

- [ ] SF8 · **Vibración del mando al recibir daño** [sonnet]
- [ ] SF9 · **Pantalla de carga con consejos** [sonnet]
- [ ] SF10 · **Tutorial de los dos primeros minutos** (MC-1) Enseñar a moverse, disparar y usar el escudo sin texto largo. [opus]
`, `# Starfall tasks

## Game

- [x] SF1 · **Player ship with inertia** Movement with acceleration and smooth braking. Done when the ship moves at 60 fps without stutter. [sonnet]
- [x] SF2 · **Shooting and basic enemies** Three enemy types with different patterns. [sonnet]
- [~] SF3 · **Level 1 boss (claude1)** Three phases; the second with rotating shields. Done when you can win and lose against it. [opus]
- [~] SF4 · **Options menu (claude2)** Volume, full screen and controllers. [sonnet]
- [ ] SF5 · **Adaptive music** Gets more intense with the number of enemies. [opus]
- [ ] SF6 · **Online high scores** (after: SF4) Keep the 10 best runs. [sonnet]
- [ ] SF7 · **Particle effects on explosions** [sonnet]

## Polish

- [ ] SF8 · **Controller rumble when hit** [sonnet]
- [ ] SF9 · **Loading screen with tips** [sonnet]
- [ ] SF10 · **Tutorial for the first two minutes** (MC-1) Teach moving, shooting and the shield without long texts. [opus]
`))
const beat = new Date(now - 25 * min).toISOString().slice(0, 16).replace('T', ' ')
put(join(P.starfall, 'docs', 'RELEVO.md'), L(`# Relevo de Starfall

**En curso (claude1):** la segunda fase del jefe (SF3): los escudos ya rotan; falta que el láser avise medio segundo antes de disparar.

**Último latido:** ${beat} · claude1 · Fase 2 del jefe con escudos; 48 pruebas pasan. Siguiente: aviso del láser.
`, `# Starfall hand-off

**In progress (claude1):** the boss's second phase (SF3): the shields rotate; the laser still has to warn half a second before firing.

**Last heartbeat:** ${beat} · claude1 · Boss phase 2 with shields; 48 tests pass. Next: the laser warning.
`))
put(join(P.recetario, 'package.json'), '{ "name": "recetario", "private": true, "dependencies": { "react": "^19.0.0" } }\n')
put(join(P.recetario, 'CLAUDE.md'), L('# Recetario\n\nWeb de recetas con lista de la compra.\n', '# Recipes\n\nA recipes website with a shopping list.\n'))
put(join(P.recetario, 'docs', 'TASKS.md'), L(`# Tareas del Recetario

## Web

- [x] RC1 · **Buscador de recetas por ingrediente** [sonnet]
- [x] RC2 · **Lista de la compra que suma cantidades** [sonnet]
- [~] RC3 · **Modo cocina: pasos grandes y pantalla siempre encendida (claude2)** [sonnet]
- [ ] RC4 · **Importar recetas desde un enlace** [opus]
- [ ] RC5 · **Planificador semanal de menús** [opus]
- [ ] RC6 · **Fotos de cada paso** [sonnet]
`, `# Recipes tasks

## Web

- [x] RC1 · **Search recipes by ingredient** [sonnet]
- [x] RC2 · **Shopping list that adds up amounts** [sonnet]
- [~] RC3 · **Cooking mode: big steps and the screen always on (claude2)** [sonnet]
- [ ] RC4 · **Import recipes from a link** [opus]
- [ ] RC5 · **Weekly meal planner** [opus]
- [ ] RC6 · **A photo for each step** [sonnet]
`))
put(join(P.recetario, 'docs', 'RELEVO.md'), L(`# Relevo del Recetario

**En curso (claude2):** modo cocina (RC3): pasos a pantalla completa listos; falta mantener la pantalla encendida en el móvil.
`, `# Recipes hand-off

**In progress (claude2):** cooking mode (RC3): full-screen steps are ready; keeping the phone's screen on is left.
`))
put(join(P.tesis, 'docs', 'TASKS.md'), L(`# Tareas de la tesis

## Escritura

- [x] TS1 · **Índice y estructura de capítulos** [sonnet]
- [~] TS2 · **Capítulo 2: estado de la cuestión** [opus]
- [ ] TS3 · **Revisar la bibliografía en formato APA** [sonnet]
- [ ] TS4 · **Gráficas del capítulo 4** [sonnet]
`, `# Thesis tasks

## Writing

- [x] TS1 · **Contents and chapter structure** [sonnet]
- [~] TS2 · **Chapter 2: literature review** [opus]
- [ ] TS3 · **Check the bibliography in APA style** [sonnet]
- [ ] TS4 · **Charts for chapter 4** [sonnet]
`))
const list: ProjectConfig[] = [
  { id: 'starfall', name: NAMES.starfall, root: P.starfall, copies: [], docsDirs: ['docs'], mediaDirs: [], color: '#FF6B6B', createdAt: now - 20 * 24 * hour, readOnly: false, allowBuzon: false },
  { id: 'recetario', name: NAMES.recetario, root: P.recetario, copies: [], docsDirs: ['docs'], mediaDirs: [], color: '#30D158', createdAt: now - 12 * 24 * hour, readOnly: false, allowBuzon: false },
  { id: 'tesis', name: NAMES.tesis, root: P.tesis, copies: [], docsDirs: ['docs'], mediaDirs: [], color: '#64D2FF', createdAt: now - 5 * 24 * hour, readOnly: false, allowBuzon: false }
]

const db = openDb()
for (const p of list) saveProject(db, p)
db.prepare("INSERT INTO settings(key, value) VALUES('ui', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  .run(JSON.stringify({ activeProjectId: 'starfall', theme: 'dark', relayRulesAt: now - 3 * 24 * hour, autonomous: true, firstRunDone: true, lang }))
// EV167: skills the app found alone for the game (Inicio says so).
writeFileSync(join(data, 'skills-tally.json'), JSON.stringify({ starfall: { installed: 6, suggested: 3, at: now } }))
// The app keeps its accounts here (accounts.json is only its copy for the CLI): without it, it would look for its own.
db.prepare("INSERT INTO settings(key, value) VALUES('accounts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(accountList))

// ---- what the Claudes asked, what the user wrote, what they remember --------------------------------------------------
addDecision(db, {
  projectId: 'starfall', title: L('¿Qué color para los escudos del jefe?', 'What colour for the boss\'s shields?'), askedBy: 'claude1' as AccountId, taskExtId: 'SF3',
  question: L('Los escudos de la segunda fase rotan alrededor del jefe. Con el fondo morado del nivel 1, el azul se pierde un poco.', 'The second phase\'s shields rotate around the boss. On level 1\'s purple background, blue gets a bit lost.'),
  options: [L('A: Azul eléctrico, como el disparo del jugador', 'A: Electric blue, like the player\'s shots'), L('B: Naranja, que contrasta con el fondo', 'B: Orange, which stands out from the background'), L('C: Que cambien de color al recibir daño', 'C: They change colour when hit')], defaultChoice: 'B', waitHours: 6
}, now - 40 * min)
addDecision(db, {
  projectId: 'recetario', title: L('¿Las recetas se pueden compartir sin cuenta?', 'Can recipes be shared without an account?'), askedBy: 'claude2' as AccountId,
  question: L('Para importar recetas desde un enlace (RC4) hay que decidir si el enlace de una receta lo puede abrir cualquiera.', 'To import recipes from a link (RC4), we need to decide whether anyone can open a recipe\'s link.'),
  options: [L('A: Sí, con un enlace público', 'A: Yes, with a public link'), L('B: Solo con cuenta', 'B: Only with an account')], defaultChoice: 'A', waitHours: 12
}, now - 2 * hour)
addMemory(db, { projectId: 'starfall', kind: 'regla', text: L('No toques la física de la nave sin probarla con mando y con teclado', 'Do not change the ship\'s physics without trying it with a controller and a keyboard'), source: 'usuario' }, now - 3 * 24 * hour)
addMemory(db, { projectId: 'starfall', kind: 'preferencia', text: L('Colores saturados y fondos oscuros, estilo arcade', 'Saturated colours and dark backgrounds, arcade style'), source: 'usuario' }, now - 2 * 24 * hour)
addMemory(db, { projectId: 'starfall', kind: 'dato', text: L('Godot 4.4; las pruebas se lanzan con gdunit desde scripts/pruebas.cmd', 'Godot 4.4; tests run with gdunit from scripts/tests.cmd'), source: 'claude1' }, now - 24 * hour)

const n1 = addInstruction(db, { projectId: 'starfall', kind: 'general', body: L('Me gustaría un tutorial corto al empezar, sin mucho texto', 'I would like a short tutorial at the start, without much text') })
db.prepare("UPDATE instructions SET status = 'recibida', created_at = ?, updated_at = ?, delivered_at = ? WHERE id = ?").run(now - 3 * hour, now - 3 * hour + 4 * min, now - 3 * hour + 4 * min, n1.id)
// The task line carries the note's mark, so the dock shows it as filed.
writeFileSync(join(P.starfall, 'docs', 'TASKS.md'), readFileSync(join(P.starfall, 'docs', 'TASKS.md'), 'utf8').replace('(MC-1)', `(MC-${n1.id})`))
addEvent(db, { projectId: 'starfall', at: now - 3 * hour + 4 * min, account: 'claude1', kind: 'recibida', title: L('Claude 1 ha recibido: «Me gustaría un tutorial corto al empezar»', 'Claude 1 received: «I would like a short tutorial at the start»'), source: 'hook', ref: `ins:${n1.id}` })
const n2 = addInstruction(db, { projectId: 'starfall', kind: 'general', body: L('El láser del jefe debería avisar antes de disparar, ahora no da tiempo a esquivarlo', 'The boss\'s laser should warn before firing; right now there is no time to dodge it') })
db.prepare('UPDATE instructions SET created_at = ?, updated_at = ? WHERE id = ?').run(now - 6 * min, now - 6 * min, n2.id)
markTyped(db, n2.id, 'claude1' as AccountId, now - 6 * min)

// ---- who has what, and what happened today ---------------------------------------------------------------------------
claimTask(db, 'starfall', 'SF3', 'claude1' as AccountId, { now: now - 50 * min })
claimTask(db, 'recetario', 'RC3', 'claude2' as AccountId, { now: now - 35 * min })
const ev = (projectId: string, ago: number, account: string, kind: string, title: string) => addEvent(db, { projectId, at: now - ago, account, kind, title, source: 'demo' })
ev('starfall', 5 * hour, 'claude3', 'sesion', L('Claude 3 abrió una sesión', 'Claude 3 opened a session'))
ev('starfall', 4 * hour, 'claude3', 'tarea-hecha', L('SF2 · Disparo y enemigos básicos: hecha', 'SF2 · Shooting and basic enemies: done'))
ev('starfall', 3 * hour, 'claude3', 'relevo-app', L('Claude 3 se ha quedado sin uso de 5 horas; sigue Claude 1 donde lo dejó', 'Claude 3 ran out of its 5-hour usage; Claude 1 carries on where it stopped'))
ev('starfall', 50 * min, 'claude1', 'reserva', L('Claude 1 ha reservado SF3', 'Claude 1 claimed SF3'))
ev('starfall', 20 * min, 'claude1', 'archivo', L('Claude 1 escribió jefe/fase2.gd', 'Claude 1 wrote boss/phase2.gd'))
ev('recetario', 35 * min, 'claude2', 'reserva', L('Claude 2 ha reservado RC3', 'Claude 2 claimed RC3'))
ev('recetario', 12 * min, 'claude2', 'archivo', L('Claude 2 escribió src/modo-cocina.tsx', 'Claude 2 wrote src/cooking-mode.tsx'))
db.close()

// ---- live sessions (read by the app in capture mode only, PMC_DEMO_AGENTS) and what each one is doing ------------------
const s1 = '1f3a9c2e-0000-4000-8000-000000000001'
const s2 = '2b7d4e1f-0000-4000-8000-000000000002'
put(join(out, 'agents.json'), JSON.stringify({
  claude1: [{ pid: 999001, id: s1.slice(0, 8), cwd: P.starfall, kind: 'interactive', startedAt: now - 55 * min, sessionId: s1, status: 'busy' }],
  claude2: [{ pid: 999002, id: s2.slice(0, 8), cwd: P.recetario, kind: 'interactive', startedAt: now - 40 * min, sessionId: s2, status: 'busy' }],
  claude3: []
}))
const act = (acc: string, lines: object[]) => put(join(data, 'activity', `${acc}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
act('claude1', [
  { at: now - 50 * min, event: 'Focus', text: L('Segunda fase del jefe: escudos que rotan y láser con aviso (SF3)', 'Boss phase two: rotating shields and a laser that warns first (SF3)'), sessionId: s1 },
  { at: now - 9 * min, sessionId: s1, cwd: P.starfall, event: 'PreToolUse', text: L('Edita fase2.gd', 'Edits phase2.gd') },
  { at: now - 40 * 1000, sessionId: s1, cwd: P.starfall, event: 'PreToolUse', text: L('Lanza las pruebas del jefe', 'Runs the boss tests') }
])
act('claude2', [
  { at: now - 35 * min, event: 'Focus', text: L('Modo cocina: pasos grandes y pantalla siempre encendida (RC3)', 'Cooking mode: big steps and the screen always on (RC3)'), sessionId: s2 },
  { at: now - 70 * 1000, sessionId: s2, cwd: P.recetario, event: 'PreToolUse', text: L('Edita modo-cocina.tsx', 'Edits cooking-mode.tsx') }
])
act('claude3', [
  { at: now - 3 * hour, event: 'Stop', text: L('Ha terminado un turno', 'Finished a turn'), message: L('SF2 hecha: tres enemigos con patrones distintos y sus pruebas.', 'SF2 done: three enemies with different patterns, and their tests.') }
])
console.log(`Demo lista en ${out}`)
