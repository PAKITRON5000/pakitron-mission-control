import { t } from './i18n'
// What Mission Control needs to work on this machine, and whether each thing it reads from Claude Code still reads
// (EV12). Claude Code changes its files without notice: when a reading stops, the app showed «sin datos» and nobody knew
// why. Here every piece says in plain words whether it is there, and what to do if it is not. Nothing is installed.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Check {
  name: string; ok: boolean; detail: string; fix?: string; needed: boolean
  /** 14-11: what one click installs when it is missing (main/index.ts › installTool). */
  install?: 'claude' | 'git' | 'node'
}

export type Run = (cmd: string, args: string[]) => string
const run: Run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] })

function version(exec: Run, cmd: string, args = ['--version']): string | undefined {
  try { return exec(cmd, args).split(/\r?\n/)[0].trim() || undefined } catch { return undefined }
}

export interface HealthInput {
  /** Where the `claude` program was found (sessions.findClaude). */
  claudePath: string
  /** The project folders, to know which tools they use. */
  projectRoots: string[]
  accounts: { id: string; configDir: string; statusLine: boolean; hooks: boolean; usageAt?: number }[]
  now?: number
  exec?: Run
  exists?: (p: string) => boolean
  /** The app's own program standing in for Node (core/shim.ts), when this machine has no Node.js. */
  nodeFallback?: string
  platform?: string
}

/** Programs: the ones every project needs, and Unity or Blender only when a project uses them. */
export function checkTools(i: HealthInput): Check[] {
  const exec = i.exec ?? run
  const exists = i.exists ?? existsSync
  const out: Check[] = []
  const claude = i.claudePath !== 'claude' && exists(i.claudePath) ? version(exec, i.claudePath) ?? t('instalado') : version(exec, 'claude')
  const mac = (i.platform ?? process.platform) === 'darwin'
  out.push({ name: 'Claude Code', ok: Boolean(claude), detail: claude ?? t('no se encuentra'), fix: t('Pulsa «Instalar»: abre el instalador oficial de Claude Code en una ventana'), needed: true, install: 'claude' })
  const git = version(exec, 'git')
  out.push({ name: 'Git', ok: Boolean(git), detail: git ?? t('no se encuentra'), fix: mac ? t('Pulsa «Instalar»: macOS abre su instalador de herramientas (Git va con ellas). Sin Git no hay ramas, copias de trabajo ni historial de cambios') : t('Pulsa «Instalar» (lo instala winget, el instalador de Windows). Sin Git no hay ramas, copias de trabajo ni historial de cambios'), needed: true, install: 'git' })
  const node = version(exec, 'node')
  // EV126: without Node.js, pmc runs on the app's own program: nothing is missing then (14-11, a Mac: «instala Node 22» scared).
  if (!node && i.nodeFallback) out.push({ name: 'Node', ok: true, detail: t('no instalado: pmc usa el programa de Mission Control, no hace falta'), needed: false })
  else out.push({ name: 'Node', ok: Boolean(node), detail: node ?? t('no se encuentra'), fix: t('Pulsa «Instalar» (Node 22 o posterior): las órdenes pmc y los avisos a los Claude lo usan'), needed: true, install: 'node' })
  const unity = i.projectRoots.some((r) => exists(join(r, 'ProjectSettings', 'ProjectVersion.txt')))
  if (unity) {
    const hub = (mac ? ['/Applications/Unity/Hub/Editor', '/Applications/Unity Hub.app'] : ['C:\\Program Files\\Unity\\Hub\\Editor', 'C:\\Program Files\\Unity Hub']).find((p) => exists(p))
    out.push({ name: 'Unity', ok: Boolean(hub), detail: hub ? t('editores en {hub}', { hub: hub }) : t('no se encuentra en su carpeta habitual'), fix: t('Un proyecto es de Unity: instala Unity Hub y la versión que pide su ProjectSettings/ProjectVersion.txt'), needed: false })
  }
  const blenderUsed = i.projectRoots.some((r) => exists(join(r, 'ArtSource')))
  if (blenderUsed) {
    const base = 'C:\\Program Files\\Blender Foundation'
    let found: string | undefined
    if (mac) found = exists('/Applications/Blender.app') ? '/Applications/Blender.app' : undefined
    else try { found = exists(base) ? readdirSync(base).filter((d) => /^Blender/i.test(d)).sort().pop() : undefined } catch { /* not there */ }
    out.push({ name: 'Blender', ok: Boolean(found), detail: found ?? t('no se encuentra en su carpeta habitual'), fix: t('Un proyecto genera sus modelos con Blender: instálalo (blender.org)'), needed: false })
  }
  return out
}

const DAY = 86400_000

/** What is read from each account: whether Mission Control is plugged in, and whether data actually arrives. */
export function checkReadings(i: HealthInput): Check[] {
  const now = i.now ?? Date.now()
  const exists = i.exists ?? existsSync
  const out: Check[] = []
  for (const a of i.accounts) {
    const n = `Claude ${a.id.slice(6)}`
    if (!exists(a.configDir)) { out.push({ name: n, ok: false, detail: t('su carpeta no existe: {configDir}', { configDir: a.configDir }), fix: t('Quita la cuenta en Ajustes › Cuentas o vuelve a añadirla con su carpeta'), needed: true }); continue }
    const parts: string[] = []
    const bad: string[] = []
    if (a.statusLine) parts.push(t('lee el uso')); else bad.push(t('no lee el uso (activa la lectura de consumo)'))
    if (a.hooks) parts.push(t('recibe avisos')); else bad.push(t('no recibe avisos ni cuenta en los relevos (activa la coordinación)'))
    // Plugged in but silent for days while the account has been used: the format may have changed.
    let lastTalk = 0
    try { const d = join(a.configDir, 'projects'); if (exists(d)) lastTalk = statSync(d).mtimeMs } catch { /* unreadable */ }
    if (a.statusLine && lastTalk && (!a.usageAt || lastTalk - a.usageAt > 2 * DAY) && now - lastTalk < 7 * DAY)
      bad.push(t('se ha usado estos días pero no llega ninguna lectura de uso: puede haber cambiado el formato de Claude Code'))
    out.push({ name: n, ok: !bad.length, detail: [...bad, ...parts].join(' · '), fix: bad.length ? t('Ajustes › Lectura de consumo y Coordinación: un clic por cuenta') : undefined, needed: false })
  }
  return out
}
