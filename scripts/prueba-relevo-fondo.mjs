// EV141, prueba real: un relevo entre dos cuentas con sesiones de fondo (Claude Code sin ventana), con las mismas órdenes
// que arma la app (core/bgsessions.ts: bgStartArgs con worktree.bgIsolation «none», bgResumeArgs; main/index.ts: stop
// antes de --resume; sin las marcas de sesión hija). Se usó el 14-11 (claude1): A = claude6, sin uso de verdad; B = claude1.
// A = la cuenta que se queda sin uso; B = la que recoge el turno. Gasta poco (haiku, respuestas de una línea).
// Cuidado (ver docs/PROYECTO.md › «Probar con Claude Code de verdad»): la carpeta de A, fuera de los proyectos (si no,
// su SessionStart da por leídos los avisos que le esperan allí); los mensajes empiezan por «Para al terminar.» (si no,
// el modo autónomo no deja parar a la que tiene el turno).
// Uso: node scripts/prueba-relevo-fondo.mjs <cuenta A> <carpeta de A> <cuenta B> <carpeta de B> <salida.json> [--parar]
import { execFile } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const [accA, dirA, accB, dirB, outFile] = process.argv.slice(2)
if (!outFile) { console.log('Uso: node scripts/prueba-relevo-fondo.mjs <cuenta A> <carpeta de A> <cuenta B> <carpeta de B> <salida.json> [--parar]'); process.exit(2) }
const VARS = ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SKIP_PROMPT_HISTORY', 'AI_AGENT']
// The accounts' folders, as the app keeps them (read only).
const db = new DatabaseSync(join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'PakitronMC', 'mission.db'), { readOnly: true })
const ACC = Object.fromEntries(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'accounts'").get()?.value ?? '[]').map((a) => [a.id, a.configDir ?? '']))
db.close()
for (const a of [accA, accB]) if (!(a in ACC)) { console.log(`No conozco la cuenta ${a}`); process.exit(2) }
const env = (acc) => { const e = { ...process.env }; for (const k of VARS) delete e[k]; if (ACC[acc]) e.CLAUDE_CONFIG_DIR = ACC[acc]; else delete e.CLAUDE_CONFIG_DIR; return e }
const exe = [join(homedir(), '.local', 'bin', 'claude.exe')].find(existsSync) ?? 'claude'
const run = (acc, args, cwd) => new Promise((res, rej) => execFile(exe, args, { cwd, env: env(acc), windowsHide: true, timeout: 120_000 }, (err, out, errOut) => (err ? rej(new Error(`${err.message.split('\n')[0]} ${String(errOut).slice(0, 300)}`)) : res(String(out)))))
const agents = async (acc) => JSON.parse(await run(acc, ['agents', '--json'], homedir())).filter((r) => r.kind === 'background')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const say = (x) => { const line = `${new Date().toLocaleTimeString('es-ES')} ${x}`; log.push(line); console.log(line) }
const BG_SETTINGS = JSON.stringify({ worktree: { bgIsolation: 'none' } })
const bgStartArgs = (o) => ['--bg', '--name', o.name.slice(0, 80), ...(o.model ? ['--model', o.model] : []), '--settings', BG_SETTINGS, ...(o.extra ?? []), o.prompt]
const bgResumeArgs = (id, prompt) => ['--bg', '--resume', id, prompt]

async function waitFor(acc, name, pred, ms = 180_000) {
  const t0 = Date.now()
  let row
  while (Date.now() - t0 < ms) {
    row = (await agents(acc)).find((r) => r.name === name)
    if (row && pred(row)) return row
    await sleep(4000)
  }
  throw new Error(`${acc}: «${name}» no llegó al estado esperado en ${ms / 1000} s (último: ${JSON.stringify(row)})`)
}

const result = { steps: [] }
try {
  // 1. A abre su turno en una sesión de fondo y, sin uso, se queda «blocked».
  const nameA = `Prueba EV141 · A (${accA})`
  say(`A: ${(await run(accA, bgStartArgs({ name: nameA, prompt: 'Prueba de la rueda sin ventanas: responde solo «hola». No uses herramientas.', model: 'haiku', extra: ['--permission-mode', 'auto'] }), dirA)).trim()}`)
  const a = await waitFor(accA, nameA, (r) => r.state === 'blocked' || r.state === 'done')
  say(`A: state=${a.state} status=${a.status} id=${a.id} sessionId=${a.sessionId}`)
  result.steps.push({ step: 'A abre y se queda sin uso', ok: a.state === 'blocked', row: a })

  // 2. El turno pasa a B: sesión de fondo nueva con la instrucción del relevo.
  const nameB = 'Mission Control · rueda (prueba EV141)'
  // «Para al terminar» al principio: el modo autónomo (gancho Stop) deja parar a la sesión (core/autonomy.ts › isStopPrompt);
  // sin eso, la cuenta que tiene el turno de Mission Control seguiría con tareas de verdad.
  const turn = `Para al terminar. Mission Control · prueba de la rueda sin ventanas (EV141): Claude ${accA.slice(6)} se ha quedado sin uso y te toca a ti. Es una prueba: no cambies ningún archivo, no ejecutes pmc ni git. Lee la línea 5 de docs/RELEVO.md con la herramienta de leer y responde solo con sus diez primeras palabras.`
  say(`B: ${(await run(accB, bgStartArgs({ name: nameB, prompt: turn, model: 'haiku', extra: ['--permission-mode', 'auto'] }), dirB)).trim()}`)
  const b = await waitFor(accB, nameB, (r) => r.state === 'done' || r.state === 'blocked')
  say(`B: state=${b.state} status=${b.status} id=${b.id} sessionId=${b.sessionId}`)
  result.steps.push({ step: 'B recibe el turno y trabaja', ok: b.state === 'done', row: b })

  // 3. B recibe una instrucción nueva en la misma conversación: stop y --resume sin más opciones.
  await run(accB, ['stop', b.id], dirB).catch((e) => say(`B stop: ${e.message}`))
  const second = 'Para al terminar. Segunda instrucción de la rueda (prueba EV141): responde solo con el número de líneas de docs/DECISIONS.md (léelo con la herramienta de leer). No cambies nada.'
  say(`B retomada: ${(await run(accB, bgResumeArgs(b.sessionId, second), dirB)).trim()}`)
  await sleep(5000)
  const b2 = await waitFor(accB, nameB, (r) => r.sessionId === b.sessionId && (r.state === 'done' || r.state === 'blocked'))
  say(`B retomada: state=${b2.state} id=${b2.id} sessionId=${b2.sessionId} (misma: ${b2.sessionId === b.sessionId})`)
  result.steps.push({ step: 'B recibe otra instrucción en su misma conversación', ok: b2.sessionId === b.sessionId && b2.state === 'done', row: b2 })
  result.a = a; result.b = b2
  if (process.argv.includes('--parar')) {
    for (const [acc, id] of [[accA, a.id], [accB, b2.id]]) {
      await run(acc, ['stop', id], homedir()).catch((e) => say(`stop ${acc}: ${e.message}`))
    }
    await sleep(3000)
    const left = [...(await agents(accA)), ...(await agents(accB))].filter((r) => r.id === a.id || r.id === b2.id)
    say(`paradas: quedan ${left.length}`)
    result.steps.push({ step: 'se cierran', ok: left.length === 0 })
  }
} catch (e) {
  say(`FALLO: ${e.message}`)
  result.error = e.message
}
result.log = log
writeFileSync(outFile, JSON.stringify(result, null, 1))
