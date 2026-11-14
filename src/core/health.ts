import { t } from './i18n'
// What Mission Control needs to work on this machine, and whether each thing it reads from Claude Code still reads
// (EV12). Claude Code changes its files without notice: when a reading stops, the app showed «sin datos» and nobody knew
// why. Here every piece says in plain words whether it is there, and what to do if it is not. Nothing is installed.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Check { name: string; ok: boolean; detail: string; fix?: string; needed: boolean }

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
}

/** Programs: the ones every project needs, and Unity or Blender only when a project uses them. */
export function checkTools(i: HealthInput): Check[] {
  const exec = i.exec ?? run
  const exists = i.exists ?? existsSync
  const out: Check[] = []
  const claude = i.claudePath !== 'claude' && exists(i.claudePath) ? version(exec, i.claudePath) ?? 'instalado' : version(exec, 'claude')
  out.push({ name: 'Claude Code', ok: Boolean(claude), detail: claude ?? t('no se encuentra'), fix: 'Instala Claude Code (claude.com/claude-code) y abre de nuevo Mission Control', needed: true })
  const git = version(exec, 'git')
  out.push({ name: 'Git', ok: Boolean(git), detail: git ?? t('no se encuentra'), fix: 'Instala Git (git-scm.com): sin él no hay ramas, copias de trabajo ni historial de cambios', needed: true })
  const node = version(exec, 'node')
  out.push({ name: 'Node', ok: Boolean(node), detail: node ?? t('no se encuentra'), fix: 'Instala Node 22 o posterior (nodejs.org): las órdenes pmc y los avisos a los Claude lo usan', needed: true })
  const unity = i.projectRoots.some((r) => exists(join(r, 'ProjectSettings', 'ProjectVersion.txt')))
  if (unity) {
    const hub = ['C:\\Program Files\\Unity\\Hub\\Editor', 'C:\\Program Files\\Unity Hub'].find((p) => exists(p))
    out.push({ name: 'Unity', ok: Boolean(hub), detail: hub ? t('editores en {hub}', { hub: hub }) : t('no se encuentra en su carpeta habitual'), fix: 'Un proyecto es de Unity: instala Unity Hub y la versión que pide su ProjectSettings/ProjectVersion.txt', needed: false })
  }
  const blenderUsed = i.projectRoots.some((r) => exists(join(r, 'ArtSource')))
  if (blenderUsed) {
    const base = 'C:\\Program Files\\Blender Foundation'
    let found: string | undefined
    try { found = exists(base) ? readdirSync(base).filter((d) => /^Blender/i.test(d)).sort().pop() : undefined } catch { /* not there */ }
    out.push({ name: 'Blender', ok: Boolean(found), detail: found ?? t('no se encuentra en su carpeta habitual'), fix: 'Un proyecto genera sus modelos con Blender: instálalo (blender.org)', needed: false })
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
    if (!exists(a.configDir)) { out.push({ name: n, ok: false, detail: t('su carpeta no existe: {configDir}', { configDir: a.configDir }), fix: 'Quita la cuenta en Ajustes › Cuentas o vuelve a añadirla con su carpeta', needed: true }); continue }
    const parts: string[] = []
    const bad: string[] = []
    if (a.statusLine) parts.push('lee el uso'); else bad.push('no lee el uso (activa la lectura de consumo)')
    if (a.hooks) parts.push('recibe avisos'); else bad.push('no recibe avisos ni cuenta en los relevos (activa la coordinación)')
    // Plugged in but silent for days while the account has been used: the format may have changed.
    let lastTalk = 0
    try { const d = join(a.configDir, 'projects'); if (exists(d)) lastTalk = statSync(d).mtimeMs } catch { /* unreadable */ }
    if (a.statusLine && lastTalk && (!a.usageAt || lastTalk - a.usageAt > 2 * DAY) && now - lastTalk < 7 * DAY)
      bad.push('se ha usado estos días pero no llega ninguna lectura de uso: puede haber cambiado el formato de Claude Code')
    out.push({ name: n, ok: !bad.length, detail: [...bad, ...parts].join(' · '), fix: bad.length ? 'Ajustes › Lectura de consumo y Coordinación: un clic por cuenta' : undefined, needed: false })
  }
  return out
}
