// EV157: pictures of the app with invented data, for the README (and anyone who must show it without their own).
// Builds scripts/demo/seed.ts, makes the demo world in a folder (default %TEMP%\pmc-demo), and opens the installed app
// (or -- --exe <build>) in capture mode on it, with its own user folder: nothing of this PC's accounts or projects shows.
// Usage: node scripts/demo.mjs [--out <carpeta>] [--exe <app.exe>] [--sizes 1480x920] [--routes inicio,tareas]
import { build } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def }
// Read before the seed runs: it takes over process.argv.
const opts = { sizes: arg('sizes', '1480x920'), routes: arg('routes', 'inicio,tareas,decisiones,relevos,agentes,memoria'), steps: arg('steps', '[]') }
const out = resolve(arg('out', join(tmpdir(), 'pmc-demo')))
const exe = resolve(arg('exe', join(process.env.LOCALAPPDATA, 'Programs', 'Pakitron Mission Control', 'Pakitron Mission Control.exe')))
for (const d of ['data', 'usuario', 'proyectos', 'shots']) rmSync(join(out, d), { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const dist = join(out, 'seed')
await build({ logLevel: 'warn', configFile: false, build: { ssr: resolve('scripts/demo/seed.ts'), outDir: dist, emptyOutDir: true, target: 'node22', minify: false, rollupOptions: { output: { entryFileNames: 'seed.mjs', format: 'es', codeSplitting: false } } }, ssr: { noExternal: true } })
process.argv[2] = out
process.argv.length = 3
await import(pathToFileURL(join(dist, 'seed.mjs')).href)

if (!existsSync(exe)) throw new Error(`No está la app: ${exe}`)
const user = join(out, 'usuario')
const shots = join(out, 'shots')
mkdirSync(shots, { recursive: true })
const env = {
  ...process.env,
  PMC_DATA_DIR: join(out, 'data'), PMC_SHOT_DIR: shots, PMC_DEMO_AGENTS: join(out, 'agents.json'),
  PMC_SHOT_SIZES: opts.sizes, PMC_SHOT_ROUTES: opts.routes,
  PMC_SHOT_STEPS: opts.steps,
  USERPROFILE: user, HOME: user, APPDATA: join(user, 'AppData', 'Roaming'), LOCALAPPDATA: join(user, 'AppData', 'Local'),
  // Its own temp too: the capture profile lives there (a dock left open by another capture would show in every picture).
  TEMP: join(user, 'AppData', 'Local', 'Temp'), TMP: join(user, 'AppData', 'Local', 'Temp')
}
for (const k of Object.keys(env)) if (/^CLAUDE|^AI_AGENT/.test(k)) delete env[k]
mkdirSync(env.APPDATA, { recursive: true }); mkdirSync(env.TEMP, { recursive: true })
await new Promise((res) => { const p = spawn(exe, [], { cwd: user, env, stdio: 'ignore' }); p.on('exit', res); setTimeout(() => { p.kill(); res() }, 300_000) })
console.log(readdirSync(shots).filter((f) => f.endsWith('.png')).map((f) => join(shots, f)).join('\n'))
